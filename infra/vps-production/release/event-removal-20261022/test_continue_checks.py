"""Regression for log collision after corrected source was already installed."""
import contextlib,hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('continue_source',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
PIN='7a3c46130fc89a57e4b8f0343b00c652bd0e334ae92b510814eccb81c7bb186b'
class ContinueChecks(unittest.TestCase):
 def fixture(self,work):
  b=work/'event-removal-release';b.mkdir();p=b/'source-manifest.json';p.write_text(json.dumps({'sourceMaterialSha256':r.MATERIAL}));m=b/'MANIFEST.sha256';m.write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  source-manifest.json\n');return b,m
 def test_corrected_bundle_continues_without_renaming_sources_or_overwriting_logs(self):
  with tempfile.TemporaryDirectory()as t:
   parent=Path(t);work=parent/('aia-event-removal-'+'1'*32);work.mkdir();b,m=self.fixture(work)
   (work/'test-build.log').write_text('original build log');(work/'source-checks.log').write_text('original checks log');(work/'failed-source-184da94ddcb5').mkdir()
   real_read=Path.read_text
   def read(p,*a,**kw):
    if str(p)=='/proc/sys/kernel/osrelease':return 'microsoft-synthetic'
    if str(p)=='/proc/meminfo':return 'MemAvailable: 9999999 kB\n'
    return real_read(p,*a,**kw)
   calls=[]
   def run(cmd,**kw):
    calls.append(cmd);self.assertEqual(cmd[3],'build');self.assertIn('checks-attempt-',kw['stdout'].name);raise RuntimeError('CONTROLLED_STOP_AFTER_BUILD')
   with patch.object(r.sys,'argv',['run_pc.py',str(work),'--continue-verified-checks']),patch.object(Path,'home',return_value=parent),patch.object(Path,'read_text',read),patch.object(r,'verify_current_workspace'),patch.object(r,'prepare_local_base'),patch.object(r.subprocess,'run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):
    with self.assertRaisesRegex(RuntimeError,'CONTROLLED_STOP_AFTER_BUILD'):r.main()
   self.assertEqual(len(calls),1);self.assertTrue(b.exists());self.assertEqual((work/'test-build.log').read_text(),'original build log');self.assertEqual((work/'source-checks.log').read_text(),'original checks log');self.assertEqual(len(list(work.glob('checks-attempt-*'))),1)
 def test_tampered_context_or_completed_build_is_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   work=Path(t);b,m=self.fixture(work);real=r.digest
   with patch.object(r,'digest',side_effect=lambda p:PIN if p==m else real(p)):r.verify_current_workspace(work)
   (b/'source-manifest.json').write_text('changed')
   with patch.object(r,'digest',side_effect=lambda p:PIN if p==m else real(p)),self.assertRaisesRegex(RuntimeError,'CORRECTED_BUNDLE_CHANGED'):r.verify_current_workspace(work)
   (work/'build-output.json').write_text('keep')
   with self.assertRaisesRegex(RuntimeError,'ONLY_FAILED_PRE_BUILD_WORKSPACE'):r.verify_current_workspace(work)
if __name__=='__main__':unittest.main()
