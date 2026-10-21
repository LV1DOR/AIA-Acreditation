#!/usr/bin/env python3
"""One explicitly approved, schema-compatible worker-save release; no infrastructure changes."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, os, re, shutil, subprocess, time, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KIT = ROOT.parents[1]
sys.path.insert(0, str(KIT / 'scripts'))
sys.path.insert(0, str(KIT / 'release/runtime-review-20261020'))
import production
from common import STATE, PROJECT, COMMIT, MATERIAL, require, approved, operation_lock, locked_child_options, put
from approve_runtime import atomic_write, apply_batch
from fix_ingress_ip import container, snapshot, verify_unchanged

OLD = 'debe402c7cd85914213a0c02f45f084d34d2abdea91467e7d5cc6941dabd94ad'
NEW = '3357a0ac5c73d43dfba4df9ecdd043be0d92ea085c6080413dcc6edf2ab13872'
PUBLIC = '7a2361c32ae4ac4a804ec8324d267a643f95200795611c7c6d695f6a0a515f21'
CANDIDATE = Path('/home/luke/aia-accreditation-worker-save-20261021')
INCOMING = KIT / 'incoming/worker-save-20261021-3357a0ac5c73'
IDS = {}  # Filled only from the verified incoming receipt after explicit approval.
ROLES = ('web', 'worker', 'tools')
EXPECTED_IDS = {}  # Bound only from the verified incoming PC build receipt.
STAGE = 'APPROVAL'

def stage(name):
    global STAGE
    STAGE = name
    print(name, flush=True)

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(1024 * 1024): h.update(chunk)
    return h.hexdigest()

def encoded(obj): return (json.dumps(obj, indent=2) + '\n').encode()

def capacity_summary(stdout, phase):
    """Only memory counters and fixed codes, never raw child diagnostics."""
    try:
        report, _ = json.JSONDecoder().raw_decode(stdout.lstrip())
    except (ValueError, TypeError): report = {}
    if not isinstance(report, dict): report = {}
    result = {'stage': 'CAPACITY_PREFLIGHT', 'phase': phase}
    for key in ('availableMiB', 'requiredAvailableMiB', 'deficitMiB', 'hostHeadroomMiB',
                'productionRemainingPeakMiB', 'additionalJobOrBuildMiB', 'swapUsedMiB'):
        if type(report.get(key)) is int and report[key] >= 0: result[key] = report[key]
    result['stopReasons'] = [code for code in report.get('stopReasons', [])
                             if isinstance(code, str) and re.fullmatch('[A-Z0-9_]{4,100}', code)] if isinstance(report.get('stopReasons'), list) else []
    result['passed'] = report.get('passed') is True
    return result

def current_pressure():
    """Public host counters for diagnosis; admission still uses the live checker."""
    try:
        result = {}
        for line in Path('/proc/pressure/memory').read_text().splitlines():
            kind, *values = line.split()
            if kind in ('some', 'full'):
                value = float(dict(item.split('=') for item in values)['avg10'])
                if 0 <= value < float('inf'): result[kind + 'Avg10'] = value
        return result
    except (OSError, ValueError, KeyError): return {}

def capacity_preflight(phase):
    stage(phase.upper() + '_CAPACITY_PREFLIGHT')
    for attempt in range(1, 4):
        result = subprocess.run([sys.executable, '-B', str(KIT / 'scripts/resource_check.py'),
                                 '--phase', phase, '--live'], cwd=KIT,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120)
        summary = capacity_summary(result.stdout, phase)
        summary.update(exitCode=result.returncode, attempt=attempt,
                       currentHostMemoryPressure=current_pressure())
        print(json.dumps(summary), flush=True)
        if result.returncode == 0 and summary['passed']: return
        # A short-lived pressure sample may settle after image/hash validation.
        # Re-run every admission check; never admit based on available RAM alone.
        if (result.returncode == 1 and not summary['passed'] and
                summary['stopReasons'] == ['HOST_MEMORY_PRESSURE'] and attempt < 3):
            print('MEMORY_PRESSURE_ONLY_WAITING_15_SECONDS_BEFORE_FULL_RECHECK', flush=True)
            time.sleep(15)
            continue
        require(False, summary['stopReasons'][0] if summary['stopReasons']
                else 'CAPACITY_CHECK_FAILED_INSPECT_BEFORE_RETRY')


def ensure_images_imported():
    # Re-loading an already imported archive needlessly repeats daemon work and
    # allocation just before measuring host pressure. Never skip image validation.
    require(set(EXPECTED_IDS) == set(ROLES), 'EXACTLY_THREE_REVIEWED_IMAGE_IDS_REQUIRED')
    present = set(production.docker('image', 'ls', '--no-trunc', '--quiet').splitlines())
    if set(EXPECTED_IDS.values()) <= present:
        print('REUSING_ALREADY_IMPORTED_IMAGES_NO_ARCHIVE_RELOAD', flush=True)
        return
    stage('IMPORTING_VERIFIED_IMAGES_NO_SERVICES_CHANGED')
    production.docker('load', '--input', str(INCOMING / 'images.tar'))

def safe_path(root, name):
    rel = Path(name)
    require(not rel.is_absolute() and '..' not in rel.parts, 'SAFE_MANIFEST_PATH_REQUIRED')
    p = root / rel
    require(not any(x.is_symlink() for x in [p, *p.parents] if x != root.parent), 'SYMLINK_REFUSED')
    return p

def verify_manifest(root, text):
    names = set()
    for line in text.splitlines():
        sha, name = line.split('  ', 1)
        require(name not in names, 'DUPLICATE_MANIFEST_ENTRY')
        names.add(name)
        require(digest(safe_path(root, name)) == sha, 'MANIFEST_CONTENT_CHANGED')
    return names

def edit_compose(text, old_images):
    lines = text.splitlines(keepends=True)
    found = set()
    for i, line in enumerate(lines):
        key, sep, value = line.partition('=')
        if key not in {'AIA_' + role.upper() + '_IMAGE' for role in ROLES}: continue
        require(sep and key not in found, 'UNIQUE_IMAGE_POINTER_REQUIRED')
        role = key[4:-6].lower()
        parsed = json.loads(value.strip()) if value.strip().startswith('"') else value.strip()
        require(parsed == old_images['images'][role]['id'], 'CURRENT_IMAGE_POINTER_CHANGED')
        found.add(key)
        ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
        lines[i] = key + '="' + IDS[role] + '"' + ending
    require(len(found) == 3, 'THREE_IMAGE_POINTERS_REQUIRED')
    return ''.join(lines).encode()

def patch_restore(data):
    previous = "['7227a412c854c076fd4df178135bbd116be1cdcf9553e388333579709172308e','1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343','" + OLD + "'].includes(manifest.configuration?.material)"
    new = previous.replace("'].includes", "','" + NEW + "'].includes")
    require(data.count(previous.encode()) == 1, 'EXACT_RESTORE_RELEASE_ALLOWLIST_REQUIRED')
    return data.replace(previous.encode(), new.encode(), 1)


def child(action, fd):
    result = subprocess.run([sys.executable, '-B', str(KIT / 'scripts/production.py'), action],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            **locked_child_options(fd))
    codes = re.findall(r'^STOP: ([A-Z0-9_]{4,100})$', result.stdout, re.M)
    if result.returncode:
        if codes: print('CHILD_STOP: ' + codes[-1], flush=True)
        raise RuntimeError('RELEASE_CHILD_' + action.upper().replace('-', '_') + '_FAILED')

def public_ready():
    for _ in range(12):
        r = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '10',
                            '--output', '/dev/null', '--write-out', '%{http_code}',
                            'https://app.joinaia.pt/api/health/ready'],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if r.returncode == 0 and r.stdout == '200': return
        time.sleep(2)
    raise RuntimeError('PUBLIC_HTTPS_READINESS_FAILED')

def check_images(images):
    require(images['material'] == NEW and images['commit'] == COMMIT and
            images['publicKeyHash'] == PUBLIC and
            images['operationsMaterialSha256'] == production.STORAGE_OPS_SHA,
            'TRANSFERRED_RELEASE_BINDING_MISMATCH')
    for role, image in IDS.items():
        require(images['images'][role]['id'] == image, 'REVIEWED_IMAGE_ID_REQUIRED')
        info = json.loads(production.docker('image', 'inspect', image))[0]
        labels = info['Config'].get('Labels') or {}
        require(info['Id'] == image and info['Os'] == 'linux' and info['Architecture'] == 'amd64' and
                info['Config']['User'] in ['node', 'aia', '1000', '1000:1000'] and
                labels.get('org.opencontainers.image.revision') == NEW,
                'IMPORTED_IMAGE_PROVENANCE_MISMATCH')
        if role == 'tools':
            require(labels.get('org.aia.storage-provisioning.sha256') == production.STORAGE_OPS_SHA,
                    'REVIEWED_STORAGE_OPS_REQUIRED')

def make_updates(images, manifest, review, metadata, old_images):
    require(review['sourceMaterialSha256'] == OLD and review['sourceCommit'] == COMMIT,
            'ACTIVE_REVIEW_BASELINE_CHANGED')
    require(metadata['material'] == OLD and metadata['project'] == PROJECT and
            metadata['commit'] == COMMIT and metadata['restoreQuarantineRequired'] is True and
            metadata['images'] == {role: old_images['images'][role]['id'] for role in ROLES},
            'RECOVERY_METADATA_BASELINE_CHANGED')
    common_path = KIT / 'scripts/common.py'
    original = common_path.read_bytes()
    pin = ("MATERIAL = '" + OLD + "'").encode()
    require(original.count(pin) == 1, 'EXACT_ACTIVE_MATERIAL_REQUIRED')
    updates = {
        common_path: original.replace(pin, ("MATERIAL = '" + NEW + "'").encode(), 1),
        KIT / 'runtime/restore.ts': patch_restore((KIT / 'runtime/restore.ts').read_bytes()),
        STATE / 'compose.env': edit_compose((STATE / 'compose.env').read_text(), old_images),
        STATE / 'images.json': encoded(images),
        STATE / 'source-manifest.json': encoded(manifest),
    }
    review = json.loads(json.dumps(review))
    review['sourceMaterialSha256'] = NEW
    review['workerSaveReleaseApproval'] = {
        'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'fromMaterial': OLD, 'toMaterial': NEW, 'images': IDS,
        'scope': 'BACKUP_AND_REPLACE_WEB_WORKER_WITH_AUTOMATIC_CODE_ROLLBACK',
        'browserAcceptancePending': True, 'migrationsApproved': False,
        'credentialsChanged': False, 'nginxChangesApproved': False,
    }
    updates[STATE / 'review.json'] = encoded(review)
    metadata = json.loads(json.dumps(metadata))
    metadata.update(material=NEW, images=IDS)
    updates[STATE / 'secrets/meta/recovery-metadata.json'] = encoded(metadata)
    lines = (KIT / 'MANIFEST.sha256').read_text().splitlines()
    seen = set()
    for i, line in enumerate(lines):
        _, name = line.split('  ', 1)
        p = KIT / name
        if p in updates:
            seen.add(p)
            lines[i] = hashlib.sha256(updates[p]).hexdigest() + '  ' + name
    require({common_path, KIT / 'runtime/restore.ts'} <= seen, 'RUNTIME_MANIFEST_ENTRIES_REQUIRED')
    # Bind the reviewed deployment wrapper and tests as well as the existing kit.
    for name in ('deploy_approved.py', 'test_deploy_approved.py'):
        rel = (ROOT / name).relative_to(KIT).as_posix()
        require(all(line.split('  ', 1)[1] != rel for line in lines), 'RELEASE_ALREADY_REGISTERED')
        lines.append(digest(ROOT / name) + '  ' + rel)
    updates[KIT / 'MANIFEST.sha256'] = ('\n'.join(lines) + '\n').encode()
    return updates

def activate(updates, candidate_source, rollback, fd, before):
    originals = {p: p.read_bytes() for p in updates}
    activated = False
    try:
        stage('ACTIVATING_REVIEWED_RELEASE_BINDINGS')
        os.rename(STATE / 'source', rollback / 'old-source')
        activated = True
        os.rename(candidate_source, STATE / 'source')
        apply_batch(updates)
        child('validate', fd)
        capacity_preflight('steady')
        stage('REPLACING_WEB_AND_WORKER_ONLY')
        production.dc('up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                      '--force-recreate', '--wait', '--wait-timeout', '180', 'web', 'worker')
        child('readiness', fd)
        public_ready()
        for s in ('postgres', 'redis', 'minio'):
            verify_unchanged(before[s], snapshot(container(s)))
        require(snapshot(container('ingress'))['id'] == before['ingress']['id'], 'INGRESS_REPLACEMENT_FORBIDDEN')
        for s in ('web', 'worker'):
            require(container(s)['Image'] == IDS[s], 'ACTIVE_APPLICATION_IMAGE_MISMATCH')
        put(rollback / 'result.json', {'passed': True, 'material': NEW,
            'browserAcceptancePending': True, 'freshBackupOffSitePending': True})
        stage('WORKER_SAVE_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY')
        print('NEXT: verify company worker save and My details using approved test identities; copy fresh encrypted backup off-VPS.')
    except Exception:
        if activated:
            stage('ROLLING_BACK_PREVIOUS_APPLICATION_RELEASE_DATA_UNCHANGED')
            production.dc('stop', '--timeout', '60', 'web', 'worker')
            if (STATE / 'source').exists(): os.rename(STATE / 'source', rollback / 'failed-source')
            os.rename(rollback / 'old-source', STATE / 'source')
            for path, data in originals.items(): atomic_write(path, data)
            production.dc('up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                          '--force-recreate', '--wait', '--wait-timeout', '180', 'web', 'worker')
            child('readiness', fd)
            public_ready()
            put(rollback / 'rollback-result.json', {'previousReleaseRestored': True})
            print('PREVIOUS_APPLICATION_RELEASE_RESTORED_NO_DATA_RESTORE', flush=True)
        raise


def main():
    require(sys.argv[1:] == ['--approve-import-backup-and-application-update'], 'EXPLICIT_DEPLOYMENT_FLAG_REQUIRED')
    require(os.geteuid() == 0, 'OPERATOR_SUDO_REQUIRED')
    print('Import the verified three-image archive; fresh encrypted local backup with brief web/worker/ingress pause; then replace web/worker only.')
    print('Preserve PostgreSQL, Redis, AIStor, credentials, volumes and Nginx. No migrations or email.')
    print('On failure, restore previous release bindings and web/worker images. No data restore/deletion.')
    require(input('Type DEPLOY-WORKER-SAVE to approve this update and automatic code rollback: ').strip()
            == 'DEPLOY-WORKER-SAVE', 'EXPLICIT_DEPLOYMENT_APPROVAL_REQUIRED')
    os.umask(0o077)
    with operation_lock() as fd:
        stage('VERIFYING_RELEASE_AND_IMPORTED_IMAGES')
        require(MATERIAL == OLD, 'RELEASE_ALREADY_CHANGED_INSPECT_BEFORE_RETRY')
        require(not list(STATE.glob('worker-save-attempt-*')), 'PRIOR_RELEASE_ATTEMPT_INSPECT_BEFORE_RETRY')
        review = approved('backup-local')
        approved('readiness')
        verify_manifest(KIT, (KIT / 'MANIFEST.sha256').read_text())
        require(digest(CANDIDATE / 'MANIFEST.sha256') ==
                'e0a957e489fb12c62a379d913d0619607dc68dfb06428bff6268d81745c7f943', 'CANDIDATE_MANIFEST_CHANGED')
        verify_manifest(CANDIDATE, (CANDIDATE / 'MANIFEST.sha256').read_text())
        manifest = json.loads((CANDIDATE / 'source-manifest.json').read_text())
        require(manifest['sourceMaterialSha256'] == NEW and manifest['commit'] == COMMIT and
                hashlib.sha256(json.dumps(manifest['files'], separators=(',', ':')).encode()).hexdigest() == NEW,
                'CANDIDATE_SOURCE_MATERIAL_CHANGED')
        for entry in manifest['files']:
            require(digest(safe_path(CANDIDATE / 'source', entry['path'])) == entry['sha256'], 'CANDIDATE_SOURCE_CHANGED')
        verify_manifest(INCOMING, (INCOMING / 'TRANSFER.sha256').read_text())
        images = json.loads((INCOMING / 'images.json').read_text())
        require(set(images['images']) == set(ROLES), 'EXACTLY_THREE_RELEASE_IMAGES_REQUIRED')
        for role in ROLES:
            image = images['images'][role]['id']
            require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'IMMUTABLE_RELEASE_IMAGE_REQUIRED')
            EXPECTED_IDS[role] = image
            IDS[role] = image
        ensure_images_imported()
        check_images(images)
        old_images = json.loads((STATE / 'images.json').read_text())
        require(old_images['material'] == OLD and old_images['publicKeyHash'] == PUBLIC,
                'CURRENT_IMAGES_BASELINE_CHANGED')
        build = json.loads((INCOMING / 'build-review.json').read_text())
        require(build.get('material') == NEW and build.get('baseMaterial') == OLD and
                build.get('allThreeRolesVerified') is True and
                build.get('reviewedStorageOperationsRetained') is True and
                build.get('productionChanged') is False, 'BUILDER_REVIEW_REQUIRED')
        current_source = json.loads((STATE / 'source-manifest.json').read_text())
        database_files = lambda m: {e['path']: e['sha256'] for e in m['files']
                                   if '/prisma/' in e['path']}
        require(database_files(manifest) and database_files(manifest) == database_files(current_source),
                'DATABASE_SCHEMA_OR_MIGRATION_CHANGE_REFUSED')
        production.validate()
        capacity_preflight('steady')
        production.healthy(production.SERVICES)
        before = {s: snapshot(container(s)) for s in production.SERVICES}
        meta = json.loads((STATE / 'secrets/meta/recovery-metadata.json').read_text())
        updates = make_updates(images, manifest, review, meta, old_images)
        rollback = STATE / ('worker-save-attempt-' + production.stamp())
        rollback.mkdir(mode=0o700)
        originals = {p: p.read_bytes() for p in updates}
        for i, (p, data) in enumerate(originals.items()):
            put(rollback / (str(i) + '-' + p.name), data.decode())
        put(rollback / 'files.json', [str(p.relative_to(KIT)) for p in originals])
        print('PROTECTED_ROLLBACK_FILES: ' + str(rollback), flush=True)
        # Stage only the exact manifest files, never developer caches or credentials.
        candidate_source = rollback / 'new-source'
        candidate_source.mkdir(mode=0o700)
        for entry in manifest['files']:
            dst = candidate_source / entry['path']
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(CANDIDATE / 'source' / entry['path'], dst)
        stage('FRESH_ENCRYPTED_BACKUP_BRIEF_APPLICATION_PAUSE')
        backups_before = set((STATE / 'backups').glob('*.receipt.json'))
        child('backup-local', fd)
        fresh = set((STATE / 'backups').glob('*.receipt.json')) - backups_before
        require(len(fresh) == 1, 'ONE_NEW_BACKUP_RECEIPT_REQUIRED')
        put(rollback / 'fresh-backup.json', {'receipt': str(next(iter(fresh))), 'offSiteVerified': False})
        for s in ('postgres', 'redis', 'minio'):
            verify_unchanged(before[s], snapshot(container(s)))
        activate(updates, candidate_source, rollback, fd, before)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        # No exception text, frame locals, child stdout, environment or secret material.
        report = {'passed': False, 'stage': STAGE, 'type': type(error).__name__,
                  'code': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Z0-9_]{4,120}', str(error)) else 'INSPECT_BEFORE_RETRY',
                  'locations': [{'file': Path(f.filename).name, 'function': f.name, 'line': f.lineno}
                                for f in traceback.extract_tb(error.__traceback__)]}
        try:
            path = STATE / ('worker-save-failure-' + production.stamp() + '.json')
            put(path, report)
            print('PROTECTED_SANITIZED_DIAGNOSTIC: ' + str(path))
        except Exception: pass
        print(json.dumps(report))
        sys.exit(1)
