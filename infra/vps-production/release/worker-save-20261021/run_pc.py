#!/usr/bin/env python3
"""PC-only offline tests followed by serial immutable builds. No VPS operations."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, os, re, subprocess, tarfile, time
from pathlib import Path

MATERIAL = '3357a0ac5c73d43dfba4df9ecdd043be0d92ea085c6080413dcc6edf2ab13872'
ARCHIVE_SHA = '8e47dda057858b7e21b5350d302c00b000aa6de2f88c7569e1973988279412e4'
BASE = 'sha256:4e03f3503df6786aa9eb41742995ba0dfff2daab46cb444c762c789f9d0ec509'
BASE_TAG = 'aia-reviewed-tools-base:worker-save-4e03f3503df6'

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

def main():
    need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(), 'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
    need(len(sys.argv) == 3, 'EXPECTED_WORKSPACE_AND_EXPLICIT_APPROVAL')
    need(sys.argv[2] == '--approved-pc-tests-build-and-upload', 'EXPLICIT_PC_APPROVAL_REQUIRED')
    work = Path(sys.argv[1])
    need(work.parent == Path.home() and re.fullmatch(r'aia-worker-save-[a-f0-9]{32}', work.name), 'SAFE_PC_WORKSPACE_REQUIRED')
    need(not work.exists() and not work.is_symlink(), 'NEW_WORKSPACE_REQUIRED_PRESERVE_PREVIOUS_ATTEMPT')
    root = Path(__file__).resolve().parent
    need(digest(root / 'worker-save-source.tar.gz') == ARCHIVE_SHA, 'SOURCE_ARCHIVE_CHECKSUM_MISMATCH')
    os.umask(0o077); work.mkdir(mode=0o700)
    print('PC_WORKSPACE=' + str(work), flush=True)
    with tarfile.open(root / 'worker-save-source.tar.gz', 'r:gz') as archive:
        names = set()
        for member in archive.getmembers():
            rel = Path(member.name)
            need(member.isfile() and member.name not in names and not rel.is_absolute() and
                 '..' not in rel.parts and rel.parts[0] == 'worker-save-release', 'SAFE_ARCHIVE_MEMBERS_REQUIRED')
            names.add(member.name)
        archive.extractall(work, filter='data')
    bundle = work / 'worker-save-release'
    manifest = (bundle / 'MANIFEST.sha256').read_text()
    for line in manifest.splitlines():
        sha, name = line.split('  ', 1)
        need(digest(bundle / name) == sha, 'EXTRACTED_FILE_CHECKSUM_MISMATCH')
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
    stamp = str(time.time_ns()); tag = 'aia-accreditation-checks/worker-save:' + stamp
    print('BUILDING_OFFLINE_TEST_IMAGE_NO_DOWNLOADS', flush=True)
    docker(['build', '--platform', 'linux/amd64', '--pull=false', '-f', str(bundle / 'Dockerfile.checks'), '-t', tag, str(bundle)], work / 'test-build.log')
    print('RUNNING_WORKER_SELF_PROFILE_EMAIL_AND_TYPE_CHECKS_NO_NETWORK_OR_HOST_VOLUMES', flush=True)
    docker(['run', '--name', 'aia-worker-save-check-' + stamp, '--pull', 'never', '--network', 'none',
            '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--memory', '1536m', '--memory-swap', '1536m', '--pids-limit', '128',
            '--tmpfs', '/tmp:uid=1000,gid=1000,mode=0700,size=256m', tag], work / 'source-checks.log')
    (work / ('checks-passed-' + stamp + '.json')).write_text(json.dumps({
        'passed': True, 'material': MATERIAL, 'testImage': tag, 'productionChanged': False,
        'databaseContacted': False, 'emailSent': False}))
    (work / 'pc-build-approved.json').write_text(json.dumps({'approved': True, 'material': MATERIAL}))
    print('OFFLINE_WORKER_SAVE_AND_TYPES_PASSED_BUILDING_APPLICATION_IMAGES', flush=True)
    result = subprocess.run([sys.executable, '-B', '-u', str(root / 'build_pc.py'), str(work)])
    need(result.returncode == 0, 'APPLICATION_BUILD_FAILED_NO_UPLOAD_OR_VPS_CHANGE')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('STOP: ' + (str(error) if type(error) is RuntimeError and re.fullmatch('[A-Z0-9_]+', str(error)) else type(error).__name__))
        sys.exit(1)
