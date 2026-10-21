#!/usr/bin/env python3
"""EXPLICITLY APPROVED BUILDER ONLY. Takes exported source + manifest; never needs live secrets."""
import argparse,getpass,hashlib,json,os,re,subprocess,urllib.request
from pathlib import Path
from common import MATERIAL,COMMIT,PROJECT,require,put,safe_main
from production import MC_URL,MC_SHA
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--manifest',required=True);p.add_argument('--output',required=True);p.add_argument('--approve-build-and-downloads',action='store_true');a=p.parse_args()
    require(a.approve_build_and_downloads,'EXPLICIT_BUILDER_APPROVAL_REQUIRED')
    source=Path(a.source).resolve();manifest=json.loads(Path(a.manifest).read_text());out=Path(a.output).resolve()
    require(manifest.get('commit')==COMMIT and manifest.get('sourceMaterialSha256')==MATERIAL,'EXACT_REVIEWED_SOURCE_REQUIRED')
    for entry in manifest['files']:
        rel=Path(entry['path']);require(not rel.is_absolute() and '..' not in rel.parts,'UNSAFE_SOURCE_MANIFEST')
        file=source/rel;require(file.is_file() and not file.is_symlink() and hashlib.sha256(file.read_bytes()).hexdigest()==entry['sha256'],'BUILD_SOURCE_FILE_MISMATCH')
    actual={p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
    require(actual=={x['path'] for x in manifest['files']},'BUILD_CONTEXT_CONTAINS_UNREVIEWED_EXTRA_FILES')
    memory={k:int(v.split()[0])//1024 for k,v in (line.split(':',1) for line in open('/proc/meminfo'))}
    require(memory['MemAvailable']>=4608,'DEDICATED_BUILDER_MEMORY_HEADROOM_REQUIRED')
    require(not out.exists(),'BUILDER_OUTPUT_EXISTS_DO_NOT_OVERWRITE');out.mkdir(parents=True,mode=0o700);(out/'storage-admin').mkdir(mode=0o700)
    public=getpass.getpass('Production publishable key only (pk_live_, hidden): ');require(re.fullmatch('pk_live_[A-Za-z0-9_-]+',public),'LIVE_PUBLIC_KEY_REQUIRED')
    client=out/'storage-admin/mc'
    with urllib.request.urlopen(MC_URL,timeout=30) as r:client.write_bytes(r.read(64*1024*1024))
    require(hashlib.sha256(client.read_bytes()).hexdigest()==MC_SHA,'MC_CHECKSUM_MISMATCH');client.chmod(0o755)
    env={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ};env.update(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=public,AIA_SOURCE_SHA=MATERIAL,DOCKER_BUILDKIT='1')
    (out/'logs').mkdir(mode=0o700)
    def docker(*args,log=None):
        if log:
            with (out/'logs'/log).open('x') as output:
                os.fchmod(output.fileno(),0o600)
                r=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],env=env,stdout=output,stderr=subprocess.STDOUT,text=True,timeout=3600)
            require(r.returncode==0,'BUILDER_OPERATION_FAILED_INSPECT_PROTECTED_BUILD_LOG');return ''
        r=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=3600)
        require(r.returncode==0,'BUILDER_OPERATION_FAILED');return r.stdout
    images={}
    for role in ['web','worker','tools']:
        tag=PROJECT+'/'+role+':'+MATERIAL[:12]
        print('BUILDING '+role+'; protected log: '+str(out/'logs'/('build-'+role+'.log')),flush=True)
        docker('build','--platform','linux/amd64','--file',str(source/'infra/production/Dockerfile'),'--target',role,'--build-context','storage-admin='+str(out/'storage-admin'),'--build-arg','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','--build-arg','AIA_SOURCE_SHA','--label','org.opencontainers.image.revision='+MATERIAL,'--tag',tag,str(source),log='build-'+role+'.log')
        info=json.loads(docker('image','inspect',tag))[0];images[role]={'id':info['Id'],'tag':tag}
    put(out/'images.json',{'commit':COMMIT,'material':MATERIAL,'images':images,'publicKeyHash':hashlib.sha256(public.encode()).hexdigest()})
    docker('save','--output',str(out/'images.tar'),*[x['tag'] for x in images.values()])
    h=hashlib.sha256()
    with (out/'images.tar').open('rb') as f:
        while chunk:=f.read(1024*1024):h.update(chunk)
    put(out/'TRANSFER.sha256',h.hexdigest()+'  images.tar\n'+hashlib.sha256((out/'images.json').read_bytes()).hexdigest()+'  images.json\n')
    print('BUILDER_BUNDLE_PREPARED_VERIFY_TRANSFER_AND_IMAGE_LABELS_ON_TARGET')
if __name__=='__main__':safe_main(main)
