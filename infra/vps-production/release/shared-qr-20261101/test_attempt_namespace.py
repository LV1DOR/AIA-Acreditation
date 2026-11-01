"""Prior release receipts must not block QR deployment; real QR retries still stop."""
import contextlib,importlib.util,io,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('invite_namespace',Path(__file__).with_name('deploy_approved.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class Namespaces(unittest.TestCase):
 def run_guard(self,previous):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);(state/previous).mkdir()
   with patch.object(d.sys,'argv',['deploy_approved.py','--approve-import-backup-and-application-update']),patch.object(d.os,'geteuid',return_value=0),patch('builtins.input',return_value='DEPLOY-SHARED-QR'),patch.object(d,'operation_lock',return_value=contextlib.nullcontext(9)),patch.object(d,'STATE',state),patch.object(d,'MATERIAL',d.OLD),patch.object(d,'approved',side_effect=RuntimeError('GUARD_PASSED_NO_STATE_ACCESS'))as approved,contextlib.redirect_stdout(io.StringIO()):
    with self.assertRaisesRegex(RuntimeError,'GUARD_PASSED_NO_STATE_ACCESS'if previous.startswith('invite-setup-')else'PRIOR_RELEASE_ATTEMPT_INSPECT_BEFORE_RETRY'):d.main()
    self.assertEqual(approved.call_count,1 if previous.startswith('invite-setup-')else 0)
   self.assertTrue((state/previous).is_dir())
 def test_previous_successful_invitation_attempt_is_preserved_and_does_not_block(self):self.run_guard('invite-setup-attempt-synthetic')
 def test_prior_qr_attempt_remains_blocking(self):self.run_guard('shared-qr-attempt-synthetic')
 def test_all_qr_receipt_paths_have_their_own_namespace(self):
  source=Path(d.__file__).read_text()
  for prefix in ['exports-attempt-','exports-failure-']:self.assertNotIn(prefix,source)
  for prefix in ['shared-qr-attempt-*','shared-qr-attempt-','shared-qr-failure-']:self.assertIn(prefix,source)
if __name__=='__main__':unittest.main()
