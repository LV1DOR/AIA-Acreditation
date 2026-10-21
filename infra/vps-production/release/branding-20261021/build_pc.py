#!/usr/bin/env python3
"""Build the tested privacy release on the existing WSL2/Docker Desktop builder.
Creates immutable web/worker/tools images and a transfer bundle only; no deployment.
"""
import getpass,hashlib,importlib.util,json,os,re,subprocess,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
WORK=Path(sys.argv[1])
MATERIAL='55c686172608c2c7b20ee2361773e0901f9a0654b33268264644d123bd109977'
BASE='sha256:f02cfc1df1d917880370d986197961306fc1e6dd72c862d086057b7bb9bac2a1'
BASE_MATERIAL='1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343'
OPS='f046d8cb976b09475d4879560241ada1a76d934662dbc12590372f90fb846103'
PUBLIC_HASH='7a2361c32ae4ac4a804ec8324d267a643f95200795611c7c6d695f6a0a515f21'
MC_HASH='83938eded435e7c28c397ece1dc590b2a79626dd9354aae2107060fec559ae2b'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  while chunk:=f.read(1024*1024):h.update(chunk)
 return h.hexdigest()
def write(p,data):
 with p.open('x')as f:os.fchmod(f.fileno(),0o600);f.write(data if isinstance(data,str)else json.dumps(data,indent=2)+'\n')

def main():
 need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(),'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
 need(WORK.parent==Path.home() and WORK.is_dir() and not WORK.is_symlink(),'EXISTING_TESTED_WORKSPACE_REQUIRED')
 bundle=WORK/'branding-release';src=bundle/'source';manifest=bundle/'MANIFEST.sha256'
 need(digest(manifest)=='15d457b794a9d7a3254aff23e8dc90a357c0a676e52b27ffda2e9f0a48c3eb0b','ORIGINAL_BUNDLE_MANIFEST_CHANGED')
 for line in manifest.read_text().splitlines():
  h,n=line.split('  ',1);rel=Path(n)
  need(not rel.is_absolute()and '..'not in rel.parts,'SAFE_MANIFEST_REQUIRED')
  f=bundle/rel;need(f.is_file()and not f.is_symlink()and digest(f)==h,'TESTED_BUNDLE_CHANGED')
 m=json.loads((bundle/'source-manifest.json').read_text())
 need(m['sourceMaterialSha256']==MATERIAL and hashlib.sha256(json.dumps(m['files'],separators=(',',':')).encode()).hexdigest()==MATERIAL,'SOURCE_MATERIAL_REQUIRED')
 need({p.relative_to(src).as_posix()for p in src.rglob('*')if p.is_file()}=={e['path']for e in m['files']},'EXACT_BUILD_CONTEXT_REQUIRED')
 checks=[]
 for f in WORK.glob('checks-passed-*.json'):
  r=json.loads(f.read_text())
  if r.get('passed')is True and r.get('material')==MATERIAL and r.get('productionChanged')is False and r.get('databaseContacted')is False and r.get('emailSent')is False:checks.append(f)
 need(bool(checks),'SUCCESSFUL_PINNED_RUNTIME_CHECKS_REQUIRED')
 mem={k:int(v.split()[0])//1024 for k,v in(line.split(':',1)for line in Path('/proc/meminfo').read_text().splitlines())}
 need(mem['MemAvailable']>=4608,'PC_BUILD_MEMORY_HEADROOM_REQUIRED')
 need((WORK/'pc-build-approved.json').is_file(),'EXPLICIT_PC_BUILD_APPROVAL_REQUIRED')
 public=getpass.getpass('Existing Production Clerk publishable key (pk_live_, hidden; NOT the secret key): ').strip()
 need(bool(re.fullmatch('pk_live_[A-Za-z0-9_-]+',public))and hashlib.sha256(public.encode()).hexdigest()==PUBLIC_HASH,'EXACT_EXISTING_CLERK_PUBLIC_BUILD_KEY_REQUIRED')
 os.umask(0o077);stamp=str(time.time_ns());out=Path.home()/('aia-branding-images-'+stamp);out.mkdir(mode=0o700)
 print('PC_IMAGE_OUTPUT='+str(out),flush=True)
 env={k:os.environ[k]for k in ['PATH','HOME']if k in os.environ}
 env.update(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=public,AIA_SOURCE_SHA=MATERIAL,DOCKER_BUILDKIT='1')
 def docker(*args,log=None,timeout=3600):
  cmd=['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args]
  if log:
   with(out/log).open('x')as f:
    os.fchmod(f.fileno(),0o600);r=subprocess.run(cmd,env=env,stdout=f,stderr=subprocess.STDOUT,text=True,timeout=timeout)
   if r.returncode:print('PROTECTED_BUILD_LOG='+str(out/log))
   need(r.returncode==0,'PC_BUILD_STEP_FAILED_INSPECT_PROTECTED_LOG');return ''
  r=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=timeout)
  need(r.returncode==0,'PC_IMAGE_INSPECTION_FAILED');return r.stdout
 base=json.loads(docker('image','inspect',BASE))[0]
 need(base['Id']==BASE and base['Os']=='linux'and base['Architecture']=='amd64'and base['Config']['Labels'].get('org.opencontainers.image.revision')==BASE_MATERIAL and base['Config']['Labels'].get('org.aia.storage-provisioning.sha256')==OPS,'EXACT_REVIEWED_BASE_TOOLS_REQUIRED')
 # Extract only the pinned public maintenance client. No container is started.
 client_dir=out/'storage-admin';client_dir.mkdir(mode=0o700)
 client_container='aia-branding-public-client-'+stamp
 docker('create','--name',client_container,'--network','none','--read-only','--user','1000:1000','--entrypoint','/usr/local/bin/mc',BASE,'--version')
 docker('cp',client_container+':/usr/local/bin/mc',str(client_dir/'mc'))
 need(digest(client_dir/'mc')==MC_HASH,'PINNED_PUBLIC_MC_CHECKSUM_MISMATCH');(client_dir/'mc').chmod(0o755)
 ops_manifest=json.loads((bundle/'storage-ops-manifest.json').read_text())
 need(ops_manifest['operationsMaterialSha256']==OPS,'REVIEWED_STORAGE_OPERATIONS_REQUIRED')
 for e in ops_manifest['files']:need(digest(bundle/'storage-ops'/e['path'])==e['sha256'],'STORAGE_OPERATIONS_FILE_CHANGED')
 images={}
 for role in ['web','worker','tools']:
  tag='aia-accreditation-production/'+role+':branding-'+MATERIAL[:12]+'-'+stamp
  print('BUILDING_'+role.upper()+'; protected log: '+str(out/('build-'+role+'.log')),flush=True)
  docker('build','--platform','linux/amd64','--pull=false','--file',str(src/'infra/production/Dockerfile'),'--target',role,
   '--build-context','storage-admin='+str(client_dir),'--build-context','reviewed-ops='+str(bundle/'storage-ops'),
   '--build-arg','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','--build-arg','AIA_SOURCE_SHA','--label','org.opencontainers.image.revision='+MATERIAL,'--tag',tag,str(src),log='build-'+role+'.log')
  image=json.loads(docker('image','inspect',tag))[0]
  need(image['Os']=='linux'and image['Architecture']=='amd64'and image['Config']['Labels'].get('org.opencontainers.image.revision')==MATERIAL and image['Config']['User']in ['node','aia','1000','1000:1000'],'NEW_IMAGE_PROVENANCE_REQUIRED')
  if role=='tools':need(image['Config']['Labels'].get('org.aia.storage-provisioning.sha256')==OPS,'NEW_TOOLS_STORAGE_FIX_REQUIRED')
  # Read public build metadata from an unstarted container; do not execute app startup.
  inspect_container='aia-branding-metadata-'+role+'-'+stamp
  docker('create','--name',inspect_container,'--network','none','--read-only','--entrypoint','node',image['Id'],'--version')
  docker('cp',inspect_container+':/app/deployment/build.json',str(out/('build-'+role+'.json')))
  metadata=json.loads((out/('build-'+role+'.json')).read_text())
  need(metadata.get('source')==MATERIAL and metadata.get('publicKeyHash')==PUBLIC_HASH,'EMBEDDED_IMAGE_BUILD_METADATA_MISMATCH')
  images[role]={'id':image['Id'],'tag':tag}
 print('CHECKING_NEW_TOOLS_PINNED_MC_OFFLINE_NO_AISTOR_REQUESTS',flush=True)
 docker('run','--name','aia-branding-client-contract-'+stamp,'--pull','never','--network','none','--read-only',
  '--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--memory-swap','256m','--pids-limit','64',
  '--tmpfs','/tmp:uid=1000,gid=1000,mode=0700,size=32m','--entrypoint','node',images['tools']['id'],'/app/reviewed-production-ops/client-check.mjs',log='client-contract.log',timeout=90)
 receipt={'commit':m['commit'],'material':MATERIAL,'images':images,'publicKeyHash':PUBLIC_HASH,'operationsMaterialSha256':OPS}
 write(out/'images.json',receipt)
 write(out/'build-review.json',{'material':MATERIAL,'baseMaterial':BASE_MATERIAL,'runtimeChecksReceipt':str(sorted(checks)[-1]),'allThreeRolesVerified':True,'reviewedStorageOperationsRetained':True,'productionChanged':False})
 print('EXPORTING_THREE_VERIFIED_IMMUTABLE_IMAGES',flush=True)
 docker('save','--output',str(out/'images.tar'),*[i['tag']for i in images.values()],log='save-images.log')
 (out/'images.tar').chmod(0o600)
 write(out/'TRANSFER.sha256',''.join(digest(out/n)+'  '+n+'\n'for n in ['images.tar','images.json','build-review.json']))
 write(WORK/'build-output.json',{'directory':str(out),'material':MATERIAL})
 print('BRANDING_IMAGE_BUNDLE_READY_NO_VPS_CHANGES')
 print('PC_IMAGE_OUTPUT='+str(out))
 print(json.dumps({'material':MATERIAL,'images':{k:v['id']for k,v in images.items()}}))
if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e)if isinstance(e,RuntimeError)and re.fullmatch('[A-Z0-9_]+',str(e))else type(e).__name__
  print('STOP: '+code);raise SystemExit(1)
