"""Only confirmed rollback state can be retried; files and previous attempts stay intact."""
import contextlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('capacity_retry',Path(__file__).with_name('deploy_approved.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class CapacityRetry(unittest.TestCase):
 def test_exact_rollback_is_accepted_read_only_and_changed_bindings_are_refused(self):
  with tempfile.TemporaryDirectory()as t:
   kit=Path(t);state=kit/'state';state.mkdir();prior=state/'event-removal-attempt-20261022T134657865483Z';prior.mkdir()
   (prior/'rollback-result.json').write_text(json.dumps({'previousReleaseRestored':True}));(prior/'files.json').write_text(json.dumps(['state/bindings']));(prior/'0-bindings').write_text('original');(state/'bindings').write_text('original')
   (state/'event-removal-failure-20261022T134855831753Z.json').write_text(json.dumps({'code':'INSUFFICIENT_PEAK_MEMORY_HEADROOM'}))
   second=state/'event-removal-attempt-20261022T140148838904Z';second.mkdir()
   for name in ['rollback-result.json','files.json','0-bindings']:(second/name).write_bytes((prior/name).read_bytes())
   (state/'event-removal-failure-20261022T140246418118Z.json').write_text(json.dumps({'code':'MIGRATION_TOOLS_CAP_MUST_REMAIN_768_MIB'}))
   before={str(p):p.read_bytes()for p in kit.rglob('*')if p.is_file()}
   with patch.object(d,'KIT',kit),patch.object(d,'STATE',state),contextlib.redirect_stdout(io.StringIO()):d.verify_capacity_rollback_retry()
   self.assertEqual(before,{str(p):p.read_bytes()for p in kit.rglob('*')if p.is_file()})
   (state/'bindings').write_text('changed')
   with patch.object(d,'KIT',kit),patch.object(d,'STATE',state),self.assertRaisesRegex(RuntimeError,'ROLLBACK_BINDINGS_CHANGED'):d.verify_capacity_rollback_retry()
 def test_unreviewed_additional_attempt_is_refused(self):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);(state/'event-removal-attempt-unknown').mkdir()
   with patch.object(d,'STATE',state),self.assertRaisesRegex(RuntimeError,'EXACT_INSPECTED_CAPACITY_ROLLBACK_REQUIRED'):d.verify_capacity_rollback_retry()
 def test_tools_keep_original_cap_and_use_quiesced_gate_before_running(self):
  writer=lambda name:{'Id':name,'State':{'Status':'exited','Running':False}}
  caps={'services':{'tools':{'mem_limit':768*1024**2,'memswap_limit':768*1024**2}}}
  with patch.object(d,'container',side_effect=writer),patch.object(d,'admit_quiesced_migration',return_value=768)as admit,patch.object(d.production,'cfg',return_value=caps),patch.object(d.production,'receipt'),patch.object(d.production,'dc',return_value='synthetic')as dc:
   self.assertEqual(d.quiesced_migration_tool(True,('-e','BACKUP_RECEIPT_FILE=/backups/synthetic')),'synthetic')
   admit.assert_called_once_with({'web':'web','worker':'worker'});self.assertIn('--preflight',dc.call_args.args);self.assertIn('--no-deps',dc.call_args.args)
   caps['services']['tools']['mem_limit']=384*1024**2;dc.reset_mock()
   with self.assertRaisesRegex(RuntimeError,'MIGRATION_TOOLS_CAP_MUST_REMAIN_768_MIB'):d.quiesced_migration_tool(True,())
   dc.assert_not_called()
if __name__=='__main__':unittest.main()
