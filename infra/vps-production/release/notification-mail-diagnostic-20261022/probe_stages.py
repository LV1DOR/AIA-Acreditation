#!/usr/bin/env python3
"""Exact deployed worker render + Clerk/SMTP connection-only probe. No sends/retries."""
import sys
sys.dont_write_bytecode = True
import getpass, hashlib, json, os, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
KIT = ROOT.parents[1]
sys.path.insert(0, str(KIT / 'scripts'))
sys.path.insert(0, str(KIT / 'release/controlled-cutover-20261021'))
from common import STATE, PROJECT, require, operation_lock, put, safe_main
from capacity_gate import bounded_probe_capacity
from diagnose import inspect_runtime, EXPECTED_WORKER
import production

def probe_arguments(job, bundle):
    require(job.startswith(PROJECT + '-mail-stages-') and job[len(PROJECT + '-mail-stages-'):].replace('T','').replace('Z','').isdigit(), 'FIXED_DIAGNOSTIC_SCOPE_REQUIRED')
    require(bundle.name == 'worker-public.mjs' and bundle.parent.parent == STATE / 'logs', 'FIXED_PUBLIC_BUNDLE_COPY_REQUIRED')
    return ['docker', '--host', 'unix:///var/run/docker.sock', 'compose', '--project-name', PROJECT,
      '--env-file', str(STATE / 'compose.env'), '-f', str(KIT / 'compose.yaml'), '-f', str(ROOT / 'compose.probe.yaml'),
      '--profile', 'maintenance', 'run', '--name', job, '--no-deps', '--pull', 'never', '-T',
      '-v', str(ROOT) + ':/app/notification-mail-probe:ro', '-v', str(bundle) + ':/app/worker-artifact.mjs:ro',
      '-v', str(STATE / 'secrets/worker.env') + ':/run/secrets/mail_diagnostic_worker_env:ro',
      '-e', 'AIA_DIAG_EMAIL', 'monitor', 'node', '--max-old-space-size=256', '/app/notification-mail-probe/probe_stages.mjs']

def main():
    require(os.geteuid() == 0, 'RUN_IN_VPS_PUTTY_WITH_SUDO')
    email = getpass.getpass('Test leader mailbox to inspect (hidden): ').strip().lower()
    require(3 <= len(email) <= 320 and '@' in email and not any(x in email for x in '\r\n\x00'), 'MAILBOX_REQUIRED')
    os.umask(0o077)
    with operation_lock():
        worker = inspect_runtime('worker')
        require(worker['image'] == EXPECTED_WORKER and worker['state'] == 'running', 'EXACT_RUNNING_REVIEWED_WORKER_REQUIRED')
        bounded_probe_capacity(ROOT / 'compose.probe.yaml')
        stamp = production.stamp()
        directory = STATE / 'logs' / ('mail-stages-' + stamp)
        directory.mkdir(mode=0o700)
        bundle = directory / 'worker-public.mjs'
        # Copy public immutable application code only, not environment or volumes.
        production.docker('cp', PROJECT + '-worker-1:/app/dist/main.js', str(bundle))
        require(bundle.is_file() and not bundle.is_symlink() and 0 < bundle.stat().st_size <= 32 * 1024 * 1024, 'BOUNDED_PUBLIC_WORKER_BUNDLE_REQUIRED')
        os.chown(bundle, 1000, 1000); bundle.chmod(0o400)
        digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
        env = {k:v for k,v in os.environ.items() if not k.startswith(('DOCKER_', 'COMPOSE_', 'AIA_', 'CLERK_', 'SMTP_'))}
        env['AIA_DIAG_EMAIL'] = email
        job = PROJECT + '-mail-stages-' + stamp
        print('PROBING_EXACT_WORKER_RENDER_AND_CLERK_SMTP_AUTH_NO_EMAIL_NO_DATABASE_NO_RETRIES', flush=True)
        result = subprocess.run(probe_arguments(job, bundle), env=env, cwd=KIT, capture_output=True, text=True, timeout=120)
        try:
            report = json.loads(result.stdout.strip().splitlines()[-1])
            require(isinstance(report, dict) and isinstance(report.get('stages'), list), 'EXPECTED_SANITIZED_STAGE_REPORT')
        except (ValueError, IndexError):
            report = {'probeOutputMissing': True, 'rawOutputSuppressed': True,
              'moduleResolutionFailed': 'ERR_MODULE_NOT_FOUND' in result.stderr,
              'bindMountFailed': 'error mounting' in result.stderr}
        report.update(diagnosticContainerExitCode=result.returncode, deployedWorkerImage=worker['image'], copiedPublicBundleSha256=digest)
        require(inspect_runtime('worker') == worker, 'PRODUCTION_WORKER_CHANGED_DURING_PROBE')
        path = directory / 'report.json'
        put(path, report)
        print('PROTECTED_SANITIZED_REPORT: ' + str(path))
        print(json.dumps(report, indent=2))

if __name__ == '__main__': safe_main(main)
