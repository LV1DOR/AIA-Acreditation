#!/usr/bin/env python3
"""PC-only offline tests followed by serial immutable builds. No VPS operations."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, os, re, subprocess, tarfile, time, tempfile, traceback
from pathlib import Path

MATERIAL = 'ad0b3cf4a81b359d4cf6598c14b7c33506bfef3496a0be780b181324b1c7e8cc'
ARCHIVE_SHA = 'f5a62d11f0d565ebaf9a80d1e0f54b78267a3511c6794fb57dd69c18e8209c22'
BASE = 'sha256:e7fc861d6e08a6c3b57e53135d8d38c82f1f4e3a43ffafb0169d4131c13bb6ef'
BASE_TAG = 'aia-reviewed-tools-base:approval-updates-e7fc861d6e08'

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
    need(re.fullmatch(r'aia-approval-updates-db-[0-9]+',pg) is not None, 'ISOLATED_PC_DATABASE_NAME_REQUIRED')
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


def verify_failed_workspace(work):
    need(work.is_dir() and not work.is_symlink() and not (work/'build-output.json').exists() and not list(work.glob('checks-passed-*.json')),'ONLY_FAILED_PRE_BUILD_WORKSPACE_CAN_RESUME')
    old=work/'approval-updates-release'
    need(not old.is_symlink() and digest(old/'MANIFEST.sha256')=='235287dcdf6a146c263984c7675a6a6773789c37931a53d4673c0b531f1ffa7f','EXPECTED_FAILED_SOURCE_MANIFEST_REQUIRED')
    for line in(old/'MANIFEST.sha256').read_text().splitlines():
        h,n=line.split('  ',1);rel=Path(n)
        need(not rel.is_absolute() and '..'not in rel.parts and not (old/rel).is_symlink() and digest(old/rel)==h,'PREVIOUS_SOURCE_CHANGED_PRESERVE_FOR_INSPECTION')
    need(not (work/'failed-source-e41c04cd2547').exists(),'PREVIOUS_RETRY_REQUIRES_INSPECTION')


def main():
    need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(), 'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
    need(len(sys.argv) == 3, 'EXPECTED_WORKSPACE_AND_EXPLICIT_APPROVAL')
    need(sys.argv[2] in ['--approved-pc-tests-build-and-upload','--resume-reviewed-failed-checks'], 'EXPLICIT_PC_APPROVAL_REQUIRED')
    resume=sys.argv[2]=='--resume-reviewed-failed-checks'
    work = Path(sys.argv[1])
    need(work.parent == Path.home() and re.fullmatch(r'aia-approval-updates-[a-f0-9]{32}', work.name), 'SAFE_PC_WORKSPACE_REQUIRED')
    if resume:verify_failed_workspace(work)
    else:need(not work.exists() and not work.is_symlink(),'NEW_WORKSPACE_REQUIRED_PRESERVE_PREVIOUS_ATTEMPT')
    root = Path(__file__).resolve().parent
    need(digest(root/'approval-updates-source.tar.gz')==ARCHIVE_SHA,'SOURCE_ARCHIVE_CHECKSUM_MISMATCH')
    os.umask(0o077)
    if not resume:work.mkdir(mode=0o700)
    extracted=work
    if resume:
        extracted=work/'corrected-source-input';extracted.mkdir(mode=0o700)
    print('PC_WORKSPACE='+str(work),flush=True)
    with tarfile.open(root/'approval-updates-source.tar.gz','r:gz')as archive:
        names=set()
        for member in archive.getmembers():
            rel=Path(member.name)
            need(member.isfile() and member.name not in names and not rel.is_absolute() and '..'not in rel.parts and rel.parts[0]=='approval-updates-release','SAFE_ARCHIVE_MEMBERS_REQUIRED')
            names.add(member.name)
        archive.extractall(extracted,filter='data')
    if resume:
        (work/'approval-updates-release').rename(work/'failed-source-e41c04cd2547')
        (extracted/'approval-updates-release').rename(work/'approval-updates-release')
        print('FAILED_SOURCE_PRESERVED_CORRECTED_HERMETIC_TEST_HARNESS_INSTALLED',flush=True)
    bundle = work / 'approval-updates-release'
    manifest = (bundle / 'MANIFEST.sha256').read_text()
    for line in manifest.splitlines():
        sha, name = line.split('  ', 1)
        need(digest(bundle / name) == sha, 'EXTRACTED_FILE_CHECKSUM_MISMATCH')
    attempt_dir = Path(tempfile.mkdtemp(prefix='checks-attempt-',dir=work))
    global CURRENT_ATTEMPT
    CURRENT_ATTEMPT = attempt_dir
    print('PC_CHECK_ATTEMPT=' + str(attempt_dir),flush=True)
    env = {k: os.environ[k] for k in ('PATH', 'HOME') if k in os.environ}
    def docker(args, logfile=None, timeout=1200):
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
        r = subprocess.run(cmd, env=env, text=True, capture_output=True, timeout=timeout)
        need(r.returncode == 0, 'PC_DOCKER_PREFLIGHT_FAILED'); return r.stdout
    prepare_local_base(docker)
    available = {k: int(v.split()[0]) // 1024 for k, v in (line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())}
    need(available['MemAvailable'] >= 4096, 'FOUR_GIB_PC_MEMORY_HEADROOM_REQUIRED')
    stamp = str(time.time_ns()); tag = 'aia-accreditation-checks/exports:' + stamp
    print('BUILDING_OFFLINE_TEST_IMAGE_NO_DOWNLOADS', flush=True)
    docker(['build', '--platform', 'linux/amd64', '--pull=false', '-f', str(bundle / 'Dockerfile.checks'), '-t', tag, str(bundle)], attempt_dir / 'test-build.log')
    print('RUNNING_WORKER_SELF_PROFILE_EMAIL_AND_TYPE_CHECKS_NO_NETWORK_OR_HOST_VOLUMES', flush=True)
    docker(['run', '--name', 'aia-approval-updates-check-' + stamp, '--pull', 'never', '--network', 'none',
            '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--memory', '1536m', '--memory-swap', '1536m', '--pids-limit', '128',
            '--tmpfs', '/tmp:uid=1000,gid=1000,mode=0700,size=256m', tag], attempt_dir / 'source-checks.log')
    print('RUNNING_ISOLATED_PC_DATABASE_REMOVAL_TESTS_NO_PRODUCTION_ACCESS',flush=True)
    import secrets
    pg_image='postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
    docker(['image','inspect',pg_image])
    pg='aia-approval-updates-db-'+stamp;job='aia-approval-updates-integration-'+stamp
    password=secrets.token_hex(32)
    pg_env=attempt_dir/'synthetic-postgres.env';test_env=attempt_dir/'synthetic-tests.env'
    for p,content in [(pg_env,'POSTGRES_PASSWORD='+password+'\nPOSTGRES_DB=aia_acreditacao_test\n'),(test_env,'TEST_DATABASE_URL=postgresql://postgres:'+password+'@127.0.0.1:5432/aia_acreditacao_test\n')]:
        with p.open('x') as f:os.fchmod(f.fileno(),0o600);f.write(content)
    made_pg=False;made_job=False
    try:
        docker(['create','--name',pg,'--pull','never','--network','none','--memory','384m','--memory-swap','384m','--pids-limit','128','--env-file',str(pg_env),pg_image]);made_pg=True
        docker(['start',pg])
        wait_for_isolated_database(pg,env)
        # SQL reaches ONLY the newly created name, which has no network or host ports.
        for sql in sorted((bundle/'source/packages/database/prisma/migrations').glob('*/migration.sql')):
            result=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i',pg,'psql','-X','-U','postgres','-d','aia_acreditacao_test','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],input=sql.read_bytes(),env=env,capture_output=True,timeout=120)
            if result.returncode:
                with (attempt_dir/'synthetic-migration-failure.log').open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(result.stdout+result.stderr)
            if result.returncode:
                codes=re.findall(rb'ERROR:\s+([0-9A-Z]{5})\b',result.stderr)
                print(json.dumps({'stage':'ISOLATED_PC_SCHEMA_MIGRATION','migration':sql.parent.name,'sqlStates':[x.decode('ascii') for x in codes]}),flush=True)
                print('PC_MIGRATION_DIAGNOSTIC='+str(attempt_dir/'synthetic-migration-failure.log'),flush=True)
            need(result.returncode==0,'ISOLATED_PC_FULL_MIGRATION_CHECK_FAILED')
        docker(['create','--name',job,'--pull','never','--network','container:'+pg,'--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--env-file',str(test_env),tag,'node_modules/vitest/vitest.mjs','run','--project','integration','tests/integration/approval-carry-forward.test.ts','tests/integration/final-submission.test.ts','tests/integration/requests.test.ts','tests/integration/participant-onboarding.test.ts','tests/integration/invitations.test.ts','tests/integration/id-all-export.test.ts','tests/integration/event-removal.test.ts','--maxWorkers','1','--no-file-parallelism','--no-cache']);made_job=True
        docker(['start','--attach',job],attempt_dir/'isolated-database-checks.log',timeout=240)
        state=json.loads(docker(['inspect','--format','{{json .State}}',job]))
        need(state['Status']=='exited'and state['ExitCode']==0 and not state.get('OOMKilled'),'ISOLATED_DATABASE_TESTS_MUST_EXIT_ZERO')
        print('APPROVAL_UPDATES_REAL_DATABASE_HISTORY_SCOPE_AND_RETRY_CHECKS_PASSED',flush=True)
    finally:
        for name,made in [(job,made_job),(pg,made_pg)]:
            if made:docker(['stop','--time','30',name])
        # Retain containers and synthetic volumes for inspection; no automatic deletion.
    (work / ('checks-passed-' + stamp + '.json')).write_text(json.dumps({
        'passed': True, 'material': MATERIAL, 'testImage': tag, 'productionChanged': False,
        'databaseContacted': True, 'productionDatabaseContacted': False, 'isolatedDatabaseVerified': True, 'emailSent': False}))
    (work / 'pc-build-approved.json').write_text(json.dumps({'approved': True, 'material': MATERIAL}))
    print('OFFLINE_APPROVAL_UPDATES_AND_TYPES_PASSED_BUILDING_APPLICATION_IMAGES', flush=True)
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
