"""Simulated migration admission; no Docker, database or protected state access."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('event_migration',Path(__file__).with_name('deploy_approved.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class MigrationGate(unittest.TestCase):
 def call(self,pending=1,failed=False):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);backups=state/'backups';backups.mkdir();receipt=backups/'synthetic.receipt.json';receipt.write_text(json.dumps({'configuration':{'material':d.OLD},'target':{'database':'aia_accreditation_production'}}))
   tool=patch.object(d,'quiesced_migration_tool');capacity=patch.object(d,'capacity_preflight')
   with patch.object(d,'STATE',state),patch.object(d,'BACKUP_RECEIPT',receipt),tool as mock,capacity as cap:
    results=[json.dumps({'status':'PREFLIGHT_PASSED','pending':pending,'environment':'production'}),'',json.dumps({'status':'PREFLIGHT_PASSED','pending':0,'environment':'production'})]
    mock.side_effect=results if not failed else [results[0],RuntimeError('MIGRATION_FAILED')]
    if pending!=1:
     with self.assertRaisesRegex(RuntimeError,'EXACTLY_ONE_PENDING'):d.migrate_additive()
     self.assertEqual(mock.call_count,1)
    elif failed:
     with self.assertRaisesRegex(RuntimeError,'MIGRATION_FAILED'):d.migrate_additive()
     self.assertEqual(mock.call_count,2)
    else:
     d.migrate_additive();self.assertEqual(mock.call_count,3)
     self.assertFalse(mock.call_args_list[1].args[0])
     self.assertIn('BACKUP_RECEIPT_FILE=/backups/synthetic.receipt.json',mock.call_args_list[1].args[1])
     self.assertIn('MIGRATION_COMPATIBILITY_REVIEWED=true',mock.call_args_list[1].args[1])
    cap.assert_not_called()
 def test_exact_one_additive_migration_and_zero_pending_afterwards(self):self.call()
 def test_unexpected_zero_or_multiple_pending_cannot_apply(self):
  self.call(0);self.call(2)
 def test_failure_stops_without_second_migration_or_data_restore(self):self.call(failed=True)
 def test_missing_receipt_blocks_before_docker(self):
  with patch.object(d,'BACKUP_RECEIPT',None),patch.object(d,'quiesced_migration_tool')as tool:
   with self.assertRaisesRegex(RuntimeError,'FRESH_BACKUP_RECEIPT_REQUIRED'):d.migrate_additive()
   tool.assert_not_called()
if __name__=='__main__':unittest.main()
