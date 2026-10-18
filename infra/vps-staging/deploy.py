#!/usr/bin/env python3
"""Explicit operator-only Docker steps. No daemon management, removal or host reconfiguration."""
import argparse, datetime, getpass, hashlib, json, os, re, shutil, subprocess, sys, time, traceback
from pathlib import Path
from prepare import REPO, KIT, STATE, PROJECT, DB, COMMIT, require, readenv, envput, put, check_repo, ports

GO = 'golang:1.26-bookworm@sha256:d9c68c2c51161e12fd77e4c6320687c9cd86e1af1e3ad6e6cd63ff970641453c'
MC = 'github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z'
stamp = lambda: datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+str(os.getpid())

def run(args, *, log=None, env=None):
    p = subprocess.run(args, cwd=REPO, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if log:
        put(STATE/'logs'/log, p.stdout+p.stderr)
    require(p.returncode == 0, 'COMMAND_FAILED'+(' inspect protected logs/'+log if log else ' (output withheld to protect credentials)'))
    return p.stdout.strip()

def docker(*args, **kw):
    return run(['docker', *args], **kw)

def dc(*args, **kw):
    # Never accept project/path/target overrides from a shell environment.
    env = {k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_', 'AIA_'))}
    from wizard_release import active
    release=active(STATE,KIT)
    env_file=Path(release['composeEnv']) if release else STATE/'compose.env'
    return docker('compose','--project-name',PROJECT,'--env-file',str(env_file),
        '-f',str(REPO/'infra/production/compose.yaml'),'-f',str(REPO/'infra/production/compose.staging.yaml'),'-f',str(KIT/'compose.vps.yaml'),*args,env=env,**kw)

def marker(name):
    put(STATE/(name+'.json'), {'completedAt':stamp(), 'project':PROJECT})

def need(name):
    require((STATE/(name+'.json')).exists(), 'RUN_'+name.upper()+'_FIRST')

def local_guard():
    require(STATE.is_dir() and not STATE.is_symlink(), 'PREPARE_FIRST')
    p = json.loads((STATE/'prepared.json').read_text())
    require(p == dict(project=PROJECT,database=DB,commit=COMMIT,synthetic=True,credentialsPrinted=False), 'STATE_TARGET_MISMATCH')
    v=readenv(STATE/'compose.env')
    require(v['AIA_PROJECT_NAME']==PROJECT and v['AIA_SECRETS_DIRECTORY']==str(STATE/'secrets') and v['AIA_TLS_DIRECTORY']==str(STATE/'tls') and v['AIA_BACKUP_DIRECTORY']==str(STATE/'backups'), 'COMPOSE_TARGET_CHANGED')
    require(v['AIA_HTTP_BIND_PORT']=='18880' and v['AIA_HTTPS_BIND_PORT']=='18443', 'PORT_MAPPING_CHANGED')
    for role in ('web','worker','tools'):
        e=readenv(STATE/'secrets'/(role+'.env'))
        require(e['DEPLOYMENT_ENV']=='staging' and e['NODE_ENV']=='production' and e['AIA_SYNTHETIC_DATA']=='true' and e['AIA_STAGE_PROJECT']==PROJECT, 'SYNTHETIC_GUARD_FAILED')
        require(e['SMTP_HOST']=='mailpit' and e['SMTP_PORT']=='1025' and e['SMTP_REQUIRE_TLS']=='true' and not e.get('SMTP_USER') and not e.get('SMTP_PASSWORD'), 'CAPTURE_ONLY_SMTP_REQUIRED')
        require(e['APP_ORIGIN']=='https://localhost:18443' and e['MINIO_ENDPOINT']=='https://minio:9000' and e['MINIO_PHOTOS_BUCKET']=='aia-accreditation-staging-photos', 'PRIVATE_TARGET_CHANGED')
        from urllib.parse import urlparse
        u=urlparse(e['DATABASE_URL'])
        require(u.hostname=='postgres' and u.port==5432 and u.path=='/'+DB and u.username==('aia_migrator' if role=='tools' else 'aia_'+role), 'DATABASE_TARGET_CHANGED')
    return v

def context():
    require(os.geteuid()==0, 'RUN_THIS_DOCKER_STEP_WITH_SUDO_IN_PUTTY')
    require(not os.environ.get('DOCKER_HOST') and not os.environ.get('DOCKER_CONTEXT'), 'EXPLICIT_DOCKER_OVERRIDE_FORBIDDEN')
    c=json.loads(docker('context','inspect'))[0]
    require(c['Endpoints']['docker']['Host']=='unix:///var/run/docker.sock', 'LOCAL_SYSTEM_DOCKER_REQUIRED')

def credentials():
    require(os.geteuid()!=0, 'RUN_CREDENTIALS_AS_LUKE_WITHOUT_SUDO')
    require(not (STATE/'infra.json').exists(), 'STOP_AND_REVIEW_CONFIGURATION_ROTATION_AFTER_LAUNCH')
    values={k:getpass.getpass(label) for k,label in [('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','Clerk DEVELOPMENT publishable key (hidden): '),('CLERK_SECRET_KEY','Clerk DEVELOPMENT secret key (hidden): '),('CLERK_WEBHOOK_SIGNING_SECRET','Clerk development endpoint signing secret (hidden): ')]}
    require(bool(re.fullmatch(r'pk_test_[A-Za-z0-9_=\-]+',values['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'])) and bool(re.fullmatch(r'sk_test_[A-Za-z0-9_\-]+',values['CLERK_SECRET_KEY'])) and bool(re.fullmatch(r'whsec_[A-Za-z0-9+/=_\-]+',values['CLERK_WEBHOOK_SIGNING_SECRET'])), 'DEVELOPMENT_CLERK_KEYS_REQUIRED')
    for role in ('web','worker','tools'):
        p=STATE/'secrets'/(role+'.env'); envput(p,{**readenv(p),**values})
    print('CLERK_CONFIGURED: values stored privately. Build with this same publishable key.')

def materials(root=None):
    # Same file selection and JSON serialization as scripts/lib/release-materials.ts.
    root=Path(root) if root is not None else REPO
    ignored={'node_modules','.git','.impeccable','deployment','dist','generated','test-results','playwright-report'}
    files=[]
    for base in ('apps','packages','infra','scripts','tests'):
        for directory,dirs,names in os.walk(root/base):
            dirs[:]=[n for n in dirs if n not in ignored and not n.startswith(('.next','.candidate-','.env'))]
            files += [Path(directory)/n for n in names if n not in ignored and not n.startswith(('.next','.candidate-','.env')) and not n.endswith(('.log','.tsbuildinfo')) and not (Path(directory)/n).is_symlink()]
    files += [root/n for n in ('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.tests.json','vitest.config.ts','eslint.config.mjs','.dockerignore')]
    entries=[{'path':str(p.relative_to(root)), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(files,key=str)]
    return {'sourceSha':hashlib.sha256(json.dumps(entries,separators=(',',':')).encode()).hexdigest(),'files':entries}

def kit_materials():
    privacy=KIT/'review/privacy-ui'
    fixed=KIT/'review/privacy-ui-v2'
    events=KIT/'review/event-ui'
    return {str(p.relative_to(KIT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted([KIT/'prepare.py',KIT/'deploy.py',KIT/'aistor.py',KIT/'wizard_release.py',KIT/'wizard-release-baseline.json',KIT/'privacy_release.py',KIT/'privacy-release-baseline.json',KIT/'privacy-logger-fix-baseline.json',KIT/'events-release-baseline.json',KIT/'events_release.py',events/'release.json',events/'checks.mjs',events/'cleanup-checks.mjs',events/'event-checks.mjs',*[p for p in (events/'overlay').rglob('*') if p.is_file()],privacy/'release.json',privacy/'checks.mjs',privacy/'cleanup-checks.mjs',*[p for p in (privacy/'overlay').rglob('*') if p.is_file()],fixed/'release.json',fixed/'checks.mjs',fixed/'cleanup-checks.mjs',*[p for p in (fixed/'overlay').rglob('*') if p.is_file()],KIT/'aistor-upgrade-baseline.json',KIT/'aistor-typeerror-baseline.json',KIT/'maintenance-mount-baseline.json',KIT/'storage-diagnostics-baseline.json',KIT/'bucket-name-fix-baseline.json',KIT/'compose.vps.yaml',*list((KIT/'runtime').glob('*.ts')),*list((KIT/'runtime').glob('*.sh')),*list((KIT/'runtime').glob('*.mjs'))])}

def build():
    check_repo(); e=readenv(STATE/'secrets/web.env')
    require(e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].startswith('pk_test_') and e['CLERK_SECRET_KEY'].startswith('sk_test_'), 'CONFIGURE_CLERK_FIRST')
    require(not (STATE/'infra.json').exists(), 'BUILD_IS_FIRST_DEPLOYMENT_ONLY_REVIEW_UPGRADES_SEPARATELY')
    m=materials(); admin=STATE/'storage-admin'
    receipt=admin/'receipt.json'
    valid=False
    if receipt.exists() and (admin/'mc').exists():
        r=json.loads(receipt.read_text()); valid=r.get('goImage')==GO and r.get('module')==MC and r.get('sha256')==hashlib.sha256((admin/'mc').read_bytes()).hexdigest()
    if not valid:
        # Retain the exited utility builder; no --rm or automatic cleanup.
        docker('run','--name',PROJECT+'-mc-build-'+stamp(),'--network','bridge','--cpus','2','--memory','1536m','--mount',f'type=bind,source={admin},target=/out','-e','GOBIN=/out','-e','GOMAXPROCS=2','-e','CGO_ENABLED=0',GO,'go','install',MC,log='storage-admin-build.log')
        put(receipt,dict(goImage=GO,module=MC,sha256=hashlib.sha256((admin/'mc').read_bytes()).hexdigest()))
    put(STATE/'materials.json',m)
    buildenv={**os.environ,'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],'AIA_SOURCE_SHA':m['sourceSha'],'DOCKER_BUILDKIT':'1'}
    images={}
    for role in ('web','worker','tools'):
        print('BUILDING '+role+'; protected log: '+str(STATE/'logs'/('build-'+role+'.log')),flush=True)
        tag=PROJECT+'/'+role+':'+m['sourceSha'][:12]
        docker('build','--file','infra/production/Dockerfile','--target',role,'--build-context','storage-admin='+str(admin),'--build-arg','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','--build-arg','AIA_SOURCE_SHA','--label','org.opencontainers.image.revision='+m['sourceSha'],'--tag',tag,'.',env=buildenv,log='build-'+role+'.log')
        image=json.loads(docker('image','inspect',tag))[0]
        require(image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==m['sourceSha'], 'SOURCE_LABEL_MISMATCH')
        images[role]={'id':image['Id'],'tag':tag,'sourceLabel':m['sourceSha']}
    require(materials()==m,'SOURCE_CHANGED_DURING_BUILD')
    v=readenv(STATE/'compose.env')
    for role,item in images.items(): v['AIA_'+role.upper()+'_IMAGE']=item['id']
    envput(STATE/'compose.env',v)
    put(STATE/'images.json',{'commit':COMMIT,'sourceSha':m['sourceSha'],'images':images,'publicKeyHash':hashlib.sha256(e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].encode()).hexdigest(),'deploymentKit':kit_materials()})
    put(STATE/'release-manifest.json',dict(environment='staging',project=PROJECT,composeEnv=str(STATE/'compose.env'),sourceSha=m['sourceSha'],target=dict(environment='staging',host='postgres',port=5432,database=DB),synthetic=True))
    marker('build'); print('BUILD_PASSED: all three local images pinned by immutable image ID.')

def storage(args):
    require(not (STATE/'infra.json').exists(), 'STORAGE_SELECTION_LOCKED_AFTER_INFRA_START')
    require(args.image and re.fullmatch(r'[a-zA-Z0-9./_:\-]+@sha256:[a-f0-9]{64}',args.image), 'SUPPORTED_REGISTRY_DIGEST_REQUIRED')
    require('14cea493d9a34af32' not in args.image and not re.search(r'(^|/)(minio/minio)(:|@)',args.image), 'UNMAINTAINED_COMMUNITY_MINIO_FORBIDDEN')
    require('/aistor/' not in args.image, 'AISTOR_REQUIRES_REVIEWED_LICENSE_ENTRYPOINT_AND_CLIENT_ADAPTER_BEFORE_SELECTION')
    require(args.reference and len(args.reference)>10 and args.compatibility=='REVIEWED_COMPOSE_COMPATIBLE','SUPPORT_AND_COMPOSE_COMPATIBILITY_REVIEW_REQUIRED')
    # Explicit prerequisite pull; compose.staging.yaml remains pull_policy: never.
    docker('pull',args.image,log='storage-pull.log')
    docker('run','--name',PROJECT+'-storage-probe-'+stamp(),'--network','none','--read-only','--user','1000:1000','--entrypoint','/bin/sh',args.image,'-c','command -v minio >/dev/null && command -v curl >/dev/null && minio --version',log='storage-probe.log')
    v=readenv(STATE/'compose.env'); v['AIA_MINIO_IMAGE']=args.image; envput(STATE/'compose.env',v)
    put(STATE/'storage-review.json',dict(image=args.image,supportReference=args.reference,composeCompatibility=args.compatibility,reviewedAt=stamp()))
    print('STORAGE_SELECTED: pinned image present locally; service/API acceptance still required.')

def permissions():
    need('build')
    cfg=json.loads(dc('--profile','maintenance','config','--format','json')); redis=cfg['services']['redis']['image']
    docker('pull',redis,log='redis-pull.log')
    ids=docker('run','--name',PROJECT+'-redis-uid-'+stamp(),'--network','none','--entrypoint','sh',redis,'-c','id -u redis; id -g redis',log='redis-uid.log').splitlines()
    require(len(ids)==2 and all(x.isdigit() for x in ids), 'REDIS_UID_LOOKUP_FAILED')
    uid,gid=map(int,ids)
    require(os.stat('/home/luke').st_uid==1000,'EXPECTED_LUKE_UID_1000')
    for f in (STATE/'secrets').iterdir():
        os.chown(f,1000,1000); f.chmod(0o400)
    for n in ('redis-password','redis.acl'):
        os.chown(STATE/'secrets'/n,uid,gid)
    for n in ('ingress-site.conf','proxy-auth.conf'):
        os.chown(STATE/'secrets'/n,101,101)
    for f in (STATE/'tls').rglob('*'):
        if f.is_file(): os.chown(f,1000,1000); f.chmod(0o400 if f.suffix=='.key' else 0o444)
    for n in ('redis.crt','redis.key'): os.chown(STATE/'tls'/n,uid,gid)
    for n in ('ingress.crt','ingress.key'): os.chown(STATE/'tls'/n,101,101)
    # Parent directories stay 0700; certificate copies alone may be host-readable.
    marker('permissions'); print('PERMISSIONS_PASSED: service-specific Linux UID ownership; host private directories remain 0700.')

def validate():
    need('build'); need('permissions')
    v=local_guard(); require(bool(v['AIA_MINIO_IMAGE']) and (STATE/'storage-review.json').exists(),'SUPPORTED_MINIO_IMAGE_NOT_SELECTED')
    from wizard_release import active
    check_repo(); release=active(STATE,KIT)
    m=release['build'] if release else json.loads((STATE/'images.json').read_text())
    actual=materials(release['source']) if release else materials()
    require(actual['sourceSha']==m['sourceSha'],'BUILT_SOURCE_CHANGED')
    if (STATE/'aistor-adapter.json').exists():
        from aistor import adapter_guard
        adapter_guard()
    else:
        require(kit_materials()==m['deploymentKit'],'DEPLOYMENT_KIT_CHANGED_AFTER_BUILD')
    require(hashlib.sha256(readenv(STATE/'secrets/web.env')['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].encode()).hexdigest()==m['publicKeyHash'],'CLERK_PUBLIC_KEY_REQUIRES_REBUILD')
    cfg=json.loads(dc('--profile','maintenance','config','--format','json'))
    require(cfg['name']==PROJECT,'PROJECT_MISMATCH')
    for role in ('web','worker','tools'):
        service=cfg['services'][role]; image=json.loads(docker('image','inspect',service['image']))[0]
        require(service['image']==m['images'][role]['id'] and image['Config']['Labels']['org.opencontainers.image.revision']==m['sourceSha'],'IMMUTABLE_MATCHING_RELEASE_REQUIRED')
        require(image['Config']['User'] in ('node','aia','1000','1000:1000'),'NONROOT_IMAGE_REQUIRED')
        require(service.get('read_only',False) is (role!='tools') and int(service['mem_limit'])>0 and service['cpus']>0 and not service.get('ports') and not service.get('privileged'),'APP_ISOLATION_REQUIRED')
        require('ALL' in service['cap_drop'] and 'no-new-privileges:true' in service['security_opt'],'APP_PRIVILEGE_REDUCTION_REQUIRED')
    for role in ('postgres','redis','minio'): require(not cfg['services'][role].get('ports'),'BACKEND_PORT_FORBIDDEN')
    for role in ('ingress','mailpit'):
        require(all(p['host_ip']=='127.0.0.1' for p in cfg['services'][role]['ports']),'LOOPBACK_BIND_REQUIRED')
    require(cfg['networks']['backend']['internal'],'INTERNAL_BACKEND_REQUIRED')
    require(cfg['services']['minio']['pull_policy']=='never','MINIO_MUST_ALREADY_BE_LOCAL')
    from aistor import LICENSE,CLIENT
    require(cfg['secrets']['minio_license']['file']==str(LICENSE),'LICENSE_SOURCE_CHANGED')
    require(cfg['services']['minio']['command']==['server','/data','--address',':9000','--console-address','127.0.0.1:9001','--certs-dir','/run/minio-certs','--license','/run/secrets/minio_license'],'AISTOR_COMMAND_CHANGED')
    require(cfg['services']['minio']['entrypoint']==['/bin/sh','/run/aia/aistor-entrypoint.sh'],'AISTOR_SECRET_ENTRYPOINT_CHANGED')
    require(cfg['services']['minio']['user']=='1000:1000','AISTOR_UID_CHANGED')
    mounts=cfg['services']['tools']['volumes']
    require(any(x.get('source')==str(CLIENT) and x.get('target')=='/usr/local/bin/mc' and x.get('read_only') for x in mounts),'ALIGNED_AISTOR_CLIENT_MOUNT_REQUIRED')
    require(any(x.get('source')==str(KIT/'runtime') and x.get('target')=='/app/staging-scripts' and x.get('read_only') for x in mounts),'STAGING_ADAPTER_DIRECTORY_MOUNT_REQUIRED')
    require(not any(x.get('target','').startswith('/app/scripts/') for x in mounts),'NESTED_READONLY_SCRIPT_MOUNT_FORBIDDEN')
    for script in ('bootstrap.ts','acceptance.ts','check.ts','webhook.ts','admin.ts','storage.ts'):
        require((KIT/'runtime'/script).is_file(),'STAGING_ADAPTER_SOURCE_MISSING')
    for group in ('volumes','networks'):
        require(all(not x.get('external') and x['name'].startswith(PROJECT+'_') for x in cfg[group].values()),'RESOURCE_NAMESPACE_REQUIRED')
    for role,s in cfg['services'].items():
        require(not s.get('container_name') and s.get('restart','no')=='no','UNEXPECTED_CONTAINER_NAME_OR_AUTORESTART')
    docker('image','inspect',v['AIA_MINIO_IMAGE'])
    for n in ('postgres','redis','ingress','minio','mailpit'):
        run(['openssl','verify','-CAfile',str(STATE/'tls/ca.crt'),str(STATE/'tls'/(n+'.crt'))])
        run(['openssl','x509','-checkend','86400','-noout','-in',str(STATE/'tls'/(n+'.crt'))])
    put(STATE/'validated-compose.json',cfg)
    marker('validate'); print('VALIDATION_PASSED: immutable images, scope, isolation, TLS, budgets and capture-only SMTP.')

def tool(script, *args, extra=()):
    if script.startswith('scripts/vps-staging-'):
        name=script.removeprefix('scripts/vps-staging-')
        require(name in ('bootstrap.ts','acceptance.ts','check.ts','webhook.ts','admin.ts','storage.ts'),'UNKNOWN_STAGING_ADAPTER')
        script='/app/staging-scripts/'+name
    name=PROJECT+'-job-'+stamp()
    dc('--profile','maintenance','run','--no-deps','--name',name,'-T',*extra,'tools','node','node_modules/tsx/dist/cli.mjs',script,*args,log=name+'.log')
    print('TOOL_PASSED '+script+'; retained container '+name)

def storage_report():
    # Render only the sanitized operation schema, never raw job/CLI logs.
    report=STATE/'backups/storage-check.json'
    if not report.exists():return
    value=json.loads(report.read_text())
    for r in value.get('operations',[]):
        if not isinstance(r,dict) or r.get('role') not in ('admin','web','worker') or r.get('status') not in ('PASS','FAIL','BLOCKED'):continue
        if not all(re.fullmatch('[A-Z_]{2,80}',r.get(k,'')) for k in ('stage','operation')):continue
        safe={k:r[k] for k in ('stage','operation','role','status')}
        # Runtime emitter uses a finite code allowlist. Repeat a finite check at display.
        schema=(KIT/'runtime/storage-diagnostics.mjs').read_text()
        codes=set(re.findall(r"'([A-Za-z][A-Za-z0-9_]+)'",schema.split('export const ASSERTIONS')[0]))
        if r.get('code') in codes:safe['code']=r['code']
        assertions=set(re.findall(r"'([A-Z_]+)'",schema.split('export const ASSERTIONS')[1].split('export function check')[0]))
        if r.get('assertion') in assertions:safe['assertion']=r['assertion']
        if r.get('returnedVersionIdUsed') is True:safe['returnedVersionIdUsed']=True
        if r.get('versionIdKind') in ('null-version','version-id'):safe['versionIdKind']=r['versionIdKind']
        if type(r.get('httpStatus')) is int and 100<=r['httpStatus']<=599:safe['httpStatus']=r['httpStatus']
        if type(r.get('exitCode')) is int:safe['exitCode']=r['exitCode']
        if r.get('classification') in (1,2,3,4):safe['classification']=r['classification']
        print(json.dumps(safe,separators=(',',':')))

def status():
    print(dc('ps','-a'))

def healthy(services):
    for service in services:
        ids=dc('ps','-q',service).splitlines(); require(len(ids)==1,'MISSING_SERVICE_'+service)
        container=json.loads(docker('inspect','--format','{{json .}}',ids[0])); state=container['State']
        labels=container['Config']['Labels']
        require(labels.get('com.docker.compose.project')==PROJECT and labels.get('com.docker.compose.service')==service,'CONTAINER_SCOPE_MISMATCH')
        expected=json.loads(dc('--profile','maintenance','config','--format','json'))['services'][service]['image']
        require(container['Image']==json.loads(docker('image','inspect',expected))[0]['Id'],'RUNNING_IMAGE_MISMATCH_'+service)
        require(state.get('Running') and state.get('Health',{}).get('Status')=='healthy','UNHEALTHY_'+service)

def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['credentials','host','build','storage','aistor-prepare','storage-check','permissions','validate','infra','bootstrap','migration-preflight','migrate','grants','start','check','admin','acceptance','webhook','status','stop','logs'])
    p.add_argument('--image'); p.add_argument('--reference'); p.add_argument('--compatibility')
    args=p.parse_args(); local_guard()
    if args.action=='credentials': credentials(); return
    context()
    if args.action=='host':
        check_repo(); ports()
        print('UTC '+datetime.datetime.now(datetime.timezone.utc).isoformat())
        print(docker('version','--format','Server {{.Server.Version}}'))
        print(docker('compose','version')); docker('buildx','version')
        info=json.loads(docker('info','--format','{{json .}}'))
        require(info['MemTotal']>=7*1024**3,'HOST_RAM_BELOW_EXPECTED_8GIB')
        require(shutil.disk_usage(info['DockerRootDir']).free>=20*1024**3,'DOCKER_NEEDS_20GIB_FREE_FOR_FIRST_BUILD')
        print('HOST_PASSED: local Docker/Compose/Buildx; ports free now; >=7 GiB RAM; >=20 GiB free.')
    elif args.action=='build': build()
    elif args.action=='storage': storage(args)
    elif args.action=='aistor-prepare':
        from aistor import prepare_storage
        prepare_storage()
    elif args.action=='storage-check':
        need('infra'); validate(); healthy(('postgres','redis','minio'))
        try:
            tool('scripts/vps-staging-storage.ts')
        except RuntimeError:
            storage_report()
            evidence_file=STATE/'backups/storage-check.json'
            if evidence_file.exists():
                evidence=json.loads(evidence_file.read_text())
                failed=evidence.get('failedStep','')
                if re.fullmatch('[A-Z_]{3,80}',failed):
                    first=next((r for r in evidence.get('operations',[]) if r.get('status')=='FAIL'),{})
                    print('STORAGE_CHECK_FAILED_'+failed+('_PAID_TIER_REQUIRED' if first.get('classification')==3 else ''))
            raise
        storage_report();marker('storage-check')
        print('STORAGE_CHECK_PASSED: actual license, aligned client, private scoped S3, conditional writes and exact app erasure verified.')
    elif args.action=='permissions': permissions()
    elif args.action=='validate': validate()
    elif args.action=='infra':
        validate(); ports()
        if not (STATE/'infra-attempt.json').exists():
            require(not docker('ps','-aq','--filter','label=com.docker.compose.project='+PROJECT),'FIRST_DEPLOYMENT_PROJECT_ALREADY_HAS_CONTAINERS')
            # Retained isolated build/probe containers use the same prefix; only
            # service-name collisions would be adopted by Compose.
            service_names='(web|worker|postgres|redis|minio|ingress|tools|mailpit|storage-volume-init)'
            require(not docker('ps','-aq','--filter','name=^/'+PROJECT+'-'+service_names+'-[0-9]+$'),'FIRST_DEPLOYMENT_CONTAINER_NAME_COLLISION')
            require(not docker('volume','ls','-q','--filter','name=^'+PROJECT+'_'),'FIRST_DEPLOYMENT_PROJECT_ALREADY_HAS_VOLUMES')
            require(not docker('network','ls','-q','--filter','name=^'+PROJECT+'_'),'FIRST_DEPLOYMENT_PROJECT_ALREADY_HAS_NETWORKS')
            marker('infra-attempt')
        dc('up','-d','--no-recreate','--wait','--wait-timeout','180','postgres','redis','minio','mailpit',log='infra.log')
        healthy(('postgres','redis','minio')); marker('infra'); print('INFRA_PASSED: isolated dependencies running. No schema migration yet.')
    elif args.action=='bootstrap':
        need('infra'); need('storage-check'); require(not (STATE/'bootstrap.json').exists(),'BOOTSTRAP_ALREADY_COMPLETED_DO_NOT_RERUN')
        tool('scripts/vps-staging-bootstrap.ts'); marker('bootstrap')
    elif args.action in ('migration-preflight','migrate'):
        need('bootstrap'); healthy(('postgres','redis','minio'))
        if args.action=='migrate': need('migration-preflight')
        tool('scripts/migrate.ts',*(['--preflight'] if args.action=='migration-preflight' else []))
        marker(args.action)
    elif args.action=='grants':
        need('migrate'); tool('scripts/vps-staging-bootstrap.ts','grants'); marker('grants')
    elif args.action=='start':
        need('grants'); validate(); healthy(('postgres','redis','minio'))
        tool('scripts/vps-staging-check.ts','configuration')
        dc('up','-d','--no-recreate','--no-deps','--wait','--wait-timeout','120','web','worker',log='start-app.log')
        dc('up','-d','--no-recreate','--no-deps','--wait','--wait-timeout','90','ingress',log='start-ingress.log')
        healthy(('web','worker','ingress')); marker('start'); print('START_PASSED: private ingress ready; no public exposure.')
    elif args.action=='check':
        healthy(('postgres','redis','minio','web','worker','ingress')); tool('scripts/vps-staging-check.ts')
        run(['curl','--fail','--silent','--show-error','--cacert',str(STATE/'tls/ca.crt'),'https://localhost:18443/api/health/ready'],log='ingress-ready.log')
        marker('check'); print('READINESS_PASSED: web, worker, TLS ingress, restricted DB roles and Mailpit.')
    elif args.action=='admin':
        need('check'); user=getpass.getpass('Synthetic Clerk development admin user ID (hidden): ')
        require(bool(re.fullmatch(r'user_[A-Za-z0-9]+',user)),'INVALID_CLERK_USER_ID')
        tool('scripts/vps-staging-admin.ts',extra=('-e','CLERK_ADMIN_USER_ID='+user,'-e','ADMIN_BOOTSTRAP_CONFIRM=CREATE_VERIFIED_ADMIN'))
    elif args.action=='acceptance':
        need('check'); tool('scripts/vps-staging-acceptance.ts'); marker('acceptance')
    elif args.action=='webhook':
        need('check'); tool('scripts/vps-staging-webhook.ts'); marker('webhook')
    elif args.action=='status': status()
    elif args.action=='stop':
        # Scoped graceful stop only; preserve every container, volume and network.
        dc('stop','--timeout','60',log='stop.log'); print('STOPPED: only '+PROJECT+'; all data and containers retained.')
    elif args.action=='logs':
        put(STATE/'logs/service-tail.log',dc('logs','--tail','100','--no-color')); print('Saved protected logs/service-tail.log (not printed).')

def report_failure(error):
    # No exception text/arguments, source lines, locals, command arguments or
    # environment values: any of those can contain passwords or license data.
    code=type(error).__name__
    if isinstance(error,RuntimeError) and re.fullmatch(r'[A-Z][A-Z0-9_]{3,160}',str(error)):
        code=str(error)
    frames=[]
    for frame,line in traceback.walk_tb(error.__traceback__):
        try: filename=str(Path(frame.f_code.co_filename).resolve().relative_to(KIT))
        except ValueError: filename='[external]'
        frames.append(dict(file=filename,function=frame.f_code.co_name,line=line))
    report=dict(code=code,exceptionType=type(error).__name__,traceback=frames,redaction='Exception text, source lines, locals, arguments and environment omitted')
    path=STATE/'logs'/('failure-'+stamp()+'.json')
    try:
        path.parent.mkdir(mode=0o700,exist_ok=True)
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w',encoding='utf8') as f:
            f.write(json.dumps(report,indent=2)+'\n')
    except OSError:
        path=None
    print('STOP: '+code)
    print('Sanitized traceback: '+str(path) if path else 'Protected traceback could not be written.')
    return path

if __name__=='__main__':
    try: main()
    except Exception as e:
        report_failure(e)
        sys.exit(1)
