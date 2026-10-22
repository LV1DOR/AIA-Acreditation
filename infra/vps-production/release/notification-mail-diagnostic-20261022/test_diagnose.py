import importlib.util, unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('mail_diagnostic', Path(__file__).with_name('diagnose.py'))
d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
class DiagnosticTests(unittest.TestCase):
    def test_logs_expose_only_known_code_counts(self):
        result = d.worker_log_codes('noise secret\n{"code":"DELIVERY_FAILED","private":"secret"}\n{"code":"UNKNOWN_SECRET"}\n{"code":["invalid"]}')
        self.assertEqual(result['DELIVERY_FAILED'], 1)
        self.assertNotIn('secret', str(result)); self.assertNotIn('UNKNOWN_SECRET', result)
    def test_exact_job_has_no_service_changes_and_no_email_in_arguments(self):
        args = d.job_arguments(d.PROJECT + '-mail-diagnostic-20261022T120000Z')
        self.assertIn('--no-deps', args); self.assertIn('--pull', args)
        self.assertIn('monitor', args); self.assertIn('AIA_DIAG_EMAIL', args)
        self.assertFalse(any('@' in arg for arg in args))
        self.assertFalse(any(arg in ['up', 'stop', 'down', 'restart', '--build'] for arg in args))
        self.assertTrue(any(arg.endswith(':/app/inspect_notification_mail.ts:ro') for arg in args))
        with self.assertRaises(RuntimeError): d.job_arguments('unrelated')
    def test_non_root_stops_before_mailbox_or_protected_reads(self):
        with patch.object(d.os, 'geteuid', return_value=1000), patch.object(d.getpass, 'getpass') as prompt, patch.object(d, 'operation_lock') as lock:
            with self.assertRaises(RuntimeError): d.main()
            prompt.assert_not_called(); lock.assert_not_called()
    def test_sql_is_read_only_and_does_not_claim_or_send(self):
        source = Path(__file__).with_name('inspect_mail.ts').read_text()
        self.assertIn('SET TRANSACTION READ ONLY', source)
        self.assertIn("target.username !== 'aia_backup_reader'", source)
        self.assertIn("target.searchParams.get('sslmode') !== 'verify-full'", source)
        self.assertIn('users.getUserList', source)
        for operation in ['.send(', '.sendMail(', 'tx.outboxMessage.update', 'tx.notification.create', 'tx.user.update', '.delete(', 'claimDelivery(', 'deliverNextBusinessEmail(']:
            self.assertNotIn(operation, source)
if __name__ == '__main__': unittest.main()
