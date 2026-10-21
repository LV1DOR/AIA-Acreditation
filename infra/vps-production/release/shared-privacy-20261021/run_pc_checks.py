#!/usr/bin/env python3
"""Resume existing offline PC test image with a disposable writable filesystem.
No image build, existing-container changes, volumes, network or production access.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time

sys.dont_write_bytecode = True
WORK = Path('/home/luke/aia-privacy-check-dytm7re3')
MATERIAL = '1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343'
PREVIOUS = 'aia-privacy-check-retry-1792586219807840244'
TAG = 'aia-accreditation-checks/privacy:' + MATERIAL[:12] + '-vite-temp-1792586219807840244'


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_arguments(name, image):
    # The writable layer belongs only to this new, disposable test container.
    # No host or existing service filesystem is mounted or changed.
    return ['run', '--name', name, '--pull', 'never', '--network', 'none',
            '--user', '1000:1000', '--memory', '1536m', '--memory-swap', '1536m',
            '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--tmpfs', '/tmp:uid=1000,gid=1000,mode=0700,size=256m', image]


def main():
    need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(), 'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
    need(WORK.parent == Path.home() and WORK.is_dir() and not WORK.is_symlink(), 'EXACT_PC_WORKSPACE_REQUIRED')
    bundle = WORK / 'privacy-release'
    manifest = bundle / 'MANIFEST.sha256'
    need(digest(manifest) == 'c2f35a79a5e1cbee518d6886a348c9c4131c922de3186a36c7fd8f273b408048', 'ORIGINAL_MANIFEST_CHANGED')
    for line in manifest.read_text().splitlines():
        h, n = line.split('  ', 1)
        rel = Path(n)
        need(not rel.is_absolute() and '..' not in rel.parts, 'UNSAFE_MANIFEST_PATH')
        path = bundle / rel
        need(path.is_file() and not path.is_symlink() and digest(path) == h, 'ORIGINAL_SOURCE_BUNDLE_CHANGED')
    source = json.loads((bundle / 'source-manifest.json').read_text())
    need(source['sourceMaterialSha256'] == MATERIAL, 'REVIEWED_SOURCE_MATERIAL_REQUIRED')
    actual = {p.relative_to(bundle / 'source').as_posix() for p in (bundle / 'source').rglob('*') if p.is_file()}
    need(actual == {e['path'] for e in source['files']}, 'EXACT_SOURCE_INVENTORY_REQUIRED')
    mem = {k: int(v.split()[0]) // 1024 for k, v in
           (line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())}
    need(mem['MemAvailable'] >= 4096, 'PC_MEMORY_HEADROOM_REQUIRED')
    need(input('Type RUN-CHECKS to approve one new offline PC test container with its own writable filesystem; no image build or deployment: ') == 'RUN-CHECKS',
         'EXPLICIT_PC_TEST_APPROVAL_REQUIRED')
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('verified_pc_helper', bundle / 'check_pc.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    docker = helper.docker
    old = json.loads(docker('inspect', PREVIOUS))[0]
    need(old.get('Name', '').lstrip('/') == PREVIOUS and old['State']['Status'] == 'exited'
         and old['State']['ExitCode'] == 1 and not old['State'].get('OOMKilled'), 'EXPECTED_FAILED_PC_TEST_CONTAINER_REQUIRED')
    image = json.loads(docker('image', 'inspect', TAG))[0]
    need(image['Id'] == old['Image'] and re.fullmatch(r'sha256:[a-f0-9]{64}', image['Id']), 'UNCHANGED_EXISTING_TEST_IMAGE_REQUIRED')
    need(image['Os'] == 'linux' and image['Architecture'] == 'amd64'
         and image['Config']['Entrypoint'] == ['node']
         and image['Config']['Cmd'] == ['/candidate/checks/in_image.mjs'], 'EXACT_PC_CHECK_IMAGE_CONFIGURATION_REQUIRED')
    env = dict(v.split('=', 1) for v in image['Config'].get('Env', []) if '=' in v)
    need(env.get('DEPLOYMENT_ENV') == 'test' and env.get('NODE_ENV') == 'test'
         and env.get('AIA_SYNTHETIC_DATA') == 'true', 'ISOLATED_TEST_ENVIRONMENT_REQUIRED')
    stamp = str(time.time_ns())
    log = WORK / ('source-checks-writable-' + stamp + '.log')
    print('REUSING_VERIFIED_PC_TEST_IMAGE_NO_REBUILD', flush=True)
    print('RUNNING_OFFLINE_TESTS_DISPOSABLE_WRITABLE_LAYER_NO_HOST_VOLUMES', flush=True)
    docker(*run_arguments('aia-privacy-check-writable-' + stamp, image['Id']), log=log)
    with (WORK / ('checks-passed-' + stamp + '.json')).open('x') as f:
        json.dump({'passed': True, 'material': MATERIAL, 'testImage': image['Id'],
                   'productionChanged': False, 'imagesBuilt': False,
                   'databaseContacted': False, 'emailSent': False}, f, indent=2)
    print('PRIVACY_RUNTIME_CHECKS_PASSED_NO_DATABASE_NO_EMAIL_NO_PRODUCTION_CHANGES')
    print('PC_CHECK_WORKSPACE=' + str(WORK))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        code = str(e) if isinstance(e, RuntimeError) and re.fullmatch('[A-Z0-9_]+', str(e)) else type(e).__name__
        print('STOP: ' + code)
        raise SystemExit(1)
