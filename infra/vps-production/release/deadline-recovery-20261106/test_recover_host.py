"""Public operator command guards; no Docker calls or live configuration reads."""
import importlib.util,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('deadline_host',Path(__file__).with_name('recover.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class HostGuards(unittest.TestCase):
 def test_preview_never_enables_apply_and_always_scopes_project_image_and_mounts(self):
  args=r.arguments('preview',r.PROJECT+'-deadline-preview-20261106T160000Z')
  self.assertIn('--no-deps',args);self.assertIn('never',args);self.assertIn('admin',args);self.assertNotIn('monitor',args);self.assertIn(str(r.ROOT/'compose.recovery.yaml'),args)
  self.assertIn('AIA_DEADLINE_RECOVERY_MODE=preview',args)
  self.assertFalse(any('RECOVERY_CONFIRM='in x for x in args));self.assertFalse(any('prune'in x or 'down'in x for x in args))
 def test_apply_requires_private_scoped_plan_and_explicit_fixed_authorization(self):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);attempt=state/'attempt';attempt.mkdir();plan=attempt/'plan.json';plan.write_text('{}')
   with patch.object(r,'STATE',state):
    args=r.arguments('apply',r.PROJECT+'-deadline-apply-20261106T160000Z',plan)
    self.assertIn('AIA_DEADLINE_RECOVERY_CONFIRM=RESTORE_ONLY_PREVIOUS_APPROVALS_KEEP_10_NOVEMBER',args)
    plan.unlink()
    with self.assertRaisesRegex(RuntimeError,'PRIVATE_RECOVERY_PLAN_REQUIRED'):r.arguments('apply',r.PROJECT+'-deadline-apply-20261106T160000Z',plan)
 def test_arbitrary_commands_and_unrelated_container_names_are_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'FIXED_RECOVERY_MODE_REQUIRED'):r.arguments('shell','unrelated')
  with self.assertRaisesRegex(RuntimeError,'SCOPED_JOB_NAME_REQUIRED'):r.arguments('preview','aia-volunteers-production')
 def test_admin_recovery_cap_and_existing_secret_mount_are_verified(self):
  config={'name':r.PROJECT,'services':{'admin':{'image':'sha256:synthetic','mem_limit':'402653184','memswap_limit':'384m','secrets':[{'source':'web_env','target':'deadline_recovery_env'}]}}}
  r.verify_admin_config(config,'sha256:synthetic')
  config['services']['admin']['mem_limit']='768m'
  with self.assertRaisesRegex(RuntimeError,'384_MIB'):r.verify_admin_config(config,'sha256:synthetic')
  config['services']['admin']['mem_limit']='384m';config['services']['admin']['secrets']=[]
  with self.assertRaisesRegex(RuntimeError,'KEY_READ_ONLY_MOUNT_REQUIRED'):r.verify_admin_config(config,'sha256:synthetic')
if __name__=='__main__':unittest.main()
