"""Failed-workspace guards only: no Docker, secrets, builds or live state."""
import hashlib,importlib.util,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('retry_source',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
PIN='389fe5b48c883868f8f7afb09f0b01b71c3dce4f911053751cacc2ea30f3ad9e'
class RetryGuards(unittest.TestCase):
 def fixture(self,root):
  source=root/'event-removal-release';source.mkdir();file=source/'index.ts';file.write_text('synthetic old source')
  manifest=source/'MANIFEST.sha256';manifest.write_text(hashlib.sha256(file.read_bytes()).hexdigest()+'  index.ts\n')
  real=r.digest
  return file,lambda p:PIN if p==manifest else real(p)
 def test_exact_failed_bundle_is_accepted_without_writing(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);f,digest=self.fixture(root);before={p.relative_to(root):p.read_bytes() for p in root.rglob('*')if p.is_file()}
   with patch.object(r,'digest',side_effect=digest):r.verify_failed_workspace(root)
   self.assertEqual(before,{p.relative_to(root):p.read_bytes()for p in root.rglob('*')if p.is_file()})
 def test_completed_checks_or_build_cannot_be_overwritten(self):
  for marker in ['checks-passed-synthetic.json','build-output.json','failed-source-184da94ddcb5']:
   with tempfile.TemporaryDirectory()as t:
    root=Path(t);f,digest=self.fixture(root);(root/marker).write_text('keep')
    with patch.object(r,'digest',side_effect=digest),self.assertRaises(RuntimeError):r.verify_failed_workspace(root)
    self.assertEqual((root/marker).read_text(),'keep')
 def test_modified_previous_source_or_manifest_stops_before_installation(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);f,digest=self.fixture(root);f.write_text('changed')
   with patch.object(r,'digest',side_effect=digest),self.assertRaisesRegex(RuntimeError,'PREVIOUS_SOURCE_CHANGED'):r.verify_failed_workspace(root)
   with self.assertRaisesRegex(RuntimeError,'EXPECTED_FAILED_SOURCE_MANIFEST'):r.verify_failed_workspace(root)
 def test_exact_failed_manifest_pin_and_build_index_surface(self):
  self.assertIn(PIN,Path(r.__file__).read_text())
  source=Path('/home/luke/aia-accreditation-event-removal-20261022/source/packages/domain/src/index.ts')
  if not source.exists():self.skipTest('operator-held build context')
  text=source.read_text();self.assertNotIn('./privacy/communication-cleanup.ts',text);self.assertNotIn('./events/deletion.ts',text)
  self.assertEqual(text.count('export { removeCompanyFromEvent, removePersonFromEvent }'),1)
if __name__=='__main__':unittest.main()
