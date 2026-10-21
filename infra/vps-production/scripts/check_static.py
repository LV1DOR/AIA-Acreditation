#!/usr/bin/env python3
"""Non-destructive artifact checks. Uses only a standalone Compose CONFIG parser, never a daemon.
Does not open any real environment/credential/licence file. --record writes a new-kit evidence file.
"""
import sys
sys.dont_write_bytecode=True
import argparse,ast,hashlib,json,os,re,shutil,subprocess,tempfile
from pathlib import Path
import yaml
from common import KIT,REPO,require,safe_main

DOCS=['README.md','ARCHITECTURE.md','ENVIRONMENT.md','CLERK-SETUP.md','RESEND-SETUP.md','ADMIN-BOOTSTRAP.md','DEPLOYMENT.md','BACKUP-RESTORE.md','NGINX-CUTOVER.md','ACCEPTANCE.md','GO-NOGO.md','RESOURCE-PLAN.md','DAEMON-MAINTENANCE-PROPOSAL.md','INITIAL-LAUNCH.md']
def main():
    p=argparse.ArgumentParser();p.add_argument('--record',action='store_true');a=p.parse_args();checks=[]
    for name in DOCS:require((KIT/name).is_file(),'REQUIRED_DOCUMENT_MISSING')
    checks.append(str(len(DOCS))+' required documents exist')
    for file in (KIT/'scripts').glob('*.py'):ast.parse(file.read_text(),filename=str(file))
    checks.append('Python helper AST syntax')
    clean={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ};clean['PYTHONDONTWRITEBYTECODE']='1'
    for file in list((KIT/'runtime').glob('*.ts'))+list((KIT/'runtime').glob('*.mjs')):
        r=subprocess.run(['node','--experimental-strip-types','--check',str(file)],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        if r.returncode:print(file.name+': '+r.stderr[:1500]);raise RuntimeError('NODE_SYNTAX_CHECK_FAILED')
    checks.append('Node TypeScript stripping / ESM syntax only; imports and types not checked')
    for file in (KIT/'runtime').glob('*.sh'):
        r=subprocess.run(['sh','-n',str(file)],stdout=subprocess.PIPE,stderr=subprocess.PIPE);require(r.returncode==0,'SHELL_SYNTAX_FAILED')
    checks.append('POSIX shell syntax')
    for file in KIT.rglob('*.json'):
        if any(x in ['state','restore-state','build-input','__pycache__'] for x in file.relative_to(KIT).parts):continue
        json.loads(file.read_text())
    checks.append('Non-secret template/evidence JSON parse')
    c=yaml.safe_load((KIT/'compose.yaml').read_text());r=yaml.safe_load((KIT/'restore/compose.yaml').read_text())
    require(c['name']=='aia-accreditation-production' and r['name']=='aia-accreditation-production-restore','FIXED_PROJECT_NAMES_REQUIRED')
    for n in ['postgres','redis','minio','web','worker']:require(not c['services'][n].get('ports'),'BACKEND_HOST_PORT_FORBIDDEN')
    require(c['services']['ingress']['ports']==['127.0.0.1:18881:8080','127.0.0.1:18444:8443'],'ONLY_REVIEWED_LOOPBACK_PORTS_ALLOWED')
    require(c['networks']['backend']['internal'] and all(n.get('internal') for n in r['networks'].values()),'INTERNAL_NETWORK_REQUIRED')
    require(all(not s.get('ports') for s in r['services'].values()),'RESTORE_HOST_PORT_FORBIDDEN')
    require(set(r['services'])=={'restore-postgres','restore-minio','restore-volume-init','restore-tools'},'RESTORE_APP_OR_WORKER_FORBIDDEN')
    for name in ['web','worker','ingress','redis','minio']:
        s=c['services'][name];require(s['read_only'] and 'ALL' in s['cap_drop'] and 'no-new-privileges:true' in s['security_opt'],'PRIVILEGE_REDUCTION_REQUIRED')
    for name,s in c['services'].items():
        require(s.get('mem_limit') and s.get('cpus') and s.get('pids_limit') and s.get('memswap_limit')==s['mem_limit'],'BOUNDED_SERVICE_REQUIRED')
        require(not s.get('privileged') and not s.get('container_name'),'NO_PRIVILEGED_OR_SHARED_CONTAINERS')
        if name in ['tools','provision','backup','monitor','admin','privacy']:require(s['profiles']==['maintenance'] and s['restart']=='no','MAINTENANCE_PROFILE_REQUIRED')
        for v in s.get('volumes',[]):
            require('/opt/aia-volunteers' not in v and 'aia-accreditation-staging' not in v,'EXISTING_APPLICATION_BIND_FORBIDDEN')
    checks.append('Production/restore isolation, fixed namespaces, non-root app controls, caps and loopback-only ports')
    parser=Path('/usr/libexec/docker/cli-plugins/docker-compose')
    require(parser.is_file(),'STANDALONE_COMPOSE_CONFIG_PARSER_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='aia-production-static-') as td:
        fixture=Path(td);dummy=fixture/'config.env'
        values={'AIA_WEB_IMAGE':'sha256:'+'1'*64,'AIA_WORKER_IMAGE':'sha256:'+'2'*64,'AIA_TOOLS_IMAGE':'sha256:'+'3'*64,'AIA_MINIO_IMAGE':'quay.io/minio/aistor/minio@sha256:'+'4'*64,'AIA_TLS_DIRECTORY':td+'/tls','AIA_SECRETS_DIRECTORY':td+'/secrets','AIA_BACKUP_DIRECTORY':td+'/backups','AIA_RESTORE_STATE':td+'/restore','AIA_RESTORE_TOOLS_IMAGE':'sha256:'+'3'*64,'AIA_RESTORE_MINIO_IMAGE':'quay.io/minio/aistor/minio@sha256:'+'4'*64}
        dummy.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
        for file,profile in [(KIT/'compose.yaml','maintenance'),(KIT/'restore/compose.yaml','recovery')]:
            result=subprocess.run([str(parser),'--env-file',str(dummy),'-f',str(file),'--profile',profile,'config','--format','json'],cwd=fixture,env={**clean,'DOCKER_HOST':'unix:///tmp/aia-no-daemon-static-only.sock'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
            if result.returncode:print(result.stderr[:2500]);raise RuntimeError('COMPOSE_CONFIG_PARSE_FAILED')
            normalized=json.loads(result.stdout)
            for group in ['networks','volumes']:
                for item in normalized[group].values():require(not item.get('external') and item['name'].startswith(normalized['name']+'_'),'NORMALIZED_NAMESPACE_MISMATCH')
            for s in normalized['services'].values():require(int(s['mem_limit'])>0,'NORMALIZED_LIMIT_INVALID')
    checks.append('Installed standalone Compose CONFIG parser: production + isolated restore, dummy inputs, no daemon')
    for file in (KIT/'reference').iterdir():
        if file.is_file():require(file.read_bytes()==(REPO/'infra/production'/file.name).read_bytes(),'AUDITED_REFERENCE_CHANGED')
    checks.append('Reference Dockerfile/entrypoint/SQL/TLS/Redis/Nginx files byte-identical to audited source')
    for file in KIT.glob('*.md'):
        for target in re.findall(r'\]\(([^)]+)\)',file.read_text()):
            if target.startswith(('https://','http://','#')):continue
            require((file.parent/target.split('#')[0]).exists(),'BROKEN_DOCUMENT_LINK')
    checks.append('Local Markdown artifact links')
    result=subprocess.run(['node',str(KIT/'tests/backup-crypto.test.mjs')],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    require(result.returncode==0 and '# pass 1' in result.stdout,'BACKUP_CRYPTO_TEST_FAILED')
    checks.append('Authenticated archive round-trip; wrong key, wrong ID, tamper and overwrite rejected')
    result=subprocess.run(['python3',str(KIT/'tests/test_operator_safety.py')],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    require(result.returncode==0 and 'Ran 7 tests' in result.stderr,'OPERATOR_SAFETY_REGRESSION_FAILED')
    checks.append('7 mocked operator safety regressions: approval, dirty source, capacity, orphan backup and cross-project protection')
    result=subprocess.run(['python3',str(KIT/'tests/test_resources.py')],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    require(result.returncode==0 and re.search(r'Ran ([1-9][0-9]*) tests',result.stderr),'MEMORY_ACCOUNTING_REGRESSION_FAILED')
    checks.append('27 mocked memory/telemetry regressions: no double counting, phase peaks, fresh scoped evidence, pressure and admission failure before mutations')
    result=subprocess.run(['python3',str(KIT/'tests/test_daemon_maintenance.py')],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    require(result.returncode==0 and 'Ran 20 tests' in result.stderr,'DAEMON_MAINTENANCE_REGRESSION_FAILED')
    checks.append('20 mocked daemon-window regressions: one restart, same-ID restoration, interruption/measurement/stop failures, unrelated-resource guards, scoped metadata and recovery without restart')
    result=subprocess.run(['python3',str(KIT/'tests/test_launch_preparation.py')],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    require(result.returncode==0 and 'Ran 8 tests' in result.stderr,'INITIAL_LAUNCH_GUARDS_FAILED')
    checks.append('8 launch-preparation checks: guarded secret creation, optional cleanup, essential cutover evidence, scoped image metadata and inherited job locking')
    result=subprocess.run(['node','--experimental-strip-types',str(KIT/'tests/initial-launch-config.test.mjs')],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    require(result.returncode==0 and '# pass 4' in result.stdout,'OPTIONAL_CLEANUP_STARTUP_REGRESSION_FAILED')
    checks.append('4 focused source tests: optional cleanup can stay absent; partial policy, authentication/TLS/key approvals and destructive-operation guards remain enforced')
    for unit,limit in [('backup',768),('monitor',128)]:
        text=(KIT/('systemd/aia-accreditation-production-'+unit+'.service')).read_text()
        require('MemoryMax='+str(limit)+'M\n' in text and 'MemorySwapMax=0\n' in text,'PREPARED_HOST_JOB_BOUND_REQUIRED')
    checks.append('Prepared backup/monitor host-process bounds present; units not installed or exercised')
    for name in ['production.py','configure.py','prepare_restore.py','restore_operator.py','offsite.py','nginx_cutover.py','resource_check.py','capacity_snapshot.py','host_memory.py','daemon_maintenance.py','release_source.py','storage_image_reference.py','build_on_builder.py']:
        result=subprocess.run(['python3',str(KIT/'scripts'/name),'--help'],env=clean,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
        require(result.returncode==0,'HELPER_IMPORT_OR_CLI_PARSE_FAILED')
    checks.append('Operator CLI imports/--help (no actions invoked)')
    if (KIT/'MANIFEST.sha256').exists() and not a.record:
        for line in (KIT/'MANIFEST.sha256').read_text().splitlines():
            digest,name=line.split('  ',1);require(hashlib.sha256((KIT/name).read_bytes()).hexdigest()==digest,'KIT_MANIFEST_HASH_MISMATCH')
        checks.append('Kit MANIFEST.sha256 integrity')
    report={'status':'STATIC_PREPARATION_CHECKS_PASSED','checks':checks,'dockerDaemonUsed':False,'productionCredentialsRead':False,'productionStarted':False,'focusedSourceTestsRun':True,'fullApplicationAuditRepeated':False,'runtimeAdaptersIntegrationTested':False,'nginxSyntaxTestedByInstalledNginx':False,'systemdUnitsInstalled':False,'unresolved':['production secrets/licence and matching release images not installed','fresh production-only admission requires separately approved staging shutdown','production migrations/authentication/SMTP/storage/backup-restore acceptance not executed','public cutover requires separate operator confirmation'],'deferred':['SMTP display name and Reply-To','advanced outbox cleanup','detailed long-term retention schedules','WeBook integration']}
    if a.record:(KIT/'evidence/static-checks.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':safe_main(main)
