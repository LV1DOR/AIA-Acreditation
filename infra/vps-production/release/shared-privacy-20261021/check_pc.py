#!/usr/bin/env python3
"""WSL2/Docker Desktop only: test reviewed source using existing tools dependencies.
No application build, production connection, email, migration or deployment.
"""
import argparse,hashlib,json,os,re,stat,subprocess,tarfile,tempfile
from pathlib import Path
BASE='sha256:ca82ed9f3409380dfa35b82140b8183f04d6e0dc96ef77fad9c66228d6aab5c0'
TAG='aia-reviewed-tools-base:privacy-20261021'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
def docker(*args,log=None):
 env={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ}
 command=['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args]
 if log:
  with log.open('x') as f:
   os.fchmod(f.fileno(),0o600)
   p=subprocess.run(command,env=env,stdout=f,stderr=subprocess.STDOUT,text=True,timeout=900)
  if p.returncode:
   print('CHECK_FAILED_LOG: '+str(log))
   # Test image has no credentials or live configuration; test diagnostics are source-only.
   print('\n'.join(log.read_text(errors='replace').splitlines()[-70:]))
  need(p.returncode==0,'PC_CHECK_FAILED_PRESERVE_WORKSPACE');return ''
 p=subprocess.run(command,env=env,capture_output=True,text=True,timeout=60)
 need(p.returncode==0,'PC_DOCKER_INSPECTION_FAILED');return p.stdout

def main():
 p=argparse.ArgumentParser();p.add_argument('--archive',type=Path,required=True);p.add_argument('--sha256',required=True);a=p.parse_args()
 need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(),'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
 need(re.fullmatch('[a-f0-9]{64}',a.sha256) and digest(a.archive)==a.sha256,'BUNDLE_HASH_MISMATCH')
 need(stat.S_ISSOCK(Path('/var/run/docker.sock').stat().st_mode),'LOCAL_DOCKER_SOCKET_REQUIRED')
 mem={k:int(v.split()[0])//1024 for k,v in (x.split(':',1)for x in Path('/proc/meminfo').read_text().splitlines())}
 need(mem['MemAvailable']>=4096,'PC_MEMORY_HEADROOM_REQUIRED')
 image=json.loads(docker('image','inspect',BASE))[0]
 need(image['Id']==BASE and image['Os']=='linux' and image['Architecture']=='amd64','PINNED_EXISTING_TOOLS_REQUIRED')
 need(image['Config']['Labels'].get('org.opencontainers.image.revision')=='7227a412c854c076fd4df178135bbd116be1cdcf9553e388333579709172308e','PINNED_BASE_RELEASE_REQUIRED')
 need(image['Config']['Labels'].get('org.aia.storage-provisioning.sha256')=='f046d8cb976b09475d4879560241ada1a76d934662dbc12590372f90fb846103','REVIEWED_STORAGE_FIX_REQUIRED')
 need(input('Type CHECK-PRIVACY to approve a PC-only test image and one isolated test container; no application rebuild, email or deployment: ')=='CHECK-PRIVACY','EXPLICIT_PC_CHECK_APPROVAL_REQUIRED')
 os.umask(0o077);work=Path(tempfile.mkdtemp(prefix='aia-privacy-check-',dir=Path.home()))
 print('PC_CHECK_WORKSPACE='+str(work),flush=True)
 with tarfile.open(a.archive,'r:gz') as tf:
  for member in tf.getmembers():
   rel=Path(member.name)
   need(not rel.is_absolute() and '..' not in rel.parts and (member.isfile() or member.isdir()),'SAFE_SOURCE_ARCHIVE_REQUIRED')
  tf.extractall(work,filter='data')
 bundle=work/'privacy-release'
 manifest=json.loads((bundle/'source-manifest.json').read_text())
 files=manifest['files'];actual={x.relative_to(bundle/'source').as_posix() for x in (bundle/'source').rglob('*')if x.is_file()}
 need(actual=={e['path']for e in files},'SOURCE_CONTEXT_EXACT_INVENTORY_REQUIRED')
 for e in files:need(digest(bundle/'source'/e['path'])==e['sha256'],'SOURCE_CONTEXT_HASH_MISMATCH')
 need(hashlib.sha256(json.dumps(files,separators=(',',':')).encode()).hexdigest()==manifest['sourceMaterialSha256'],'SOURCE_MATERIAL_HASH_MISMATCH')
 for line in (bundle/'MANIFEST.sha256').read_text().splitlines():
  h,n=line.split('  ',1);need(digest(bundle/n)==h,'BUNDLE_MEMBER_HASH_MISMATCH')
 previous=docker('image','ls','--no-trunc','--filter','reference='+TAG,'--format','{{.ID}}').splitlines()
 need(not previous or set(previous)=={BASE},'PC_TEST_BASE_TAG_CONFLICT')
 if not previous:docker('tag',BASE,TAG)
 tag='aia-accreditation-checks/privacy:'+manifest['sourceMaterialSha256'][:12]
 print('BUILDING_TEST_IMAGE_ONLY_NO_DOWNLOADS',flush=True)
 docker('build','--platform','linux/amd64','--pull=false','--network=none','--file',str(bundle/'Dockerfile.checks'),'--tag',tag,str(bundle),log=work/'build-checks.log')
 name='aia-privacy-check-'+work.name.rsplit('-',1)[-1]
 print('RUNNING_OFFLINE_SOURCE_TESTS_NO_VOLUMES_NO_NETWORK',flush=True)
 docker('run','--name',name,'--pull','never','--network','none','--read-only','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges:true',
  '--tmpfs','/tmp:uid=1000,gid=1000,mode=0700,size=256m','--tmpfs','/app/node_modules/.vite:uid=1000,gid=1000,mode=0700,size=64m','--tmpfs','/app/.cache:uid=1000,gid=1000,mode=0700,size=64m',tag,log=work/'source-checks.log')
 (work/'checks-passed.json').write_text(json.dumps({'passed':True,'material':manifest['sourceMaterialSha256'],'databaseContacted':False,'emailSent':False,'applicationImagesRebuilt':False,'productionChanged':False},indent=2)+'\n')
 print('PRIVACY_RUNTIME_CHECKS_PASSED_NO_DATABASE_NO_EMAIL_NO_PRODUCTION_CHANGES')
 print('PC_CHECK_WORKSPACE='+str(work))
if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and re.fullmatch('[A-Z0-9_]+',str(e)) else type(e).__name__
  print('STOP: '+code);raise SystemExit(1)
