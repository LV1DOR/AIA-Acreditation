#!/usr/bin/env python3
"""PC-only offline tests followed by serial immutable builds. No VPS operations."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, os, re, subprocess, tarfile, time, tempfile, traceback
from pathlib import Path

MATERIAL = '6ead68a93095cee8468628bdf943c1bd6a4c18bba2396d08b3d41a9532cd9b59'
ARCHIVE_SHA = 'ad30f230c3b6dfcd3c929117cccf4cdb7076a4d0583ad708ac36c8fb678696d3'
BASE = 'sha256:f34adf56472d3c36409774ee3f517a9df8b97b3518dcfda3937864c42f993550'
BASE_TAG = 'aia-reviewed-tools-base:resend-monitoring-f34adf56472d'

def need(ok, code):
    if not ok: raise RuntimeError(code)

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def prepare_local_base(docker):
    base = json.loads(docker(['image', 'inspect', BASE]))[0]
    need(base['Id'] == BASE and base['Os'] == 'linux' and base['Architecture'] == 'amd64',
         'PREVIOUS_VERIFIED_TOOLS_IMAGE_REQUIRED')
    existing = docker(['image', 'ls', '--no-trunc', '--quiet', '--filter', 'reference=' + BASE_TAG]).splitlines()
    need(not existing or existing == [BASE], 'EXISTING_TEST_BASE_TAG_POINTS_TO_DIFFERENT_IMAGE')
    if not existing:
        docker(['image', 'tag', BASE, BASE_TAG])
    resolved = json.loads(docker(['image', 'inspect', BASE_TAG]))[0]
    need(resolved['Id'] == BASE, 'TEST_BASE_TAG_ID_MISMATCH')

def wait_for_isolated_database(pg,env):
    need(re.fullmatch(r'aia-resend-monitoring-db-[0-9]+',pg) is not None, 'ISOLATED_PC_DATABASE_NAME_REQUIRED')
    command=['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec',pg]
    for ready_attempt in range(45):
        # The official image's temporary init server only listens on Unix sockets.
        # TCP readiness therefore waits until initdb and POSTGRES_DB creation finish.
        tcp=subprocess.run(command+['pg_isready','-h','127.0.0.1','-U','postgres','-d','aia_acreditacao_test'],env=env,capture_output=True,timeout=10)
        if tcp.returncode==0:
            # Check the named database itself, not just whether a server accepts connections.
            database=subprocess.run(command+['psql','-X','-U','postgres','-d','aia_acreditacao_test','-At','-c','SELECT current_database()'],env=env,capture_output=True,timeout=10)
            if database.returncode==0 and database.stdout.strip()==b'aia_acreditacao_test':
                print('ISOLATED_PC_POSTGRES_FINAL_SERVER_AND_DATABASE_READY',flush=True)
                return
        time.sleep(1)
    raise RuntimeError('ISOLATED_PC_DATABASE_NOT_READY')


RETRY_WORKSPACE = 'aia-resend-monitoring-e42475b0d20a46a4a0be2c8572d07c38'
FAILED_ATTEMPT = 'checks-attempt-ggqk36hl'
BUNDLE_MANIFEST_SHA = '355e5a6fcf4bfcac4f8a4947b62278443efd95816569c6b508322ddfb9cff26c'

def isolated_runtime_grants(sql):
    # Raw-SQL rehearsal intentionally has no Prisma ledger. Keep every real
    # application grant/revoke; condition ONLY the absent-ledger revoke.
    original=b'REVOKE INSERT,UPDATE,DELETE ON "_prisma_migrations" FROM aia_runtime;'
    need(sql.count(original)==1,'EXACT_RUNTIME_LEDGER_REVOKE_REQUIRED')
    guarded=b"DO $raw_schema$ BEGIN IF to_regclass('public.\"_prisma_migrations\"') IS NOT NULL THEN EXECUTE 'REVOKE INSERT,UPDATE,DELETE ON \"_prisma_migrations\" FROM aia_runtime'; END IF; END $raw_schema$;"
    return sql.replace(original,guarded,1)

def verify_failed_workspace(work):
    need(work.name==RETRY_WORKSPACE and work.is_dir()and not work.is_symlink(),'EXACT_REVIEWED_FAILED_PC_WORKSPACE_REQUIRED')
    need(not(work/'build-output.json').exists()and not list(work.glob('checks-passed-*.json')),'ONLY_FAILED_PRE_BUILD_WORKSPACE_CAN_RESUME')
    bundle=work/'resend-monitoring-release'
    need(not bundle.is_symlink()and digest(bundle/'MANIFEST.sha256')==BUNDLE_MANIFEST_SHA,'ORIGINAL_TESTED_SOURCE_MANIFEST_REQUIRED')
    for line in(bundle/'MANIFEST.sha256').read_text().splitlines():
        h,n=line.split('  ',1);rel=Path(n)
        need(not rel.is_absolute()and '..'not in rel.parts and not(bundle/rel).is_symlink()and digest(bundle/rel)==h,'ORIGINAL_TESTED_SOURCE_CHANGED')
    failed=work/FAILED_ATTEMPT/'runtime-grants.log'
    need(failed.is_file()and not failed.is_symlink()and 'relation "_prisma_migrations" does not exist'in failed.read_text(),'EXACT_INSPECTED_RUNTIME_GRANTS_FAILURE_REQUIRED')

def verified_cached_test_image(work,docker,stamp):
    log=(work/FAILED_ATTEMPT/'test-build.log').read_text()
    tags=set(t.removeprefix('docker.io/')for t in re.findall(r'(?:docker.io/)?aia-accreditation-checks/exports:[0-9]+',log))
    need(len(tags)==1,'ONE_ORIGINAL_TEST_IMAGE_REQUIRED')
    tag=next(iter(tags));prior_stamp=tag.rsplit(':',1)[1]
    old=json.loads(docker(['inspect','aia-resend-monitoring-check-'+prior_stamp]))[0]
    need(old['State']['Status']=='exited'and old['State']['ExitCode']==0 and not old['State'].get('OOMKilled')and old.get('RestartCount',0)==0,'ORIGINAL_OFFLINE_TESTS_MUST_HAVE_PASSED')
    cfg=old['Config']
    need(cfg['Image']==tag and cfg['Entrypoint']==['node']and cfg['Cmd']==['/candidate/checks/in_image.mjs'],'ORIGINAL_OFFLINE_TEST_COMMAND_REQUIRED')
    image=json.loads(docker(['image','inspect',old['Image']]))[0]
    need(image['Id']==old['Image']and image['Os']=='linux'and image['Architecture']=='amd64','EXACT_ORIGINAL_TEST_IMAGE_REQUIRED')
    bundle=work/'resend-monitoring-release'
    files=[{'path':'/app/'+e['path'],'sha256':e['sha256']}for e in json.loads((bundle/'source-manifest.json').read_text())['files']]
    for line in(bundle/'MANIFEST.sha256').read_text().splitlines():
        h,n=line.split('  ',1)
        if n.startswith('checks/'):files.append({'path':'/candidate/'+n,'sha256':h})
    program="const fs=require('node:fs'),crypto=require('node:crypto');for(const f of JSON.parse(fs.readFileSync(0,'utf8'))){if(crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')!==f.sha256)throw Error('CACHED_TEST_SOURCE_MISMATCH')}console.log('CACHED_TEST_SOURCE_AND_HARNESS_VERIFIED')"
    output=docker(['run','--name','aia-resend-monitoring-cached-proof-'+stamp,'--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--memory-swap','384m','--pids-limit','32','--interactive','--entrypoint','node',image['Id'],'-e',program],input=json.dumps(files))
    need(output.strip()=='CACHED_TEST_SOURCE_AND_HARNESS_VERIFIED','CACHED_TEST_SOURCE_PROOF_REQUIRED')
    print('REUSING_VERIFIED_TEST_IMAGE_AND_PASSED_OFFLINE_CHECKS_NO_REBUILD_OR_DOWNLOAD',flush=True)
    return image['Id']


def main():
    need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(), 'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
    need(len(sys.argv) == 3, 'EXPECTED_WORKSPACE_AND_EXPLICIT_APPROVAL')
    need(sys.argv[2] in ['--approved-pc-tests-build-and-upload','--retry-reviewed-grants'], 'EXPLICIT_PC_APPROVAL_REQUIRED')
    resume=sys.argv[2]=='--retry-reviewed-grants'
    work = Path(sys.argv[1])
    need(work.parent == Path.home() and re.fullmatch(r'aia-resend-monitoring-[a-f0-9]{32}', work.name), 'SAFE_PC_WORKSPACE_REQUIRED')
    if resume:verify_failed_workspace(work)
    else:need(not work.exists() and not work.is_symlink(),'NEW_WORKSPACE_REQUIRED_PRESERVE_PREVIOUS_ATTEMPT')
    root = Path(__file__).resolve().parent
    os.umask(0o077)
    if not resume:
        need(digest(root/'resend-monitoring-source.tar.gz')==ARCHIVE_SHA,'SOURCE_ARCHIVE_CHECKSUM_MISMATCH')
        work.mkdir(mode=0o700)
        with tarfile.open(root/'resend-monitoring-source.tar.gz','r:gz')as archive:
            names=set()
            for member in archive.getmembers():
                rel=Path(member.name)
                need(member.isfile()and member.name not in names and not rel.is_absolute()and '..'not in rel.parts and rel.parts[0]=='resend-monitoring-release','SAFE_ARCHIVE_MEMBERS_REQUIRED')
                names.add(member.name)
            archive.extractall(work,filter='data')
    print('PC_WORKSPACE='+str(work),flush=True)
    bundle = work / 'resend-monitoring-release'
    manifest = (bundle / 'MANIFEST.sha256').read_text()
    for line in manifest.splitlines():
        sha, name = line.split('  ', 1)
        need(digest(bundle / name) == sha, 'EXTRACTED_FILE_CHECKSUM_MISMATCH')
    attempt_dir = Path(tempfile.mkdtemp(prefix='checks-attempt-',dir=work))
    global CURRENT_ATTEMPT
    CURRENT_ATTEMPT = attempt_dir
    print('PC_CHECK_ATTEMPT=' + str(attempt_dir),flush=True)
    env = {k: os.environ[k] for k in ('PATH', 'HOME') if k in os.environ}
    def docker(args, logfile=None, timeout=1200, input=None):
        cmd = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', *args]
        if logfile:
            with logfile.open('x') as log:
                r = subprocess.run(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            if r.returncode:
                print('PC_CHECK_FAILED_LOG=' + str(logfile), flush=True)
                # Offline tests contain synthetic fixtures only; no credentials have been read.
                print('\n'.join(logfile.read_text().splitlines()[-65:]), flush=True)
            need(r.returncode == 0, 'OFFLINE_PC_CHECK_FAILED_NO_APPLICATION_BUILD_OR_UPLOAD')
            return ''
        r = subprocess.run(cmd, env=env, text=True, capture_output=True, timeout=timeout, **({"input":input}if input is not None else {}))
        need(r.returncode == 0, 'PC_DOCKER_PREFLIGHT_FAILED'); return r.stdout
    prepare_local_base(docker)
    available = {k: int(v.split()[0]) // 1024 for k, v in (line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())}
    need(available['MemAvailable'] >= 4096, 'FOUR_GIB_PC_MEMORY_HEADROOM_REQUIRED')
    stamp = str(time.time_ns()); tag = 'aia-accreditation-checks/exports:' + stamp
    if resume:
        tag=verified_cached_test_image(work,docker,stamp)
    else:
        print('BUILDING_TEST_IMAGE_WITH_FROZEN_DEPENDENCY_DOWNLOADS', flush=True)
        docker(['build', '--platform', 'linux/amd64', '--pull=false', '-f', str(bundle / 'Dockerfile.checks'), '-t', tag, str(bundle)], attempt_dir / 'test-build.log')
        print('RUNNING_WORKER_SELF_PROFILE_EMAIL_AND_TYPE_CHECKS_NO_NETWORK_OR_HOST_VOLUMES', flush=True)
        docker(['run', '--name', 'aia-resend-monitoring-check-' + stamp, '--pull', 'never', '--network', 'none',
                '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                '--memory', '1536m', '--memory-swap', '1536m', '--pids-limit', '128',
                '--tmpfs', '/tmp:uid=1000,gid=1000,mode=0700,size=256m', tag], attempt_dir / 'source-checks.log')
    print('RUNNING_ISOLATED_PC_DATABASE_REMOVAL_TESTS_NO_PRODUCTION_ACCESS',flush=True)
    import secrets
    pg_image='postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
    docker(['image','inspect',pg_image])
    pg='aia-resend-monitoring-db-'+stamp;job='aia-resend-monitoring-integration-'+stamp
    password=secrets.token_hex(32)
    pg_env=attempt_dir/'synthetic-postgres.env';test_env=attempt_dir/'synthetic-tests.env'
    for p,content in [(pg_env,'POSTGRES_PASSWORD='+password+'\nPOSTGRES_DB=aia_acreditacao_test\n'),(test_env,'TEST_DATABASE_URL=postgresql://postgres:'+password+'@127.0.0.1:5432/aia_acreditacao_test\n')]:
        with p.open('x') as f:os.fchmod(f.fileno(),0o600);f.write(content)
    made_pg=False;made_job=False
    try:
        docker(['create','--name',pg,'--pull','never','--network','none','--memory','384m','--memory-swap','384m','--pids-limit','128','--env-file',str(pg_env),pg_image]);made_pg=True
        docker(['start',pg])
        wait_for_isolated_database(pg,env)
        def synthetic_sql(sql, label):
            result=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i',pg,'psql','-X','-U','postgres','-d','aia_acreditacao_test','-v','ON_ERROR_STOP=1'],input=sql,env=env,capture_output=True,timeout=120)
            if result.returncode:
                with (attempt_dir/(label+'.log')).open('xb') as log:os.fchmod(log.fileno(),0o600);log.write(result.stdout+result.stderr)
                print(json.dumps({'stage':'ISOLATED_PC_SQL_CHECK','operation':label,'protectedLog':str(attempt_dir/(label+'.log'))}),flush=True)
            need(result.returncode==0,'SYNTHETIC_MIGRATION_REHEARSAL_FAILED')
        # SQL reaches ONLY the newly created name, which has no network or host ports.
        for sql in sorted((bundle/'source/packages/database/prisma/migrations').glob('*/migration.sql')):
            if sql.parent.name=='20261104000100_resend_monitoring':synthetic_sql((bundle/'checks/legacy-email-seed.sql').read_bytes(),'legacy-seed')
            result=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i',pg,'psql','-X','-U','postgres','-d','aia_acreditacao_test','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],input=sql.read_bytes(),env=env,capture_output=True,timeout=120)
            if result.returncode:
                with (attempt_dir/'synthetic-migration-failure.log').open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(result.stdout+result.stderr)
            if result.returncode:
                codes=re.findall(rb'ERROR:\s+([0-9A-Z]{5})\b',result.stderr)
                print(json.dumps({'stage':'ISOLATED_PC_SCHEMA_MIGRATION','migration':sql.parent.name,'sqlStates':[x.decode('ascii') for x in codes]}),flush=True)
                print('PC_MIGRATION_DIAGNOSTIC='+str(attempt_dir/'synthetic-migration-failure.log'),flush=True)
            need(result.returncode==0,'ISOLATED_PC_FULL_MIGRATION_CHECK_FAILED')
        synthetic_sql((bundle/'checks/legacy-email-verify.sql').read_bytes(),'legacy-compatibility')
        synthetic_sql(isolated_runtime_grants((bundle/'source/infra/production/runtime-roles.sql').read_bytes()),'runtime-grants')
        docker(['create','--name',job,'--pull','never','--network','container:'+pg,'--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--env-file',str(test_env),tag,'node_modules/vitest/vitest.mjs','run','--project','integration','tests/integration/resend-monitoring.test.ts','tests/integration/resend-migration-compatibility.test.ts','tests/integration/approval-carry-forward.test.ts','tests/integration/final-submission.test.ts','tests/integration/requests.test.ts','tests/integration/participant-onboarding.test.ts','tests/integration/invitations.test.ts','tests/integration/id-all-export.test.ts','tests/integration/event-removal.test.ts','--maxWorkers','1','--no-file-parallelism','--no-cache']);made_job=True
        docker(['start','--attach',job],attempt_dir/'isolated-database-checks.log',timeout=240)
        state=json.loads(docker(['inspect','--format','{{json .State}}',job]))
        need(state['Status']=='exited'and state['ExitCode']==0 and not state.get('OOMKilled'),'ISOLATED_DATABASE_TESTS_MUST_EXIT_ZERO')
        print('RESEND_MONITORING_REAL_DATABASE_HISTORY_SCOPE_AND_RETRY_CHECKS_PASSED',flush=True)
    finally:
        for name,made in [(job,made_job),(pg,made_pg)]:
            if made:docker(['stop','--time','30',name])
        # Retain containers and synthetic volumes for inspection; no automatic deletion.
    (work / ('checks-passed-' + stamp + '.json')).write_text(json.dumps({
        'passed': True, 'material': MATERIAL, 'testImage': tag, 'productionChanged': False,
        'databaseContacted': True, 'productionDatabaseContacted': False, 'isolatedDatabaseVerified': True, 'emailSent': False}))
    (work / 'pc-build-approved.json').write_text(json.dumps({'approved': True, 'material': MATERIAL}))
    print('OFFLINE_RESEND_MONITORING_AND_TYPES_PASSED_BUILDING_APPLICATION_IMAGES', flush=True)
    result = subprocess.run([sys.executable, '-B', '-u', str(root / 'build_pc.py'), str(work)])
    need(result.returncode == 0, 'APPLICATION_BUILD_FAILED_NO_UPLOAD_OR_VPS_CHANGE')

CURRENT_ATTEMPT = None

def report_failure(error):
    report={'passed':False,'exceptionType':type(error).__name__,
        'locations':[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno} for f in traceback.extract_tb(error.__traceback__)]}
    if CURRENT_ATTEMPT is not None:
        path=CURRENT_ATTEMPT/('failure-'+str(time.time_ns())+'.json')
        with path.open('x') as f:os.fchmod(f.fileno(),0o600);json.dump(report,f)
        print('PROTECTED_SANITIZED_DIAGNOSTIC='+str(path),flush=True)
    print(json.dumps(report),flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        report_failure(error)
        print('STOP: ' + (str(error) if type(error) is RuntimeError and re.fullmatch('[A-Z0-9_]+', str(error)) else type(error).__name__))
        sys.exit(1)
