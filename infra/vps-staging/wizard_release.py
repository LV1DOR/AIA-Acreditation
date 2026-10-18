#!/usr/bin/env python3
"""Deploy only the reviewed wizard-link fix with existing Dockerfile/Compose; no DB changes."""
import argparse,fcntl,hashlib,json,os,re,shutil,sys
from pathlib import Path
from prepare import STATE,KIT,PROJECT,require,readenv,envput

RELEASE='wizard-links-v1'
PRIVACY_RELEASE='privacy-ui-v1'
PRIVACY_LOGGER_RELEASE='privacy-ui-v2'
EVENT_UI_RELEASE='events-ui-v1'
PRIVACY_RELEASES=(PRIVACY_RELEASE,PRIVACY_LOGGER_RELEASE,EVENT_UI_RELEASE)
TARGET='apps/web/src/app/[locale]/admin/setup/setup-view.tsx'
BEFORE='246d1ad196afcc1b987070ec216dad94f81a41aea9b83da2c1e30e20c10e6b11'
AFTER='028369907c3d2ef0ecf6b15ebc1946bf6a2dcfdea3c66b961ee902c97e4aa62f'
ROLES=('web','worker','tools')
DEPENDENCIES=('postgres','redis','minio','mailpit','ingress')
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def load(path):return json.loads(Path(path).read_text())
def save(path,value):
    """Atomic private pointer/report update; never used for secrets or original receipts."""
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temp=path.with_name(path.name+'.pending-'+str(os.getpid()))
    with temp.open('x',encoding='utf8') as f:
        os.fchmod(f.fileno(),0o600);f.write(json.dumps(value,indent=2)+'\n')
    os.replace(temp,path)
def installed_kit(state,kit,current):
    """Fold only the exact reviewed updater transition into the pre-existing guard chain."""
    event_receipt=Path(state)/'events-release-kit.json'
    if event_receipt.exists():
        previous=load(Path(kit)/'events-release-baseline.json')['deploymentKit']
        require(load(event_receipt)==dict(previousDeploymentKit=previous,deploymentKit=current),'EVENTS_RELEASE_KIT_CHANGED')
        current=previous
    fix_receipt=Path(state)/'privacy-logger-fix-kit.json'
    if fix_receipt.exists():
        previous=load(Path(kit)/'privacy-logger-fix-baseline.json')['deploymentKit']
        require(load(fix_receipt)==dict(previousDeploymentKit=previous,deploymentKit=current),'PRIVACY_LOGGER_FIX_KIT_CHANGED')
        current=previous
    privacy_receipt=Path(state)/'privacy-release-kit.json'
    if privacy_receipt.exists():
        previous=load(Path(kit)/'privacy-release-baseline.json')['deploymentKit']
        require(load(privacy_receipt)==dict(previousDeploymentKit=previous,deploymentKit=current),'PRIVACY_RELEASE_KIT_CHANGED')
        current=previous
    receipt=Path(state)/'wizard-release-kit.json'
    if not receipt.exists():return current
    baseline=load(Path(kit)/'wizard-release-baseline.json')['deploymentKit']
    require(load(receipt)==dict(previousDeploymentKit=baseline,deploymentKit=current),'WIZARD_RELEASE_KIT_CHANGED')
    return baseline
def authorize_kit(d):
    baseline=load(d.KIT/'wizard-release-baseline.json')['deploymentKit']
    privacy_baseline=d.KIT/'privacy-release-baseline.json'
    prior=load(privacy_baseline)['deploymentKit'] if privacy_baseline.exists() else d.kit_materials()
    expected=dict(previousDeploymentKit=baseline,deploymentKit=prior)
    path=d.STATE/'wizard-release-kit.json'
    if path.exists():require(load(path)==expected,'WIZARD_RELEASE_KIT_CHANGED')
    else:
        require(load(d.STATE/'bucket-name-fix.json')['deploymentKit']==baseline,'INSTALLED_WIZARD_RELEASE_BASELINE_REQUIRED')
        save(path,expected)
    if privacy_baseline.exists():
        fix_baseline=d.KIT/'privacy-logger-fix-baseline.json'
        privacy_kit=load(fix_baseline)['deploymentKit'] if fix_baseline.exists() else d.kit_materials()
        next_review=dict(previousDeploymentKit=prior,deploymentKit=privacy_kit)
        next_path=d.STATE/'privacy-release-kit.json'
        if next_path.exists():require(load(next_path)==next_review,'PRIVACY_RELEASE_KIT_CHANGED')
        else:save(next_path,next_review)
        if fix_baseline.exists():
            events_baseline=d.KIT/'events-release-baseline.json'
            logger_kit=load(events_baseline)['deploymentKit'] if events_baseline.exists() else d.kit_materials()
            fix_review=dict(previousDeploymentKit=privacy_kit,deploymentKit=logger_kit)
            fix_path=d.STATE/'privacy-logger-fix-kit.json'
            if fix_path.exists():require(load(fix_path)==fix_review,'PRIVACY_LOGGER_FIX_KIT_CHANGED')
            else:save(fix_path,fix_review)
            if events_baseline.exists():
                event_review=dict(previousDeploymentKit=logger_kit,deploymentKit=d.kit_materials())
                event_path=d.STATE/'events-release-kit.json'
                if event_path.exists():require(load(event_path)==event_review,'EVENTS_RELEASE_KIT_CHANGED')
                else:save(event_path,event_review)

def privacy_review(kit,release):
    require(release in PRIVACY_RELEASES,'UNKNOWN_ACTIVE_RELEASE')
    return Path(kit)/'review'/({PRIVACY_RELEASE:'privacy-ui',PRIVACY_LOGGER_RELEASE:'privacy-ui-v2',EVENT_UI_RELEASE:'event-ui'}[release])

def allowed_predecessor(release,previous):
    return previous is None or (release in PRIVACY_RELEASES and previous==RELEASE) or (release==PRIVACY_LOGGER_RELEASE and previous==PRIVACY_RELEASE) or (release==EVENT_UI_RELEASE and previous in (PRIVACY_RELEASE,PRIVACY_LOGGER_RELEASE))

def release_prefix(release):
    return 'EVENTS' if release==EVENT_UI_RELEASE else 'PRIVACY' if release in PRIVACY_RELEASES else 'WIZARD'

def changes_for(release,kit):
    if release==RELEASE:return [{'path':TARGET,'before':BEFORE,'after':AFTER}]
    spec=load(privacy_review(kit,release)/'release.json')
    require(spec['kind']==release and spec['migrations'] is False and spec['syntheticStagingOnly'] is True,'PRIVACY_RELEASE_SCOPE_CHANGED')
    seen=set()
    for item in spec['changes']:
        path=Path(item['path'])
        require(not path.is_absolute() and '..' not in path.parts and item['path'] not in seen,'BUILD_PATH_CHANGED')
        require(bool(re.fullmatch('[a-f0-9]{64}',item['after'])) and (item['before'] is None or bool(re.fullmatch('[a-f0-9]{64}',item['before']))),'REVIEWED_SOURCE_HASH_REQUIRED')
        seen.add(item['path'])
    require(TARGET in seen,'WIZARD_FIX_MUST_BE_PRESERVED')
    return spec['changes']
def active(state=STATE,kit=KIT):
    """Select a separate release receipt/env; original build/adapter/env remain immutable."""
    state=Path(state);pointer=state/'active-release.json'
    if not pointer.exists():return None
    value=load(pointer);require(set(value)=={'release'},'ACTIVE_RELEASE_POINTER_INVALID')
    if value['release'] is None:return None
    release=value['release'];changes=changes_for(release,kit)
    folder=state/'releases'/release
    require(not folder.is_symlink() and folder.resolve()==state.resolve()/'releases'/release,'RELEASE_PATH_CHANGED')
    m=load(folder/'release.json')
    require(m['kind']==release and m['baseImagesReceiptHash']==digest(state/'images.json'),'RELEASE_BASE_RECEIPT_CHANGED')
    require(m['source']==str(folder/'source') and m['composeEnv']==str(folder/'compose.env'),'RELEASE_PATH_CHANGED')
    require(not (folder/'source').is_symlink(),'RELEASE_PATH_CHANGED')
    if release==RELEASE:require(digest(folder/'source'/TARGET)==AFTER,'REVIEWED_WIZARD_SOURCE_CHANGED')
    for item in changes:require(digest(folder/'source'/item['path'])==item['after'],'REVIEWED_RELEASE_SOURCE_CHANGED')
    build=m['build'];require(bool(re.fullmatch('[a-f0-9]{64}',build['sourceSha'])),'RELEASE_SOURCE_HASH_INVALID')
    require(set(build['images'])==set(ROLES),'MATCHING_RELEASE_IMAGES_REQUIRED')
    expected=readenv(state/'compose.env')
    for role in ROLES:
        item=build['images'][role]
        require(bool(re.fullmatch('sha256:[a-f0-9]{64}',item['id'])) and item['sourceLabel']==build['sourceSha'],'MATCHING_RELEASE_IMAGES_REQUIRED')
        expected['AIA_'+role.upper()+'_IMAGE']=item['id']
    require(readenv(folder/'compose.env')==expected,'RELEASE_COMPOSE_ENV_CHANGED')
    return m
def source_candidate(d,release=RELEASE):
    if release!=RELEASE:return overlay_candidate(d,release)
    original=load(d.STATE/'images.json');base=d.materials()
    require(base['sourceSha']==original['sourceSha'] and digest(d.REPO/TARGET)==BEFORE,'ORIGINAL_RELEASE_SOURCE_CHANGED')
    folder=d.STATE/'releases'/RELEASE;source=folder/'source'
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    require(not folder.is_symlink() and not source.is_symlink(),'RELEASE_PATH_CHANGED')
    for item in base['files']:
        name=item['path'];relative=Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts,'BUILD_PATH_CHANGED')
        path=source/relative
        if path.exists():
            expected=AFTER if name==TARGET else item['sha256']
            require(digest(path) in (item['sha256'],expected),'CANDIDATE_SOURCE_CHANGED')
        else:
            path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            shutil.copyfile(d.REPO/relative,path)
    target=source/TARGET
    if digest(target)==BEFORE:
        text=target.read_text();require(text.count('next={`${base}&step=3&eventId=${event.id}`}')==1 and text.count('${base}&step=2&eventId=${event.id}')==3,'PATCH_CONTEXT_CHANGED')
        text=text.replace('next={`${base}&step=3&eventId=${event.id}`}','next={`${base}&step=3`}').replace('${base}&step=2&eventId=${event.id}','${base}&step=2')
        require(hashlib.sha256(text.encode()).hexdigest()==AFTER,'PATCH_RESULT_CHANGED')
        target.write_text(text)
    expected=[dict(x,sha256=AFTER) if x['path']==TARGET else x for x in base['files']]
    actual=d.materials(source)
    require(actual['files']==expected,'ONLY_WIZARD_LINK_CHANGE_ALLOWED')
    return folder,source,actual,original
def overlay_candidate(d,release):
    original=load(d.STATE/'images.json');base=d.materials()
    require(base['sourceSha']==original['sourceSha'],'ORIGINAL_RELEASE_SOURCE_CHANGED')
    changes=changes_for(release,d.KIT);base_map={x['path']:x['sha256'] for x in base['files']}
    wanted=dict(base_map)
    for item in changes:
        require(base_map.get(item['path'])==item['before'],'PRIVACY_PATCH_BASE_CHANGED')
        require(digest(privacy_review(d.KIT,release)/'overlay'/item['path'])==item['after'],'PRIVACY_OVERLAY_CHANGED')
        wanted[item['path']]=item['after']
    folder=d.STATE/'releases'/release;source=folder/'source'
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    require(not folder.is_symlink() and not source.is_symlink(),'RELEASE_PATH_CHANGED')
    for item in base['files']:
        path=source/item['path'];path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if path.exists():require(not path.is_symlink() and digest(path) in (item['sha256'],wanted[item['path']]),'CANDIDATE_SOURCE_CHANGED')
        else:shutil.copyfile(d.REPO/item['path'],path)
    for item in changes:
        path=source/item['path'];path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if path.exists() and digest(path)==item['after']:continue
        require(not path.is_symlink() and (not path.exists() or digest(path)==item['before']),'CANDIDATE_SOURCE_CHANGED')
        shutil.copyfile(privacy_review(d.KIT,release)/'overlay'/item['path'],path)
    actual=d.materials(source)
    require(actual['files']==[{'path':p,'sha256':sha} for p,sha in sorted(wanted.items())],'ONLY_REVIEWED_PRIVACY_CHANGES_ALLOWED')
    return folder,source,actual,original

def logger_fix_preflight(d,source,materials):
    """Check the one-line fix with the retained tools image before any new build."""
    old=d.STATE/'releases'/PRIVACY_RELEASE
    cached=old/'tools-image.json'
    if not cached.exists():return
    worker='apps/worker/src/main.ts'
    old_hash=next(x['after'] for x in changes_for(PRIVACY_RELEASE,d.KIT) if x['path']==worker)
    expected=[dict(x,sha256=old_hash) if x['path']==worker else x for x in materials['files']]
    previous=d.materials(old/'source')
    require(previous['files']==expected,'LOGGER_FIX_MUST_BE_ONLY_V1_SOURCE_CHANGE')
    item=load(cached)
    require(item['sourceLabel']==previous['sourceSha'] and bool(re.fullmatch('sha256:[a-f0-9]{64}',item['id'])),'LOGGER_PREFLIGHT_IMAGE_CHANGED')
    image=json.loads(d.docker('image','inspect',item['id']))[0]
    require(image['Id']==item['id'] and image['Config']['Labels']['org.opencontainers.image.revision']==previous['sourceSha'],'LOGGER_PREFLIGHT_IMAGE_CHANGED')
    # Candidate files are root-private (0600); mount the identical reviewed file
    # owned by UID 1000, which the unprivileged tools process can read.
    reviewed=privacy_review(d.KIT,PRIVACY_LOGGER_RELEASE)/'overlay'/worker
    require(digest(reviewed)==digest(source/worker),'LOGGER_PREFLIGHT_SOURCE_CHANGED')
    print('CHECKING_PRIVACY_WORKER_TYPES_BEFORE_BUILD; protected log '+str(d.STATE/'logs/privacy-logger-preflight.log'),flush=True)
    d.docker('run','--name',PROJECT+'-privacy-logger-preflight-'+d.stamp(),'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1536m','--cpus','1','--volume',str(reviewed)+':/app/'+worker+':ro','--entrypoint','node',item['id'],'--max-old-space-size=1024','/app/node_modules/typescript/lib/tsc.js','--project','/app/apps/worker/tsconfig.json','--noEmit','--incremental','false',log='privacy-logger-preflight.log')

def build_candidate(d,release=RELEASE):
    folder,source,materials,original=source_candidate(d,release)
    prefix=release_prefix(release).lower()
    web=readenv(d.STATE/'secrets/web.env')
    require(hashlib.sha256(web['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].encode()).hexdigest()==original['publicKeyHash'],'CLERK_PUBLIC_KEY_CHANGED')
    admin=d.STATE/'storage-admin';receipt=load(admin/'receipt.json')
    require(digest(admin/'mc')==receipt['sha256'],'EXISTING_BUILD_CLIENT_CHECKSUM_REQUIRED')
    if release==PRIVACY_LOGGER_RELEASE:logger_fix_preflight(d,source,materials)
    images={};buildenv={**os.environ,'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':web['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],'AIA_SOURCE_SHA':materials['sourceSha'],'DOCKER_BUILDKIT':'1'}
    for role in ROLES:
        cached=folder/(role+'-image.json')
        if cached.exists():
            item=load(cached);require(item['sourceLabel']==materials['sourceSha'],'PARTIAL_BUILD_SOURCE_CHANGED')
        else:
            tag=PROJECT+'/'+role+':'+prefix+'-'+materials['sourceSha'][:12]
            print('BUILDING '+role+'; protected log: '+str(d.STATE/'logs'/(prefix+'-build-'+role+'.log')),flush=True)
            d.docker('build','--file',str(source/'infra/production/Dockerfile'),'--target',role,'--build-context','storage-admin='+str(admin),'--build-arg','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','--build-arg','AIA_SOURCE_SHA','--label','org.opencontainers.image.revision='+materials['sourceSha'],'--tag',tag,str(source),env=buildenv,log=prefix+'-build-'+role+'.log')
            inspected=json.loads(d.docker('image','inspect',tag))[0]
            item=dict(id=inspected['Id'],tag=tag,sourceLabel=materials['sourceSha'])
        inspected=json.loads(d.docker('image','inspect',item['id']))[0]
        require(inspected['Id']==item['id'] and inspected['Config']['Labels']['org.opencontainers.image.revision']==materials['sourceSha'],'CANDIDATE_IMAGE_LABEL_CHANGED')
        if not cached.exists():save(cached,item)
        images[role]=item
    require(d.materials(source)==materials and d.materials()['sourceSha']==original['sourceSha'],'SOURCE_CHANGED_DURING_BUILD')
    expected={item['path']:item['after'] for item in changes_for(release,d.KIT)}
    proof="const f=require('fs'),c=require('crypto');for(const [p,sha]of Object.entries("+json.dumps(expected)+")){if(c.createHash('sha256').update(f.readFileSync('/app/'+p)).digest('hex')!==sha)process.exit(1);}console.log('REVIEWED_IMAGE_CHECK_PASSED')"
    d.docker('run','--name',PROJECT+'-'+prefix+'-image-check-'+d.stamp(),'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--cpus','0.5','--entrypoint','node',images['tools']['id'],'-e',proof,log=prefix+'-image-check.log')
    if release in PRIVACY_RELEASES:
        review=privacy_review(d.KIT,release)
        checks=[('ui',['--experimental-vm-modules','/review/checks.mjs']),('cleanup',['--experimental-vm-modules','/review/cleanup-checks.mjs'])]
        if release==EVENT_UI_RELEASE:checks.append(('event-delete',['--experimental-vm-modules','/review/event-checks.mjs']))
        checks.append(('worker-types',['--max-old-space-size=1024','/app/node_modules/typescript/lib/tsc.js','--project','/app/apps/worker/tsconfig.json','--noEmit','--incremental','false']))
        for name,command in checks:
            print('CHECKING_'+prefix.upper()+'_'+name.upper().replace('-','_')+'; protected log '+str(d.STATE/'logs'/(prefix+'-check-'+name+'.log')),flush=True)
            d.docker('run','--name',PROJECT+'-'+prefix+'-check-'+name+'-'+d.stamp(),'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1536m' if name=='worker-types' else '256m','--cpus','1','--volume',str(review)+':/review:ro','--entrypoint','node',images['tools']['id'],*command,log=prefix+'-check-'+name+'.log')
    env=readenv(d.STATE/'compose.env')
    for role,item in images.items():env['AIA_'+role.upper()+'_IMAGE']=item['id']
    envfile=folder/'compose.env'
    if envfile.exists():require(readenv(envfile)==env,'CANDIDATE_COMPOSE_ENV_CHANGED')
    else:envput(envfile,env)
    manifest=dict(kind=release,baseImagesReceiptHash=digest(d.STATE/'images.json'),source=str(source),composeEnv=str(envfile),build=dict(commit=original['commit'],sourceSha=materials['sourceSha'],images=images,publicKeyHash=original['publicKeyHash'],deploymentKit=d.kit_materials()))
    path=folder/'release.json'
    if path.exists():
        existing=load(path);comparison=json.loads(json.dumps(existing))
        known=[d.kit_materials()]
        if (d.KIT/'privacy-release-baseline.json').exists():known.append(load(d.KIT/'privacy-release-baseline.json')['deploymentKit'])
        if (d.KIT/'privacy-logger-fix-baseline.json').exists():known.append(load(d.KIT/'privacy-logger-fix-baseline.json')['deploymentKit'])
        if (d.KIT/'events-release-baseline.json').exists():known.append(load(d.KIT/'events-release-baseline.json')['deploymentKit'])
        require(comparison['build']['deploymentKit'] in known,'CANDIDATE_RELEASE_KIT_CHANGED')
        comparison['build']['deploymentKit']=manifest['build']['deploymentKit']
        require(comparison==manifest,'CANDIDATE_RELEASE_RECEIPT_CHANGED');manifest=existing
    else:save(path,manifest)
    print(prefix.upper()+'_CANDIDATE_PASSED: reviewed changes only; web/worker/tools share one source; previous release retained.',flush=True)
    return manifest
def dependency_ids(d):
    result={}
    for name in DEPENDENCIES:
        ids=d.dc('ps','-q',name).splitlines();require(len(ids)==1,'MISSING_DEPENDENCY_'+name.upper());result[name]=ids[0]
    return result
def verify_dependencies(d,before):
    require(dependency_ids(d)==before,'DEPENDENCY_CONTAINER_CHANGED')
def health(d):
    d.healthy(('postgres','redis','minio','web','worker','ingress'))
    d.tool('scripts/vps-staging-check.ts')
    # Existing nginx upstream uses Docker DNS with resolve/valid=5s. No reload.
    d.run(['curl','--fail','--silent','--show-error','--retry','15','--retry-delay','2','--retry-connrefused','--max-time','10','--cacert',str(d.STATE/'tls/ca.crt'),'https://localhost:18443/api/health/ready'],log='wizard-ingress-ready.log')
def replace_apps(d,log):
    d.dc('up','-d','--no-deps','--wait','--wait-timeout','180','web','worker',log=log)
def activate(d,manifest):
    before=dependency_ids(d);old=active(d.STATE,d.KIT)
    release=manifest['kind'];prefix=release_prefix(release)
    folder=d.STATE/'releases'/release;completed=folder/'activation.json'
    previous=old['kind'] if old else None
    if old and old['kind']==release:
        require(old==manifest,'UNREVIEWED_ACTIVE_RELEASE')
        if completed.exists() and load(completed).get('status')=='PASSED':
            d.validate();health(d);verify_dependencies(d,before)
            print(prefix+'_UPDATE_PASSED: reviewed release already active.');return
        require(completed.exists() or release==RELEASE,'INTERRUPTED_RELEASE_JOURNAL_REQUIRED')
        previous=load(completed).get('previousRelease') if completed.exists() else None
        if previous=='base':previous=None
        print('Resuming interrupted application activation; using already-built images.',flush=True)
    require(allowed_predecessor(release,previous),'UNREVIEWED_RELEASE_TRANSITION')
    save(completed,dict(status='ACTIVATING',previousRelease=previous,startedAt=d.stamp()))
    pointer=d.STATE/'active-release.json';started=False
    save(pointer,{'release':release})
    try:
        d.validate() # Validate new image/config before replacing any service.
        print('ACTIVATING_WEB_AND_WORKER: protected log '+str(d.STATE/'logs/wizard-activate.log'),flush=True)
        started=True;replace_apps(d,'wizard-activate.log');health(d);verify_dependencies(d,before)
        save(completed,dict(status='PASSED',dependenciesPreserved=True,previousRelease=previous,completedAt=d.stamp()))
    except Exception:
        save(pointer,{'release':previous})
        try:
            if started:replace_apps(d,'wizard-rollback.log')
            health(d);verify_dependencies(d,before)
            save(completed,dict(status='ROLLED_BACK',dependenciesPreserved=True,previousRelease=previous,completedAt=d.stamp()))
            print(prefix+'_UPDATE_FAILED_ROLLED_BACK: previous application images restored; inspect protected application update logs.',flush=True)
        except Exception:
            print(prefix+'_ROLLBACK_REQUIRES_ATTENTION: inspect protected wizard-rollback.log; no dependency or volume was removed.',flush=True)
            raise
        raise
    print(prefix+'_UPDATE_PASSED: private TLS readiness passed; web/worker updated; dependency containers and persistent volumes preserved.',flush=True)
def rollback(d,release=None):
    old=active(d.STATE,d.KIT)
    release=release or (old['kind'] if old else RELEASE)
    prefix=release_prefix(release)
    folder=d.STATE/'releases'/release
    if not old and not folder.exists():
        health(d);print('WIZARD_BASE_RELEASE_ALREADY_ACTIVE');return
    phase=load(folder/'activation.json') if (folder/'activation.json').exists() else {}
    require(release not in PRIVACY_RELEASES or not old or old['kind']!=release or 'previousRelease' in phase,'PRIVACY_ROLLBACK_JOURNAL_REQUIRED')
    previous=phase.get('previousRelease');previous=None if previous=='base' else previous
    require(allowed_predecessor(release,previous),'UNREVIEWED_ROLLBACK_TARGET')
    require(not old or old['kind'] in (release,previous),'UNREVIEWED_ACTIVE_RELEASE')
    before=dependency_ids(d);save(d.STATE/'active-release.json',{'release':previous})
    d.validate();replace_apps(d,'wizard-manual-rollback.log');health(d);verify_dependencies(d,before)
    save(folder/'activation.json',dict(status='ROLLED_BACK',dependenciesPreserved=True,previousRelease=previous,completedAt=d.stamp()))
    print(prefix+'_ROLLBACK_PASSED: previous application images restored; persistent volumes retained.')
def main(default_release=RELEASE):
    import deploy as d
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['deploy','check','rollback']);args=parser.parse_args()
    d.context();d.local_guard();d.need('check')
    with (d.STATE/'wizard-release.lock').open('a') as lock:
        os.fchmod(lock.fileno(),0o600)
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('ANOTHER_WIZARD_UPDATE_IS_RUNNING')
        authorize_kit(d);d.validate()
        if args.action=='check':health(d);print('RELEASE_READINESS_PASSED');return
        if args.action=='rollback':rollback(d,default_release);return
        current=active(d.STATE,d.KIT)
        if current and current['kind']==default_release:activate(d,current);return
        require(not current or allowed_predecessor(default_release,current['kind']),'UNREVIEWED_RELEASE_TRANSITION')
        d.healthy(('postgres','redis','minio','web','worker','ingress'))
        activate(d,build_candidate(d,default_release))
if __name__=='__main__':
    try:main()
    except Exception as e:
        import deploy as d
        d.report_failure(e);sys.exit(1)
