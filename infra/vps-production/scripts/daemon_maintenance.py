#!/usr/bin/env python3
"""One approved temporary staging outage; operator-only local Docker maintenance.

run: stop staging, restart Docker once, measure, restore the original containers.
recover: restore from this window's checkpoint without another daemon restart.
No builds, recreation, migrations, pruning, image/policy changes or Volunteers mutations.
"""
import sys
sys.dont_write_bytecode = True
import argparse, collections, datetime, importlib, json, os, re, shutil, signal, subprocess, time, traceback
from pathlib import Path
from common import KIT, require
import capacity_snapshot as capacity
import host_memory
import resource_check

PROJECT = 'aia-accreditation-staging'
SERVICES = ('postgres', 'redis', 'minio', 'mailpit', 'web', 'worker', 'ingress')
HEALTH = ('postgres', 'redis', 'minio', 'web', 'worker', 'ingress')
STAGING_KIT = Path('/home/luke/aia-accreditation-staging-kit')
WINDOW = Path('/home/luke/.local/share/aia-accreditation-daemon-window-20261019')
APPROVAL = KIT / 'evidence/daemon-maintenance-approval.json'
EXPECTED = collections.Counter({
    (PROJECT, 'created', 'no'): 1, (PROJECT, 'exited', 'no'): 15,
    (PROJECT, 'running', 'no'): 7,
    ('aia-volunteers-production', 'exited', 'no'): 1,
    ('aia-volunteers-production', 'exited', 'unless-stopped'): 4,
    ('', 'exited', 'no'): 23,
})
FORMAT = '|'.join(['{{.Id}}', '{{index .Config.Labels "com.docker.compose.project"}}',
    '{{index .Config.Labels "com.docker.compose.service"}}', '{{.State.Status}}',
    '{{.HostConfig.RestartPolicy.Name}}', '{{.Image}}', '{{.HostConfig.Memory}}'])

def progress(message):
    # A disconnected output pipe must not bypass the restoration finally block.
    try:
        print(message, flush=True)
    except OSError:
        pass

def inventory():
    ids = capacity.docker_read('ps', '-aq', '--no-trunc').split()
    require(ids and len(set(ids)) == len(ids) and all(re.fullmatch('[a-f0-9]{64}', x) for x in ids), 'WINDOW_INVENTORY_IDS_INVALID')
    result = []
    for line in capacity.docker_read('inspect', '--format', FORMAT, *ids).splitlines():
        fields = line.split('|')
        require(len(fields) == 7, 'WINDOW_INVENTORY_FORMAT_INVALID')
        cid, project, service, status, policy, image, memory = fields
        project = '' if project in ('', '<no value>') else project
        service = '' if service in ('', '<no value>') else service
        require(cid in ids and re.fullmatch('sha256:[a-f0-9]{64}', image) and memory.isdigit(), 'WINDOW_INVENTORY_FIELDS_INVALID')
        result.append(dict(id=cid, project=project, service=service, status=status,
                           policy=policy, image=image, memory=int(memory)))
    require(len(result) == len(ids) and {x['id'] for x in result} == set(ids), 'WINDOW_INVENTORY_INCOMPLETE')
    return sorted(result, key=lambda x: x['id'])

def target_ids(rows):
    running = [x for x in rows if x['status'] == 'running']
    require(len(running) == 7 and all(x['project'] == PROJECT and x['policy'] == 'no' for x in running), 'WINDOW_OTHER_RUNNING_CONTAINERS_OR_POLICY_CHANGED')
    require(collections.Counter(x['service'] for x in running) == collections.Counter(SERVICES), 'WINDOW_EXACT_SEVEN_STAGING_SERVICES_REQUIRED')
    return {x['service']: x['id'] for x in running}

def unchanged(before, now, targets, allowed_states):
    require({x['id'] for x in before} == {x['id'] for x in now}, 'WINDOW_CONTAINER_SET_CHANGED')
    original = {x['id']: x for x in before}
    for row in now:
        old = original[row['id']]
        require(all(row[k] == old[k] for k in ('project', 'service', 'policy', 'image', 'memory')), 'WINDOW_CONTAINER_CONFIGURATION_CHANGED')
        if row['id'] in targets.values():
            require(row['project'] == PROJECT and row['status'] in allowed_states, 'WINDOW_STAGING_STATE_UNSAFE')
        else:
            require(row['status'] == old['status'], 'WINDOW_UNRELATED_CONTAINER_STATE_CHANGED')

def write_record(name, value):
    require(WINDOW.is_dir() and not WINDOW.is_symlink(), 'WINDOW_CHECKPOINT_DIRECTORY_INVALID')
    # Each observation is exclusive. Recovery attempts get distinct log names.
    with (WINDOW / name).open('x') as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(value, output, indent=2)
        output.write('\n')

def error_record(error, phase):
    code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[A-Z0-9_]{4,120}', str(error)) else type(error).__name__
    frames = [{'file': Path(f.filename).name, 'function': f.name, 'line': f.lineno}
              for f in traceback.extract_tb(error.__traceback__)]
    write_record('failure-' + phase + '-' + str(time.time_ns()) + '.json', dict(code=code, frames=frames))
    progress('WINDOW_ERROR_' + phase.upper() + ': ' + code)

def staging_module():
    sys.path.insert(0, str(STAGING_KIT))
    d = importlib.import_module('deploy')
    require(d.PROJECT == PROJECT and d.KIT == STAGING_KIT, 'WINDOW_STAGING_HELPER_SCOPE_MISMATCH')
    d.local_guard()
    d.context()
    return d

def wait_healthy(d, services):
    deadline = time.monotonic() + 180
    while True:
        try:
            d.healthy(services)
            return
        except RuntimeError:
            require(time.monotonic() < deadline, 'WINDOW_STAGING_HEALTH_TIMEOUT')
            time.sleep(2)

def restore(d, baseline, targets):
    # Freeze identity/image/limit/policy and all other containers' states before
    # starting anything. No discovery by name or selection of retained old jobs.
    unchanged(baseline, inventory(), targets, {'exited', 'running'})
    for group, checks in [(('postgres', 'redis', 'minio', 'mailpit'), ('postgres', 'redis', 'minio')),
                          (('web', 'worker'), ('web', 'worker')), (('ingress',), ('ingress',))]:
        unchanged(baseline, inventory(), targets, {'exited', 'running'})
        d.docker('start', *(targets[x] for x in group))
        wait_healthy(d, checks)
    unchanged(baseline, inventory(), targets, {'running'})
    progress('STAGING_RESTORED: seven original containers running; dependency/app/ingress health passed.')
    progress('OTHER_CONTAINERS_UNCHANGED: original IDs, images, limits, policies and states verified.')

def measure(label, cold=False):
    host = capacity.host_sample()
    processes = host_memory.collect()
    write_record(label + '-memory.json', dict(host=host, processes=processes))
    daemon = [x for x in processes['processes'] if x['name'] == 'dockerd' and not x.get('error')]
    require(len(daemon) == 1, 'WINDOW_DAEMON_MEMORY_UNAVAILABLE')
    progress(label.upper() + '_MEMORY: availableMiB=' + str(host['availableMiB']) +
             ' dockerdAnonMiB=' + str(daemon[0]['proportionalMemory']['Pss_AnonMiB']))
    if cold:
        snap = capacity.collect(10, 1)
        current = capacity.host_sample()
        resource_check.validate_snapshot(snap, current['totalMiB'])
        caps, job = resource_check.planned_limits()
        report = resource_check.assess(current, 'maintenance', caps, job,
                                      shutil.disk_usage('/').free // 1024**3, snap)
        write_record('cold-capacity.json', report)
        progress('COLD_CAPACITY_' + ('PASSED' if report['passed'] else 'BLOCKED') +
                 ': availableMiB=' + str(report['availableMiB']) +
                 ' requiredMiB=' + str(report['requiredAvailableMiB']) +
                 ' reasons=' + ','.join(report['stopReasons']))

def restart_daemon():
    # This is the only daemon mutation, once. Never restart containerd/systemd/
    # SSH, change daemon settings, emit profiling signals or install packages.
    env = {k: os.environ[k] for k in ('PATH', 'HOME') if k in os.environ}
    result = subprocess.run(['systemctl', 'restart', 'docker'], env=env, capture_output=True, timeout=120)
    require(result.returncode == 0, 'WINDOW_DOCKER_RESTART_FAILED')
    active = subprocess.run(['systemctl', 'is-active', 'docker'], env=env, capture_output=True, text=True, timeout=20)
    require(active.returncode == 0 and active.stdout.strip() == 'active', 'WINDOW_DOCKER_NOT_ACTIVE')

def run_window(d):
    approval = json.loads(APPROVAL.read_text())
    require(approval.get('approved') is True and approval.get('window') == WINDOW.name and
            approval.get('maxDockerRestarts') == 1 and approval.get('restoreStaging') is True and
            approval.get('productionDeployment') is False, 'WINDOW_APPROVAL_RECORD_REQUIRED')
    require(not WINDOW.exists() and not WINDOW.is_symlink(), 'WINDOW_ALREADY_ATTEMPTED_USE_RECOVER')
    baseline = inventory()
    require(collections.Counter((x['project'], x['status'], x['policy']) for x in baseline) == EXPECTED,
            'WINDOW_INVENTORY_CHANGED_BEFORE_STOP')
    targets = target_ids(baseline)
    d.healthy(HEALTH)
    version = d.docker('version', '--format', '{{.Server.Version}}')
    live_restore = d.docker('info', '--format', '{{.LiveRestoreEnabled}}')
    require(version == '29.8.0' and live_restore == 'false', 'WINDOW_DAEMON_CONFIGURATION_CHANGED_BEFORE_STOP')
    # Private checkpoint exists before the first stop. A second run can never
    # restart the daemon again, even if the first run was interrupted.
    WINDOW.mkdir(mode=0o700)
    write_record('checkpoint.json', dict(project=PROJECT, baseline=baseline, targets=targets,
                 approvedWindow=WINDOW.name, createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat()))
    measure('before')  # Failure here is before any staging mutation.
    error = None
    recovery_error = None
    try:
        progress('STOPPING_STAGING: graceful stop; containers and volumes retained.')
        d.dc('stop', '--timeout', '60', log='daemon-window-stop-' + str(time.time_ns()) + '.log')
        unchanged(baseline, inventory(), targets, {'exited'})
        progress('RESTARTING_DOCKER_ONCE')
        write_record('restart-attempt.json', {'attemptedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        restart_daemon()
        unchanged(baseline, inventory(), targets, {'exited'})
        require(d.docker('version', '--format', '{{.Server.Version}}') == version and
                d.docker('info', '--format', '{{.LiveRestoreEnabled}}') == live_restore,
                'WINDOW_DAEMON_CONFIGURATION_CHANGED_AFTER_RESTART')
        measure('cold', cold=True)
    except BaseException as failure:
        error = failure
        error_record(failure, 'operation')
    finally:
        progress('RESTORING_STAGING')
        try:
            restore(d, baseline, targets)
        except BaseException as failure:
            recovery_error = failure
            error_record(failure, 'recovery')
        if recovery_error is None:
            try:
                measure('restored')
            except BaseException as failure:
                error = error or failure
                error_record(failure, 'measurement')
    if recovery_error:
        raise RuntimeError('WINDOW_RECOVERY_REQUIRED_DAEMON_IS_NOT_RESTARTED_AGAIN') from None
    if error:
        raise RuntimeError('WINDOW_FAILED_STAGING_RESTORED_SEE_PROTECTED_REPORT') from None
    write_record('completed.json', {'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stagingRestored': True})
    progress('MAINTENANCE_PASSED: staging restored; production was not started.')

def recover(d):
    require(WINDOW.is_dir() and not WINDOW.is_symlink() and WINDOW.stat().st_uid == 0 and
            WINDOW.stat().st_mode & 0o077 == 0, 'WINDOW_PRIVATE_CHECKPOINT_REQUIRED')
    checkpoint = json.loads((WINDOW / 'checkpoint.json').read_text())
    require(checkpoint['project'] == PROJECT and checkpoint['approvedWindow'] == WINDOW.name, 'WINDOW_CHECKPOINT_SCOPE_MISMATCH')
    require(target_ids(checkpoint['baseline']) == checkpoint['targets'], 'WINDOW_CHECKPOINT_TARGETS_CHANGED')
    restore(d, checkpoint['baseline'], checkpoint['targets'])
    progress('RECOVERY_PASSED: no daemon restart attempted.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('run', 'recover'))
    args = parser.parse_args()
    require(os.geteuid() == 0, 'RUN_IN_NORMAL_PUTTY_WITH_SUDO')
    os.umask(0o077)
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    for signum in (signal.SIGHUP, signal.SIGTERM):
        signal.signal(signum, interrupted)
    d = staging_module()
    progress('PROTECTED_REPORTS: ' + str(WINDOW))
    if args.action == 'run':
        run_window(d)
    else:
        recover(d)

if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[A-Z0-9_]{4,120}', str(error)) else type(error).__name__
        progress('STOP: ' + code)
        raise SystemExit(1)
