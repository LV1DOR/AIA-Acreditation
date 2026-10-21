#!/usr/bin/env python3
"""OPERATOR ONLY. Runs only the isolated restore project, with no published ports or egress."""
import argparse,json,os,re,subprocess
from common import KIT,MATERIAL,require,safe_main
PROJECT='aia-accreditation-production-restore'
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['validate','start','restore','status','stop']);p.add_argument('--approval-reference',required=True);a=p.parse_args()
    require(len(a.approval_reference)>=5,'EXPLICIT_RESTORE_APPROVAL_REQUIRED');require(os.geteuid()==0,'PRIVILEGED_RESTORE_OPERATOR_REQUIRED')
    state=KIT/'restore-state';require(state.is_dir(),'PREPARE_ISOLATED_RESTORE_FIRST')
    def docker(*args):
        env={k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','DOCKER_'))}
        r=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=1200)
        require(r.returncode==0,'ISOLATED_RESTORE_OPERATION_FAILED');return r.stdout.strip()
    def dc(*args):return docker('compose','--project-name',PROJECT,'--env-file',str(state/'compose.env'),'-f',str(KIT/'restore/compose.yaml'),*args)
    c=json.loads(dc('--profile','recovery','config','--format','json'));require(c['name']==PROJECT,'RESTORE_PROJECT_MISMATCH')
    require(all(n.get('internal') for n in c['networks'].values()),'RESTORE_NETWORK_MUST_HAVE_NO_EGRESS')
    require(not any(s.get('ports') or s.get('network_mode') or s.get('privileged') for s in c['services'].values()),'RESTORE_PUBLIC_PORT_OR_PRIVILEGE_FORBIDDEN')
    require(set(c['services'])=={'restore-postgres','restore-minio','restore-tools','restore-volume-init'},'NO_APPLICATION_OR_MAIL_WORKERS_IN_RESTORE')
    for n in c['volumes'].values():require(not n.get('external') and n['name'].startswith(PROJECT+'_'),'RESTORE_VOLUMES_MUST_BE_INDEPENDENT')
    image=json.loads(docker('image','inspect',c['services']['restore-tools']['image']))[0]
    require(image['Config']['Labels'].get('org.opencontainers.image.revision')==MATERIAL,'RESTORE_TOOLS_RELEASE_MISMATCH')
    for name in ['archive.key','custody.key','minio.license']:
        f=state/'secrets'/name;require(f.is_file() and not f.is_symlink() and f.stat().st_mode&0o077==0,'PRIVATE_RESTORE_KEY_OR_LICENSE_REQUIRED')
    if a.action=='validate':print('ISOLATED_RESTORE_CONFIG_VALIDATED_NO_CONTAINERS_STARTED');return
    if a.action=='start':
        for operational in ['aia-accreditation-production','aia-accreditation-staging']:
            require(not docker('ps','-aq','--filter','label=com.docker.compose.project='+operational),'RESTORE_REQUIRES_SEPARATE_NONOPERATIONAL_HOST')
        require(not docker('ps','-aq','--filter','label=com.docker.compose.project='+PROJECT),'RESTORE_CONTAINERS_ALREADY_EXIST_INSPECT_FIRST')
        require(not docker('volume','ls','-q','--filter','name=^'+PROJECT+'_'),'RESTORE_VOLUMES_ALREADY_EXIST_INSPECT_FIRST')
        memory={k:int(v.split()[0])//1024 for k,v in (line.split(':',1) for line in open('/proc/meminfo'))}
        require(memory['MemAvailable']>=512+1536+768+1536,'RESTORE_REQUIRES_SEPARATE_HOST_OR_MORE_CAPACITY')
        dc('up','-d','--wait','--wait-timeout','180','restore-postgres','restore-minio');print('ISOLATED_RESTORE_DEPENDENCIES_STARTED');return
    if a.action=='restore':
        out=dc('--profile','recovery','run','--rm','--no-deps','-T','restore-tools','node','node_modules/tsx/dist/cli.mjs','/app/production-ops/restore.ts');print(out);return
    if a.action=='status':
        rows=dc('ps','--format','json');print(rows);return
    if a.action=='stop':dc('stop','--timeout','60','restore-postgres','restore-minio');print('RESTORE_STOPPED_DATA_PRESERVED');return
if __name__=='__main__':safe_main(main)
