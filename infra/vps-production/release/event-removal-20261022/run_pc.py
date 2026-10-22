#!/usr/bin/env python3
"""PC-only offline tests followed by serial immutable builds. No VPS operations."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, os, re, subprocess, tarfile, time, tempfile
from pathlib import Path

MATERIAL = 'bdd31b39a3f3a0a7cc6ad644a1eeca7793fdffbbe1a9e4875bfb1965c61c88df'
ARCHIVE_SHA = 'be06af0a139624729ca8ebf1dfb7a3fc5b64ca73c61a6ea33820c354ca627670'
BASE = 'sha256:5e299175039fb9fb732393f2ef00c60abc158eebb13f8cac75f2f09ff014ba2e'
BASE_TAG = 'aia-reviewed-tools-base:event-removal-5e299175039f'

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

def verify_failed_workspace(work):
    need(work.is_dir() and not (work/'build-output.json').exists() and not list(work.glob('checks-passed-*.json')), 'ONLY_FAILED_PRE_BUILD_WORKSPACE_CAN_RESUME')
    previous = work/'event-removal-release'
    need(digest(previous/'MANIFEST.sha256') == '389fe5b48c883868f8f7afb09f0b01b71c3dce4f911053751cacc2ea30f3ad9e', 'EXPECTED_FAILED_SOURCE_MANIFEST_REQUIRED')
    for line in (previous/'MANIFEST.sha256').read_text().splitlines():
        h,n=line.split('  ',1);rel=Path(n)
        need(not rel.is_absolute() and '..'not in rel.parts and not (previous/rel).is_symlink() and digest(previous/rel)==h, 'PREVIOUS_SOURCE_CHANGED_PRESERVE_FOR_INSPECTION')
    need(not (work/'failed-source-184da94ddcb5').exists(), 'PREVIOUS_RETRY_REQUIRES_INSPECTION')

def verify_current_workspace(work):
    need(work.is_dir() and not work.is_symlink() and not (work/'build-output.json').exists() and not list(work.glob('checks-passed-*.json')), 'ONLY_FAILED_PRE_BUILD_WORKSPACE_CAN_CONTINUE')
    bundle = work/'event-removal-release'
    need(not bundle.is_symlink() and digest(bundle/'MANIFEST.sha256') == '7a3c46130fc89a57e4b8f0343b00c652bd0e334ae92b510814eccb81c7bb186b', 'CORRECTED_BUNDLE_MANIFEST_REQUIRED')
    for line in (bundle/'MANIFEST.sha256').read_text().splitlines():
        h,n=line.split('  ',1);rel=Path(n)
        need(not rel.is_absolute() and '..'not in rel.parts and not (bundle/rel).is_symlink() and digest(bundle/rel)==h, 'CORRECTED_BUNDLE_CHANGED')
    need(json.loads((bundle/'source-manifest.json').read_text())['sourceMaterialSha256']==MATERIAL, 'CORRECTED_SOURCE_MATERIAL_REQUIRED')


def main():
    need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(), 'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
    need(len(sys.argv) == 3, 'EXPECTED_WORKSPACE_AND_EXPLICIT_APPROVAL')
    need(sys.argv[2] in ['--approved-pc-tests-build-and-upload', '--resume-reviewed-failed-checks', '--continue-verified-checks'], 'EXPLICIT_PC_APPROVAL_REQUIRED')
    resume = sys.argv[2] == '--resume-reviewed-failed-checks'
    continuing = sys.argv[2] == '--continue-verified-checks'
    work = Path(sys.argv[1])
    need(work.parent == Path.home() and re.fullmatch(r'aia-event-removal-[a-f0-9]{32}', work.name), 'SAFE_PC_WORKSPACE_REQUIRED')
    need(not work.is_symlink(), 'SYMLINK_WORKSPACE_REFUSED')
    if continuing:
        verify_current_workspace(work)
    elif resume:
        verify_failed_workspace(work)
    else:
        need(not work.exists(), 'NEW_WORKSPACE_REQUIRED_PRESERVE_PREVIOUS_ATTEMPT')
    root = Path(__file__).resolve().parent
    if not continuing: need(digest(root / 'event-removal-source.tar.gz') == ARCHIVE_SHA, 'SOURCE_ARCHIVE_CHECKSUM_MISMATCH')
    os.umask(0o077)
    if not resume and not continuing: work.mkdir(mode=0o700)
    extracted = work
    if resume:
        extracted = work/'corrected-source-input';extracted.mkdir(mode=0o700)
    print('PC_WORKSPACE=' + str(work), flush=True)
    if not continuing:
        with tarfile.open(root / 'event-removal-source.tar.gz', 'r:gz') as archive:
            names = set()
            for member in archive.getmembers():
                rel = Path(member.name)
                need(member.isfile() and member.name not in names and not rel.is_absolute() and
                     '..' not in rel.parts and rel.parts[0] == 'event-removal-release', 'SAFE_ARCHIVE_MEMBERS_REQUIRED')
                names.add(member.name)
            archive.extractall(extracted, filter='data')

    if resume:
        (work/'event-removal-release').rename(work/'failed-source-184da94ddcb5')
        (extracted/'event-removal-release').rename(work/'event-removal-release')
        print('FAILED_SOURCE_PRESERVED_CORRECTED_TEST_CONTEXT_INSTALLED_NO_APPLICATION_IMAGES_EXIST',flush=True)
    bundle = work / 'event-removal-release'
    manifest = (bundle / 'MANIFEST.sha256').read_text()
    for line in manifest.splitlines():
        sha, name = line.split('  ', 1)
        need(digest(bundle / name) == sha, 'EXTRACTED_FILE_CHECKSUM_MISMATCH')
    attempt = Path(tempfile.mkdtemp(prefix='checks-attempt-',dir=work))
    print('PC_CHECK_ATTEMPT=' + str(attempt),flush=True)
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
    stamp = str(time.time_ns()); tag = 'aia-accreditation-checks/event-removal:' + stamp
    print('BUILDING_OFFLINE_TEST_IMAGE_NO_DOWNLOADS', flush=True)
    docker(['build', '--platform', 'linux/amd64', '--pull=false', '-f', str(bundle / 'Dockerfile.checks'), '-t', tag, str(bundle)], attempt / 'test-build.log')
    print('RUNNING_WORKER_SELF_PROFILE_EMAIL_AND_TYPE_CHECKS_NO_NETWORK_OR_HOST_VOLUMES', flush=True)
    docker(['run', '--name', 'aia-event-removal-check-' + stamp, '--pull', 'never', '--network', 'none',
            '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--memory', '1536m', '--memory-swap', '1536m', '--pids-limit', '128',
            '--tmpfs', '/tmp:uid=1000,gid=1000,mode=0700,size=256m', tag], attempt / 'source-checks.log')
    print('RUNNING_ISOLATED_PC_DATABASE_REMOVAL_TESTS_NO_PRODUCTION_ACCESS',flush=True)
    import secrets
    pg_image='postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
    docker(['image','inspect',pg_image])
    pg='aia-event-removal-db-'+stamp;job='aia-event-removal-integration-'+stamp
    password=secrets.token_hex(32)
    pg_env=attempt/'synthetic-postgres.env';test_env=attempt/'synthetic-tests.env'
    for p,content in [(pg_env,'POSTGRES_PASSWORD='+password+'\nPOSTGRES_DB=aia_acreditacao_test\n'),(test_env,'TEST_DATABASE_URL=postgresql://postgres:'+password+'@127.0.0.1:5432/aia_acreditacao_test\n')]:
        with p.open('x') as f:os.fchmod(f.fileno(),0o600);f.write(content)
    made_pg=False;made_job=False
    try:
        docker(['create','--name',pg,'--pull','never','--network','none','--memory','384m','--memory-swap','384m','--pids-limit','128','--env-file',str(pg_env),pg_image]);made_pg=True
        docker(['start',pg])
        ready=False
        for attempt in range(45):
            result=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec',pg,'pg_isready','-U','postgres','-d','aia_acreditacao_test'],env=env,capture_output=True,timeout=10)
            if result.returncode==0:ready=True;break
            time.sleep(1)
        need(ready,'ISOLATED_PC_DATABASE_NOT_READY')
        # SQL reaches ONLY the newly created name, which has no network or host ports.
        for sql in sorted((bundle/'source/packages/database/prisma/migrations').glob('*/migration.sql')):
            result=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i',pg,'psql','-X','-U','postgres','-d','aia_acreditacao_test','-v','ON_ERROR_STOP=1'],input=sql.read_bytes(),env=env,capture_output=True,timeout=120)
            if result.returncode:
                with (attempt/'synthetic-migration-failure.log').open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(result.stdout+result.stderr)
            need(result.returncode==0,'ISOLATED_PC_FULL_MIGRATION_CHECK_FAILED')
        docker(['create','--name',job,'--pull','never','--network','container:'+pg,'--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--env-file',str(test_env),tag,'node_modules/vitest/vitest.mjs','run','--project','integration','tests/integration/event-removal.test.ts','--maxWorkers','1','--no-file-parallelism','--no-cache']);made_job=True
        docker(['start','--attach',job],attempt/'isolated-database-checks.log',timeout=240)
        state=json.loads(docker(['inspect','--format','{{json .State}}',job]))
        need(state['Status']=='exited'and state['ExitCode']==0 and not state.get('OOMKilled'),'ISOLATED_DATABASE_TESTS_MUST_EXIT_ZERO')
        print('EVENT_REMOVAL_REAL_DATABASE_HISTORY_SCOPE_AND_RETRY_CHECKS_PASSED',flush=True)
    finally:
        for name,made in [(job,made_job),(pg,made_pg)]:
            if made:docker(['stop','--time','30',name])
        # Retain containers and synthetic volumes for inspection; no automatic deletion.
    (work / ('checks-passed-' + stamp + '.json')).write_text(json.dumps({
        'passed': True, 'material': MATERIAL, 'testImage': tag, 'productionChanged': False,
        'databaseContacted': True, 'productionDatabaseContacted': False, 'isolatedDatabaseVerified': True, 'emailSent': False}))
    (work / 'pc-build-approved.json').write_text(json.dumps({'approved': True, 'material': MATERIAL}))
    print('OFFLINE_EVENT_REMOVAL_AND_TYPES_PASSED_BUILDING_APPLICATION_IMAGES', flush=True)
    result = subprocess.run([sys.executable, '-B', '-u', str(root / 'build_pc.py'), str(work)])
    need(result.returncode == 0, 'APPLICATION_BUILD_FAILED_NO_UPLOAD_OR_VPS_CHANGE')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('STOP: ' + (str(error) if type(error) is RuntimeError and re.fullmatch('[A-Z0-9_]+', str(error)) else type(error).__name__))
        sys.exit(1)
