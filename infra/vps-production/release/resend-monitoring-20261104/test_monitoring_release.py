"""Focused migration, secret handling and non-overlap regression tests; no live access."""
import ast,base64,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('resend_release',ROOT/'deploy_approved.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
import webhook_configuration as config
SECRET='whsec_'+base64.b64encode(b'SYNTHETIC-ONLY-'*3).decode()
class SecretHandling(unittest.TestCase):
 def test_adds_only_new_keys_and_preserves_every_existing_byte(self):
  before=b'SMTP_PORT="2465"\nSMTP_PASSWORD="synthetic-existing"\n'
  calls=[]
  def ask(prompt):calls.append(prompt);return SECRET
  result=config.prepare(before,ask)
  self.assertTrue(result.startswith(before));self.assertEqual(result.count(b'RESEND_WEBHOOK_SECRET='),1)
  self.assertIn(b'RESEND_MONITOR_FROM_DOMAINS="notify.joinaia.pt"',result);self.assertEqual(len(calls),2)
  self.assertEqual(config.prepare(result,lambda prompt:self.fail('existing secret must not prompt or rotate')),result)
 def test_mismatch_invalid_api_key_and_scope_overwrite_are_refused(self):
  values=iter([SECRET,SECRET+'x'])
  with self.assertRaisesRegex(RuntimeError,'DO_NOT_MATCH'):config.prepare(b'',lambda p:next(values))
  with self.assertRaisesRegex(RuntimeError,'SIGNING_SECRET'):config.prepare(b'',lambda p:'re_synthetic-not-a-signing-secret')
  with self.assertRaisesRegex(RuntimeError,'SCOPE_REQUIRES_REVIEW'):config.prepare(b'RESEND_MONITOR_FROM_DOMAINS="other.invalid"\n',lambda p:SECRET)
  with self.assertRaisesRegex(RuntimeError,'DUPLICATE'):config.prepare(b'RESEND_WEBHOOK_SECRET=x\nRESEND_WEBHOOK_SECRET=y\n',lambda p:SECRET)
class MigrationGate(unittest.TestCase):
 def setup_receipt(self,root):
  backups=root/'backups';backups.mkdir();receipt=backups/'synthetic.receipt.json'
  receipt.write_text(json.dumps({'configuration':{'material':d.OLD},'target':{'database':'aia_accreditation_production'}}));return receipt
 def test_exact_three_pending_then_zero_then_grants_are_required(self):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);receipt=self.setup_receipt(state)
   with patch.object(d,'STATE',state),patch.object(d,'BACKUP_RECEIPT',receipt),patch.object(d,'MIGRATION_APPLY_FAILED',False),patch.object(d,'quiesced_migration_tool',side_effect=[json.dumps({'status':'PREFLIGHT_PASSED','pending':3,'environment':'production'}),'',json.dumps({'status':'PREFLIGHT_PASSED','pending':0})])as tool,patch.object(d,'quiesced_job')as grants:
    d.migrate_additive();self.assertEqual(tool.call_count,3);grants.assert_called_once_with('provision',('/app/production-ops/provision.ts','grants'));self.assertFalse(d.MIGRATION_APPLY_FAILED)
 def test_unexpected_pending_or_failed_apply_prevents_success(self):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);receipt=self.setup_receipt(state)
   for count in [0,1,2,4]:
    with patch.object(d,'STATE',state),patch.object(d,'BACKUP_RECEIPT',receipt),patch.object(d,'quiesced_migration_tool',return_value=json.dumps({'status':'PREFLIGHT_PASSED','pending':count,'environment':'production'}))as tool,patch.object(d,'quiesced_job')as grants:
     with self.assertRaisesRegex(RuntimeError,'THREE_PENDING'):d.migrate_additive()
     self.assertEqual(tool.call_count,1);grants.assert_not_called()
   with patch.object(d,'STATE',state),patch.object(d,'BACKUP_RECEIPT',receipt),patch.object(d,'MIGRATION_APPLY_FAILED',False),patch.object(d,'quiesced_migration_tool',side_effect=[json.dumps({'status':'PREFLIGHT_PASSED','pending':3,'environment':'production'}),RuntimeError('SYNTHETIC_MIGRATION_FAILURE')]),patch.object(d,'quiesced_job')as grants:
    with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_MIGRATION_FAILURE'):d.migrate_additive()
    self.assertTrue(d.MIGRATION_APPLY_FAILED);grants.assert_not_called()
 def test_monitoring_and_compatibility_tests_are_mandatory(self):
  source=(ROOT/'run_pc.py').read_text()
  for name in ['resend-monitoring.test.ts','resend-migration-compatibility.test.ts','legacy-email-seed.sql','legacy-email-verify.sql','runtime-roles.sql']:self.assertIn(name,source)
  self.assertIn('RESEND_MONITORING',source)
  deploy=(ROOT/'deploy_approved.py').read_text();self.assertIn('MIGRATION_STATE_UNCERTAIN_KEEP_WRITERS_STOPPED',deploy)
  self.assertIn("STATE.glob('resend-monitoring-attempt-*')",deploy)
  self.assertIn("Type DEPLOY-RESEND-MONITORING",deploy)
  contract=json.loads((ROOT/'migration-contract.json').read_text());self.assertEqual(len(contract['newMigrationPaths']),3)
  self.assertTrue(all(contract['candidatePrisma'][n]==h for n,h in contract['basePrisma'].items()if not n.endswith('/schema.prisma')))
if __name__=='__main__':unittest.main()
