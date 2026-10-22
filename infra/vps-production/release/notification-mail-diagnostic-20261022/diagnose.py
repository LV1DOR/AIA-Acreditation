#!/usr/bin/env python3
"""One read-only DB/Clerk diagnostic; no email, claims, restarts or repairs."""
import sys
sys.dont_write_bytecode = True
import getpass, hmac, json, os, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
KIT = ROOT.parents[1]
sys.path.insert(0, str(KIT / 'scripts'))
sys.path.insert(0, str(KIT / 'release/controlled-cutover-20261021'))
from common import STATE, PROJECT, require, operation_lock, put, readenv, safe_main
from capacity_gate import bounded_probe_capacity
import production

EXPECTED_WORKER = 'sha256:5a2f6c37240a3f819b6ff40379aba0ed4f282fe0e702072cb94d51f8759703e7'
EXPECTED_WEB = 'sha256:c3a95615d2e73a00fe99f23725f1c235aefa246fe673a7cf4d7d1cdb476a18b6'

def worker_log_codes(text):
    allowed = {'WORKER_STARTED', 'DEPENDENCY_UNAVAILABLE', 'DELIVERY_FAILED', 'CLEANUP_FAILED', 'COMMUNICATION_CLEANUP_FAILED', 'STARTUP_FAILED'}
    result = {key: 0 for key in sorted(allowed)}
    for line in text.splitlines():
        try: item = json.loads(line)
        except (ValueError, TypeError): continue
        if isinstance(item, dict) and isinstance(item.get('code'), str) and item['code'] in allowed: result[item['code']] += 1
    return result

def inspect_runtime(service):
    require(service in ['web', 'worker'], 'FIXED_APPLICATION_SCOPE_REQUIRED')
    out = production.docker('inspect', '--format', '{{.Image}}|{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.OOMKilled}}', PROJECT + '-' + service + '-1')
    parts = out.split('|')
    require(len(parts) == 5 and re.fullmatch('sha256:[a-f0-9]{64}', parts[0]), 'RUNTIME_INSPECTION_FAILED')
    return dict(image=parts[0], state=parts[1], startedAt=parts[2], restartCount=int(parts[3]), oomKilled=parts[4] == 'true')

def job_arguments(job):
    require(re.fullmatch(re.escape(PROJECT) + r'-mail-diagnostic-[0-9TZ]+', job), 'FIXED_DIAGNOSTIC_SCOPE_REQUIRED')
    return ['docker', '--host', 'unix:///var/run/docker.sock', 'compose', '--project-name', PROJECT,
      '--env-file', str(STATE / 'compose.env'), '-f', str(KIT / 'compose.yaml'), '-f', str(ROOT / 'compose.probe.yaml'),
      '--profile', 'maintenance', 'run', '--name', job, '--no-deps', '--pull', 'never', '-T',
      '-v', str(ROOT / 'inspect_mail.ts') + ':/app/inspect_notification_mail.ts:ro',
      '-e', 'AIA_DIAG_EMAIL', '-e', 'AIA_DIAG_WORKER_STARTED', 'monitor', 'node', 'node_modules/tsx/dist/cli.mjs', '/app/inspect_notification_mail.ts']

def main():
    require(os.geteuid() == 0, 'RUN_IN_VPS_PUTTY_WITH_SUDO')
    email = getpass.getpass('Test leader mailbox to inspect (hidden): ').strip().lower()
    require(3 <= len(email) <= 320 and '@' in email and not any(c in email for c in '\r\n\x00'), 'MAILBOX_REQUIRED')
    os.umask(0o077)
    with operation_lock():
        worker, web = inspect_runtime('worker'), inspect_runtime('web')
        worker_env, monitor_env = (readenv(STATE / 'secrets' / (name + '.env')) for name in ['worker', 'monitor'])
        settings = {'workerClerkLiveKeyConfigured': worker_env.get('CLERK_SECRET_KEY', '').startswith('sk_live_'),
          'diagnosticAndWorkerClerkKeysMatch': bool(worker_env.get('CLERK_SECRET_KEY')) and hmac.compare_digest(worker_env.get('CLERK_SECRET_KEY', ''), monitor_env.get('CLERK_SECRET_KEY', '')),
          'workerSmtpPort': int(worker_env.get('SMTP_PORT', '0')), 'workerSmtpSecure': worker_env.get('SMTP_SECURE') == 'true',
          'workerSmtpCredentialsConfigured': bool(worker_env.get('SMTP_USER') and worker_env.get('SMTP_PASSWORD'))}
        report = {'readOnly': True, 'emailsSent': False, 'servicesRestarted': False,
          'runningReviewedWorkerImage': worker['image'] == EXPECTED_WORKER,
          'runningReviewedWebImage': web['image'] == EXPECTED_WEB, 'worker': worker, 'configuration': settings}
        bounded_probe_capacity(ROOT / 'compose.probe.yaml')
        env = {k:v for k,v in os.environ.items() if not k.startswith(('DOCKER_', 'COMPOSE_', 'AIA_', 'CLERK_', 'SMTP_'))}
        env.update(AIA_DIAG_EMAIL=email, AIA_DIAG_WORKER_STARTED=worker['startedAt'])
        job = PROJECT + '-mail-diagnostic-' + production.stamp()
        print('RUNNING_ONE_READ_ONLY_DATABASE_AND_CLERK_JOB_NO_EMAIL_NO_RETRIES', flush=True)
        result = subprocess.run(job_arguments(job), env=env, cwd=KIT, text=True, capture_output=True, timeout=120)
        try: report['databaseAndRecipient'] = json.loads(result.stdout)
        except ValueError:
            report['databaseAndRecipient'] = {'passed': False, 'containerExitCode': result.returncode,
              'moduleResolutionFailed': 'ERR_MODULE_NOT_FOUND' in result.stderr,
              'bindMountFailed': 'error mounting' in result.stderr, 'rawOutputSuppressed': True}
        report['diagnosticContainerExitCode'] = result.returncode
        logs = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'logs', '--since', '2h', '--tail', '5000', PROJECT + '-worker-1'], capture_output=True, text=True, timeout=30)
        report['workerRecentLogCodes'] = worker_log_codes(logs.stdout + '\n' + logs.stderr)
        path = STATE / 'logs' / ('notification-mail-diagnostic-' + production.stamp() + '.json')
        put(path, report)
        print('PROTECTED_REDACTED_REPORT: ' + str(path))
        print(json.dumps(report, indent=2))

if __name__ == '__main__': safe_main(main)
