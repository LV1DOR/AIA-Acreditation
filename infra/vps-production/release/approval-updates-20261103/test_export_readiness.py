import importlib.util,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('exports_readiness',Path(__file__).with_name('deploy_approved.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class Readiness(unittest.TestCase):
 def test_signed_out_export_probes_use_synthetic_event_and_discard_bodies(self):
  with patch.object(d.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='403'))as run:
   d.verify_private_exports()
   self.assertEqual(run.call_count,2)
   for call in run.call_args_list:
    self.assertIn('/dev/null',call.args[0]);self.assertIn('00000000-0000-4000-8000-000000000001',call.args[0][-1])
 def test_download_or_missing_route_is_a_blocker(self):
  for code in ['200','404','500']:
   with patch.object(d.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=code)),self.assertRaisesRegex(RuntimeError,'SIGNED_OUT_EXPORT_MUST_BE_DENIED'):d.verify_private_exports()
if __name__=='__main__':unittest.main()
