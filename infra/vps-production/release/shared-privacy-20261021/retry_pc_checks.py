#!/usr/bin/env python3
"""PC-only retry: give Vite a bounded writable temporary config directory.
Preserve original source, manifests, test image/container and logs. No app build.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

sys.dont_write_bytecode = True
BASE = 'sha256:ca82ed9f3409380dfa35b82140b8183f04d6e0dc96ef77fad9c66228d6aab5c0'
MATERIAL = '1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343'


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fixed_dockerfile(original):
    old = '/app/node_modules/.vite /app/.cache'
    need(original.count(old) == 2, 'EXPECTED_TEST_DOCKERFILE_LAYOUT_REQUIRED')
    return original.replace(old, '/app/node_modules/.vite /app/node_modules/.vite-temp /app/.cache')


def run_arguments(name, tag):
    return ['run', '--name', name, '--pull', 'never', '--network', 'none', '--read-only',
            '--memory', '1536m', '--memory-swap', '1536m', '--pids-limit', '128',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--tmpfs', '/tmp:uid=1000,gid=1000,mode=0700,size=256m',
            '--tmpfs', '/app/node_modules/.vite:uid=1000,gid=1000,mode=0700,size=64m',
            '--tmpfs', '/app/node_modules/.vite-temp:uid=1000,gid=1000,mode=0700,size=64m',
            '--tmpfs', '/app/.cache:uid=1000,gid=1000,mode=0700,size=64m', tag]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace', type=Path, default=Path('/home/luke/aia-privacy-check-dytm7re3'))
    a = p.parse_args()
    need('microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower(), 'WSL_PC_ONLY_NEVER_RUN_ON_VPS')
    work = a.workspace
    need(work.parent == Path.home() and bool(re.fullmatch(r'aia-privacy-check-[a-z0-9_]+', work.name))
         and work.is_dir() and not work.is_symlink(), 'EXACT_EXISTING_PC_WORKSPACE_REQUIRED')
    bundle = work / 'privacy-release'
    # Verify the original exported bundle before using any of its Python helpers.
    manifest_path = bundle / 'MANIFEST.sha256'
    need(not manifest_path.is_symlink(), 'ORIGINAL_MANIFEST_REQUIRED')
    need(digest(manifest_path) == 'c2f35a79a5e1cbee518d6886a348c9c4131c922de3186a36c7fd8f273b408048', 'ORIGINAL_BUNDLE_MANIFEST_CHANGED')
    for line in manifest_path.read_text().splitlines():
        h, n = line.split('  ', 1)
        rel = Path(n)
        need(not rel.is_absolute() and '..' not in rel.parts, 'UNSAFE_MANIFEST_PATH')
        path = bundle / rel
        need(path.is_file() and not path.is_symlink() and digest(path) == h, 'ORIGINAL_BUNDLE_MEMBER_CHANGED')
    manifest = json.loads((bundle / 'source-manifest.json').read_text())
    need(manifest['sourceMaterialSha256'] == MATERIAL, 'REVIEWED_SOURCE_MATERIAL_REQUIRED')
    actual = {f.relative_to(bundle / 'source').as_posix() for f in (bundle / 'source').rglob('*') if f.is_file()}
    need(actual == {e['path'] for e in manifest['files']}, 'EXACT_SOURCE_INVENTORY_REQUIRED')
    for e in manifest['files']:
        need(digest(bundle / 'source' / e['path']) == e['sha256'], 'SOURCE_FILE_CHANGED')
    need(hashlib.sha256(json.dumps(manifest['files'], separators=(',', ':')).encode()).hexdigest() == MATERIAL,
         'SOURCE_MATERIAL_HASH_MISMATCH')
    mem = {k: int(v.split()[0]) // 1024 for k, v in
           (line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())}
    need(mem['MemAvailable'] >= 4096, 'PC_MEMORY_HEADROOM_REQUIRED')
    need(input('Type RETRY-CHECKS to approve the corrected PC-only test image and one networkless test container: ') == 'RETRY-CHECKS',
         'EXPLICIT_PC_TEST_RETRY_APPROVAL_REQUIRED')
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('verified_pc_check', bundle / 'check_pc.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    docker = helper.docker
    base = json.loads(docker('image', 'inspect', BASE))[0]
    need(base['Id'] == BASE and base['Os'] == 'linux' and base['Architecture'] == 'amd64', 'PINNED_TOOLS_PLATFORM_REQUIRED')
    selected = docker('image', 'inspect', helper.TAG, '--format', '{{.Id}}').strip()
    need(selected == BASE, 'ORIGINAL_TEST_BASE_TAG_CHANGED')
    # Create a new small Dockerfile; do not alter original bundle members/manifests.
    dockerfile = bundle / 'Dockerfile.checks-vite-temp-v2'
    candidate = fixed_dockerfile((bundle / 'Dockerfile.checks').read_text())
    if dockerfile.exists():
        need(not dockerfile.is_symlink() and dockerfile.read_text() == candidate, 'EXISTING_TEST_DOCKERFILE_CHANGED')
    else:
        with dockerfile.open('x') as f:
            f.write(candidate)
    stamp = str(time.time_ns())
    tag = 'aia-accreditation-checks/privacy:' + MATERIAL[:12] + '-vite-temp-' + stamp
    print('REBUILDING_TEST_HARNESS_ONLY_APPLICATION_SOURCE_UNCHANGED', flush=True)
    docker('build', '--platform', 'linux/amd64', '--pull=false', '--network=none',
           '--file', str(dockerfile), '--tag', tag, str(bundle), log=work / ('build-checks-' + stamp + '.log'))
    print('RUNNING_OFFLINE_SOURCE_TESTS_WITH_BOUNDED_VITE_TMPFS', flush=True)
    docker(*run_arguments('aia-privacy-check-retry-' + stamp, tag), log=work / ('source-checks-' + stamp + '.log'))
    with (work / ('checks-passed-' + stamp + '.json')).open('x') as f:
        json.dump({'passed': True, 'material': MATERIAL, 'productionChanged': False,
                   'applicationImagesRebuilt': False, 'databaseContacted': False, 'emailSent': False}, f, indent=2)
    print('PRIVACY_RUNTIME_CHECKS_PASSED_NO_DATABASE_NO_EMAIL_NO_PRODUCTION_CHANGES')
    print('PC_CHECK_WORKSPACE=' + str(work))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        code = str(e) if isinstance(e, RuntimeError) and re.fullmatch('[A-Z0-9_]+', str(e)) else type(e).__name__
        print('STOP: ' + code)
        raise SystemExit(1)
