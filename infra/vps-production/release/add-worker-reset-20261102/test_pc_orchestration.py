"""Exercise the complete PC runner with simulated Docker; no containers or DB connections."""
import contextlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('exports_runner',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Orchestration(unittest.TestCase):
 def execute(self,fail=False):
  with tempfile.TemporaryDirectory()as t:
   home=Path(t);work=home/('aia-add-worker-reset-'+'1'*32);calls=[];real=Path.read_text
   def read(p,*a,**kw):
    if str(p)=='/proc/sys/kernel/osrelease':return 'microsoft-synthetic'
    if str(p)=='/proc/meminfo':return 'MemAvailable: 9999999 kB\n'
    return real(p,*a,**kw)
   def run(cmd,**kw):
    calls.append(cmd)
    if 'SELECT current_database()'in cmd:return SimpleNamespace(returncode=0,stdout=b'aia_acreditacao_test\n',stderr=b'')
    if 'input'in kw:return SimpleNamespace(returncode=1 if fail else 0,stdout=b'',stderr=b'ERROR: 42501\n'if fail else b'')
    if cmd[0]=='/usr/bin/docker':
     if cmd[3]=='inspect':return SimpleNamespace(returncode=0,stdout=json.dumps({'Status':'exited','ExitCode':0,'OOMKilled':False}),stderr='')
     return SimpleNamespace(returncode=0,stdout='',stderr='')
    return SimpleNamespace(returncode=0)
   with patch.object(r.sys,'argv',['run_pc.py',str(work),'--approved-pc-tests-build-and-upload']),patch.object(Path,'home',return_value=home),patch.object(Path,'read_text',read),patch.object(r,'prepare_local_base'),patch.object(r.subprocess,'run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):
    try:r.main()
    finally:self.calls=calls
   receipt=json.loads(next(work.glob('checks-passed-*.json')).read_text());self.assertTrue(receipt['isolatedDatabaseVerified']);self.assertFalse(receipt['productionDatabaseContacted'])
   self.assertTrue(any('tests/integration/id-all-export.test.ts'in c for c in calls))
   self.assertTrue(any(c[0]==r.sys.executable and 'build_pc.py'in c[3]for c in calls))
   for cmd in calls:
    if cmd[0]=='/usr/bin/docker'and cmd[3]=='create':self.assertNotIn('--publish',cmd);self.assertNotIn('-p',cmd)
 def test_all_checks_must_complete_before_build(self):self.execute()
 def test_database_failure_cannot_start_application_build(self):
  with self.assertRaisesRegex(RuntimeError,'ISOLATED_PC_FULL_MIGRATION_CHECK_FAILED'):self.execute(True)
  self.assertFalse(any(c[0]==r.sys.executable for c in self.calls))
if __name__=='__main__':unittest.main()
