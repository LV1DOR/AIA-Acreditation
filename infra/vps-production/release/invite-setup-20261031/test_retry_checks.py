"""Failed-PC-workspace guards; no Docker, provider, secrets or live state access."""
import hashlib,importlib.util,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('invite_retry',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
PIN='235287dcdf6a146c263984c7675a6a6773789c37931a53d4673c0b531f1ffa7f'
class Retry(unittest.TestCase):
 def fixture(self,work):
  b=work/'invite-setup-release';b.mkdir();f=b/'synthetic.ts';f.write_text('synthetic');m=b/'MANIFEST.sha256';m.write_text(hashlib.sha256(f.read_bytes()).hexdigest()+'  synthetic.ts\n');real=r.digest
  return f,lambda p:PIN if p==m else real(p)
 def test_matching_failed_source_is_checked_without_mutating_it(self):
  with tempfile.TemporaryDirectory()as t:
   work=Path(t);f,digest=self.fixture(work);before={str(p):p.read_bytes()for p in work.rglob('*')if p.is_file()}
   with patch.object(r,'digest',side_effect=digest):r.verify_failed_workspace(work)
   self.assertEqual(before,{str(p):p.read_bytes()for p in work.rglob('*')if p.is_file()})
 def test_completed_or_modified_workspace_is_never_overwritten(self):
  for marker in ['build-output.json','checks-passed-synthetic.json','failed-source-e41c04cd2547']:
   with tempfile.TemporaryDirectory()as t:
    work=Path(t);f,digest=self.fixture(work);(work/marker).write_text('keep')
    with patch.object(r,'digest',side_effect=digest),self.assertRaises(RuntimeError):r.verify_failed_workspace(work)
    self.assertEqual((work/marker).read_text(),'keep')
  with tempfile.TemporaryDirectory()as t:
   work=Path(t);f,digest=self.fixture(work);f.write_text('changed')
   with patch.object(r,'digest',side_effect=digest),self.assertRaisesRegex(RuntimeError,'PREVIOUS_SOURCE_CHANGED'):r.verify_failed_workspace(work)
if __name__=='__main__':unittest.main()
