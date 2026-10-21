#!/usr/bin/env python3
"""OPERATOR ONLY. Fixed production project; never invokes sudo, Nginx, firewall or systemd.
Every action requires an explicit approval entry. No arbitrary compose passthrough.
"""
import argparse, datetime, fcntl, getpass, hashlib, ipaddress, json, os, platform, re, shutil, subprocess, urllib.request
from common import KIT, STATE, REPO, PROJECT, COMMIT, MATERIAL, DB, require, put, envput, readenv, approved, safe_main, operation_lock
from audit import materials

STORAGE_OPS_SHA='f046d8cb976b09475d4879560241ada1a76d934662dbc12590372f90fb846103'
SERVICES=['web','worker','postgres','redis','minio','ingress']
MC_URL='https://dl.min.io/aistor/mc/release/linux-amd64/mc.RELEASE.2026-09-19T15-24-59Z'
MC_SHA='83938eded435e7c28c397ece1dc590b2a79626dd9354aae2107060fec559ae2b'
def stamp():return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
def run(argv,*,env=None,timeout=900,capture=True,input=None):
    r=subprocess.run(argv,env=env,cwd=KIT,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
    # Raw subprocess diagnostics are deliberately withheld, including build/migration provider errors.
    # Never write an exception, environment dump, raw SMTP or mc output to a transcript.
    if r.returncode:
        print(json.dumps({'code':'OPERATOR_SUBPROCESS_FAILED','program':argv[0].split('/')[-1],'exitCode':r.returncode}))
        raise RuntimeError('SUBPROCESS_FAILED_DETAILS_SUPPRESSED')
    return r.stdout.strip()
def docker(*args):
    e={k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','DOCKER_','AIA_','CLERK_','SMTP_'))}
    return run(['docker','--host','unix:///var/run/docker.sock',*args],env=e)
def resource_preflight(phase):
    # Read-only fresh inventory: account for resident production/staging once.
    return run(['python3',str(KIT/'scripts/resource_check.py'),'--phase',phase,'--live'])
def dc(*args):return docker('compose','--project-name',PROJECT,'--env-file',str(STATE/'compose.env'),'-f',str(KIT/'compose.yaml'),*args)
def receipt(action,data=None):
    put(STATE/(action+'-'+stamp()+'.json'),{'action':action,'project':PROJECT,'commit':COMMIT,'material':MATERIAL,'at':stamp(),**(data or {})})
def evidence(file):
    p=STATE/file;require(p.is_file(),'REQUIRED_EVIDENCE_MISSING');return json.loads(p.read_text())
def cfg():
    c=json.loads(dc('--profile','maintenance','config','--format','json'))
    require(c['name']==PROJECT,'COMPOSE_PROJECT_MISMATCH');return c
def healthy(names):
    for name in names:
        ids=dc('ps','-q',name).splitlines();require(len(ids)==1,'EXPECTED_ONE_SERVICE_CONTAINER')
        x=json.loads(docker('inspect',ids[0]))[0]
        require(x['Config']['Labels'].get('com.docker.compose.project')==PROJECT,'CONTAINER_SCOPE_MISMATCH')
        require(x['Config']['Labels'].get('com.docker.compose.service')==name,'SERVICE_SCOPE_MISMATCH')
        require(x['State']['Running'] and x['State'].get('Health',{}).get('Status')=='healthy' and not x['State'].get('OOMKilled'),'SERVICE_NOT_HEALTHY')
def tool(service,script,*args,extra=()):
    require(service in ['tools','provision','backup','monitor','admin','privacy'],'UNKNOWN_MAINTENANCE_ROLE')
    require(script in ['scripts/migrate.ts','scripts/monitor.ts','/app/reviewed-production-ops/client-check.mjs','/app/production-ops/provision.ts','/app/reviewed-production-ops/storage.ts','/app/production-ops/configuration.ts','/app/production-ops/admin.ts','/app/production-ops/smtp-smoke.ts','/app/production-ops/backup.ts','/app/production-ops/privacy-execute.ts'],'UNKNOWN_MAINTENANCE_SCRIPT')
    resource_preflight('backup' if service=='backup' else 'maintenance')
    name=PROJECT+'-'+service+'-job-'+stamp()
    receipt('job-attempt',{'service':service,'containerName':name})
    try:
        out=dc('--profile','maintenance','run','--name',name,'--no-deps','-T',*extra,service,'node','node_modules/tsx/dist/cli.mjs',script,*args)
    except Exception:
        # A timed-out Docker client can leave the one-shot container running. Stop only
        # this named, label-verified job before allowing writers to resume.
        ids=docker('ps','-aq','--filter','name=^/'+name+'$').splitlines()
        if ids:
            x=json.loads(docker('inspect',ids[0]))[0]
            require(x['Config']['Labels'].get('com.docker.compose.project')==PROJECT and x['Config']['Labels'].get('com.docker.compose.service')==service,'JOB_SCOPE_MISMATCH_KEEP_WRITERS_STOPPED')
            docker('stop','--time','60',name)
            require(not docker('ps','-q','--filter','name=^/'+name+'$'),'JOB_STILL_RUNNING_KEEP_WRITERS_STOPPED')
        raise
    # Runtime helpers guarantee code/boolean-only output. Migration/monitor output stays private.
    if script.startswith(('/app/production-ops/','/app/reviewed-production-ops/')):print(out)
    return out
def source_export():
    require(not run(['git','-C',str(REPO),'status','--porcelain=v1'],env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'}),'CLEAN_REPOSITORY_REQUIRED_AFTER_INDEX_REPAIR')
    from release_source import export_reviewed
    m=export_reviewed(STATE/'source')
    put(STATE/'source-manifest.json',m)
    receipt('source-export',{'files':len(m['files'])})
def verify_export():
    m=evidence('source-manifest.json');require(m['sourceMaterialSha256']==MATERIAL,'SOURCE_MANIFEST_CHANGED')
    for e in m['files']:require(hashlib.sha256((STATE/'source'/e['path']).read_bytes()).hexdigest()==e['sha256'],'EXPORTED_SOURCE_CHANGED')
def validate():
    verify_export();v=readenv(STATE/'compose.env');c=cfg();m=evidence('images.json')
    require(m['material']==MATERIAL and m['commit']==COMMIT,'IMAGE_RELEASE_MISMATCH')
    require(m.get('operationsMaterialSha256')==STORAGE_OPS_SHA,'REVIEWED_STORAGE_OPERATIONS_RECEIPT_REQUIRED')
    for name in ['web','worker','tools']:
        image=c['services'][name]['image'];require(re.fullmatch('sha256:[a-f0-9]{64}',image),'IMMUTABLE_LOCAL_IMAGE_ID_REQUIRED')
        i=json.loads(docker('image','inspect',image))[0]
        if name=='tools':require(i['Config']['Labels'].get('org.aia.storage-provisioning.sha256')==STORAGE_OPS_SHA,'REVIEWED_STORAGE_OPERATIONS_IMAGE_REQUIRED')
        require(i['Id']==m['images'][name]['id'] and i['Config']['Labels']['org.opencontainers.image.revision']==MATERIAL,'IMAGE_PROVENANCE_MISMATCH')
        require(i['Config']['User'] in ['node','aia','1000','1000:1000'],'NONROOT_APP_IMAGE_REQUIRED')
    require(re.fullmatch('quay.io/minio/aistor/minio@sha256:[a-f0-9]{64}',v['AIA_MINIO_IMAGE']),'PINNED_AISTOR_REQUIRED')
    docker('image','inspect',v['AIA_MINIO_IMAGE'])
    for name in ['postgres','redis','minio','web','worker']:require(not c['services'][name].get('ports'),'PUBLIC_SERVICE_PORT_FORBIDDEN')
    require(all(p['host_ip']=='127.0.0.1' for p in c['services']['ingress']['ports']),'ONLY_LOOPBACK_INGRESS_ALLOWED')
    for group in ['networks','volumes']:
        for value in c[group].values():require(not value.get('external') and value['name'].startswith(PROJECT+'_'),'RESOURCE_NAMESPACE_MISMATCH')
    require(c['networks']['backend']['internal'],'INTERNAL_BACKEND_REQUIRED')
    for name,s in c['services'].items():
        require(
            not s.get('privileged')
            and not s.get('container_name')
            and (
                not s.get('network_mode')
                or (
                    name == 'storage-volume-init'
                    and s.get('network_mode') == 'none'
                )
            ),
            'UNEXPECTED_PRIVILEGE_OR_NAMESPACE'
        )
        require(int(s['mem_limit'])>0 and float(s['cpus'])>0,'RESOURCE_CAP_REQUIRED')
    for name in ['web','worker','tools','admin','monitor','backup']:
        s=c['services'][name];require('ALL' in s['cap_drop'] and 'no-new-privileges:true' in s['security_opt'],'APPLICATION_PRIVILEGE_REDUCTION_REQUIRED')
    for name in ['web','worker']:
        e=readenv(STATE/'secrets'/(name+'.env'))
        require(e['DEPLOYMENT_ENV']=='production' and e['APP_ORIGIN']=='https://app.joinaia.pt','PRODUCTION_RUNTIME_REQUIRED')
        require(not any(e.get(k) for k in ['AIA_SYNTHETIC_DATA','CLERK_TESTING_TOKEN','TEST_DATABASE_URL','MIGRATION_DATABASE_URL','BACKUP_DATABASE_URL','PRIVACY_DATABASE_URL']),'PRIVILEGED_OR_TEST_RUNTIME_FORBIDDEN')
        require(hashlib.sha256(e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].encode()).hexdigest()==m['publicKeyHash'],'PUBLIC_KEY_REBUILD_REQUIRED')
    for name in ['postgres','redis','ingress','minio']:
        run(['openssl','verify','-CAfile',str(STATE/'tls/ca.crt'),str(STATE/'tls'/(name+'.crt'))]);run(['openssl','x509','-checkend','1209600','-noout','-in',str(STATE/'tls'/(name+'.crt'))])
    print('STATIC_LOCAL_RELEASE_VALIDATED_RUNTIME_ACCEPTANCE_PENDING')
def host_check():
    require(platform.machine()=='x86_64','PINNED_CLIENT_REQUIRES_AMD64')
    require(not run(['ss','-H','-ltn','( sport = :18881 or sport = :18444 )']),'PRODUCTION_LOOPBACK_PORT_IN_USE')
    routes=json.loads(run(['ip','-j','-4','route','show','table','all']))
    candidate=ipaddress.ip_network('172.31.219.0/28')
    for r in routes:
        if r.get('dst') and r['dst']!='default':
            try:net=ipaddress.ip_network(r['dst'],strict=False)
            except ValueError:continue
            require(not candidate.overlaps(net),'CANDIDATE_BRIDGE_SUBNET_OVERLAPS_ROUTE')
    require(not docker('ps','-aq','--filter','label=com.docker.compose.project='+PROJECT),'PRODUCTION_CONTAINERS_ALREADY_EXIST_INSPECT_FIRST')
    require(not docker('volume','ls','-q','--filter','name=^'+PROJECT+'_'),'PRODUCTION_VOLUMES_ALREADY_EXIST_INSPECT_FIRST')
    require(not docker('network','ls','-q','--filter','name=^'+PROJECT+'_'),'PRODUCTION_NETWORKS_ALREADY_EXIST_INSPECT_FIRST')
    resource_preflight('steady');receipt('host-check');print('HOST_PREFLIGHT_PASSED_NO_INFRASTRUCTURE_CREATED')
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['export-source','host-check','build','fetch-images','validate','infra','storage-client-check','storage-provision','storage-check','database-provision','migration-preflight','migrate','grants','configuration-check','start-private','readiness','admin-bootstrap','admin-disable','smtp-smoke','monitor','backup-local','privacy-execute','privacy-evidence-expiry','stop-private']);a=p.parse_args()
    os.umask(0o077);require(STATE.is_dir(),'CONFIGURE_FIRST');review=approved(a.action)
    with operation_lock(STATE):
        if a.action=='export-source':source_export();return
        require(os.geteuid()==0,'PRIVILEGED_HOST_OPERATOR_REQUIRED')
        if a.action=='host-check':host_check();return
        if a.action=='build':
            verify_export();resource_preflight('build')
            require(not (STATE/'images.json').exists(),'IMMUTABLE_RELEASE_ALREADY_BUILT_REVIEW_NEW_CANDIDATE')
            client=STATE/'storage-admin/mc'
            if not client.exists():
                with urllib.request.urlopen(MC_URL,timeout=30) as r:client.write_bytes(r.read(64*1024*1024))
            require(hashlib.sha256(client.read_bytes()).hexdigest()==MC_SHA,'PINNED_MC_CHECKSUM_MISMATCH');client.chmod(0o755)
            e=readenv(STATE/'secrets/web.env');images={}
            for role in ['web','worker','tools']:
                tag=PROJECT+'/'+role+':'+MATERIAL[:12]
                # The only application configuration passed to BuildKit is the public Clerk key.
                env={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ};env.update(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],AIA_SOURCE_SHA=MATERIAL,DOCKER_BUILDKIT='1')
                run(['docker','--host','unix:///var/run/docker.sock','build','--file',str(STATE/'source/infra/production/Dockerfile'),'--target',role,'--build-context','storage-admin='+str(STATE/'storage-admin'),'--build-arg','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','--build-arg','AIA_SOURCE_SHA','--label','org.opencontainers.image.revision='+MATERIAL,'--tag',tag,str(STATE/'source')],env=env,timeout=3600)
                info=json.loads(docker('image','inspect',tag))[0];images[role]={'id':info['Id'],'tag':tag}
            put(STATE/'images.json',{'commit':COMMIT,'material':MATERIAL,'images':images,'publicKeyHash':hashlib.sha256(e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].encode()).hexdigest()})
            v=readenv(STATE/'compose.env');v.update({f'AIA_{r.upper()}_IMAGE':i['id'] for r,i in images.items()});(STATE/'compose.env').rename(STATE/('compose.env.before-images-'+stamp()));envput(STATE/'compose.env',v);receipt('build');print('BUILT_ALL_THREE_IMMUTABLE_IMAGES');return
        if a.action=='fetch-images':
            c=cfg()
            for role in ['postgres','redis','minio','ingress']:
                image=c['services'][role]['image'];require(re.fullmatch(r'[A-Za-z0-9./_:-]+@sha256:[a-f0-9]{64}',image),'REVIEWED_REGISTRY_DIGEST_REQUIRED');docker('pull',image)
            receipt(a.action);print('PINNED_DEPENDENCY_IMAGES_AVAILABLE_NO_CONTAINERS_STARTED');return
        if a.action=='validate':validate();return
        if a.action=='infra':
            validate();host_check();require(review.get('storageSupportReference'),'STORAGE_SUPPORT_REVIEW_REQUIRED')
            # First deployment only. A failed attempt must be inspected, never cleaned or adopted silently.
            put(STATE/'infra-attempt.json',{'at':stamp(),'project':PROJECT})
            dc('up','-d','--no-recreate','--wait','--wait-timeout','180','postgres','redis','minio');healthy(['postgres','redis','minio']);receipt('infra');return
        if a.action=='storage-client-check':
            require(review.get('storageProvisioningFixApproval')==STORAGE_OPS_SHA,'STORAGE_FIX_APPROVAL_REQUIRED')
            validate();tool('provision','/app/reviewed-production-ops/client-check.mjs');receipt(a.action);return
        if a.action in ['storage-provision','storage-check']:
            require(review.get('storageProvisioningFixApproval')==STORAGE_OPS_SHA,'STORAGE_FIX_APPROVAL_REQUIRED')
            validate()
            healthy(['minio']);tool('provision','/app/reviewed-production-ops/storage.ts','provision' if a.action=='storage-provision' else 'check');receipt(a.action);return
        if a.action=='database-provision':
            s=evidence('backups/storage-capability.json');require(s.get('project')==PROJECT and s.get('passed') is True,'EXACT_STORAGE_ERASURE_GATE_REQUIRED');healthy(['postgres']);tool('provision','/app/production-ops/provision.ts','init');receipt(a.action);return
        if a.action in ['migration-preflight','migrate']:
            require(any(STATE.glob('database-provision-*.json')),'FRESH_DATABASE_PROVISION_REQUIRED')
            if a.action=='migrate':require(any(STATE.glob('migration-preflight-*.json')),'MIGRATION_PREFLIGHT_REQUIRED')
            tool('tools','scripts/migrate.ts',*(['--preflight'] if a.action=='migration-preflight' else []));receipt(a.action);return
        if a.action=='grants':tool('provision','/app/production-ops/provision.ts','grants');receipt(a.action);return
        if a.action=='configuration-check':tool('admin','/app/production-ops/configuration.ts');receipt(a.action);return
        if a.action=='start-private':
            resource_preflight('steady')
            require(any(STATE.glob('grants-*.json')) and any(STATE.glob('configuration-check-*.json')),'GRANTS_AND_CONFIGURATION_CHECK_REQUIRED');validate();healthy(['postgres','redis','minio']);dc('up','-d','--no-recreate','--no-deps','--wait','--wait-timeout','120','web','worker');dc('up','-d','--no-recreate','--no-deps','--wait','--wait-timeout','90','ingress');healthy(SERVICES);receipt(a.action);print('PRIVATE_ONLY_HOST_NGINX_UNCHANGED');return
        if a.action=='readiness':healthy(SERVICES);run(['curl','--fail','--silent','--show-error','--cacert',str(STATE/'tls/ca.crt'),'--resolve','app.joinaia.pt:18444:127.0.0.1','-H','Host: app.joinaia.pt','https://app.joinaia.pt:18444/api/health/ready']);receipt(a.action);print('PRIVATE_TLS_READINESS_PASSED');return
        if a.action in ['admin-bootstrap','admin-disable']:
            user=getpass.getpass('Individually authorised production Clerk user ID (hidden): ');require(re.fullmatch('user_[A-Za-z0-9]+',user),'INVALID_CLERK_USER_ID')
            extra=['-e','CLERK_ADMIN_USER_ID='+user,'-e','ADMIN_BOOTSTRAP_CONFIRM='+('CREATE_VERIFIED_ADMIN' if a.action=='admin-bootstrap' else 'DISABLE_SINGLE_ADMIN'),'-e','AIA_ADMIN_APPROVAL_REFERENCE='+review['approvalReference']]
            tool('admin','/app/production-ops/admin.ts','bootstrap' if a.action=='admin-bootstrap' else 'disable',extra=extra);receipt(a.action);return
        if a.action=='smtp-smoke':
            to=getpass.getpass('Exactly one approved controlled mailbox (hidden): ');require(re.fullmatch(r'[^\s,@]+@[^\s,@]+\.[^\s,@]+',to),'INVALID_SINGLE_RECIPIENT')
            tool('admin','/app/production-ops/smtp-smoke.ts',extra=('-e','AIA_SMTP_SMOKE_RECIPIENT='+to,'-e','AIA_SMTP_SMOKE_ALLOWED_RECIPIENT='+to,'-e','AIA_SMTP_SMOKE_CONFIRM=SEND_ONE_CONTROLLED_MESSAGE'));receipt(a.action);return
        if a.action=='monitor':
            healthy(SERVICES);out=tool('monitor','scripts/monitor.ts','/run/operator-secrets/target-production.json');receipt('monitor',{'signals':json.loads(out)});print('MONITOR_SIGNALS_PASSED_ALERT_DELIVERY_SEPARATE');return
        if a.action=='backup-local':
            # Coordinated snapshot adapter requires all application writers stopped.
            resource_preflight('steady')
            healthy(SERVICES);dc('stop','--timeout','60','ingress','web','worker')
            try:
                require(not dc('ps','--status','running','-q','web','worker','ingress'),'BACKUP_WRITERS_STILL_RUNNING')
                tool('backup','/app/production-ops/backup.ts',extra=('-e','AIA_WRITERS_QUIESCED=PRODUCTION_WRITERS_STOPPED',));receipt(a.action)
            finally:
                require(not docker('ps','-q','--filter','label=com.docker.compose.project='+PROJECT,'--filter','label=com.docker.compose.service=backup'),'BACKUP_JOB_STILL_RUNNING_KEEP_WRITERS_STOPPED')
                resource_preflight('steady')
                dc('start','--wait','--wait-timeout','120','web','worker');dc('start','--wait','--wait-timeout','120','ingress')
            healthy(SERVICES);print('ENCRYPTED_LOCAL_BACKUP_ONLY_OFFSITE_AND_RESTORE_STILL_REQUIRED');return
        if a.action in ['privacy-execute','privacy-evidence-expiry']:
            job=getpass.getpass('Exact individually authorised erasure job UUID (hidden): ');require(re.fullmatch('[a-f0-9-]{36}',job),'EXACT_ERASURE_JOB_REQUIRED')
            tool('privacy','/app/production-ops/privacy-execute.ts','personal-data' if a.action=='privacy-execute' else 'evidence-expiry',extra=('-e','AIA_PRIVACY_JOB_ID='+job,'-e','AIA_PRIVACY_APPROVAL_REFERENCE='+review['approvalReference']));receipt(a.action);return
        if a.action=='stop-private':dc('stop','--timeout','60','ingress','web','worker');print('PRODUCTION_APP_STOPPED_DATA_AND_DEPENDENCIES_PRESERVED');return
if __name__=='__main__':safe_main(main)
