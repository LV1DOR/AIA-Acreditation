"""Exercise the actual orchestration through database tests with every process mocked."""
import contextlib,hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('database_runner',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class DatabaseRunner(unittest.TestCase):
 def execute(self,module,fail_migration=False):
  with tempfile.TemporaryDirectory()as t:
   parent=Path(t);work=parent/('aia-event-removal-'+'1'*32);work.mkdir();b=work/'event-removal-release';b.mkdir()
   migration=b/'source/packages/database/prisma/migrations/20261022000100_event_withdrawal/migration.sql';migration.parent.mkdir(parents=True);migration.write_text('SELECT 1;')
   m=b/'source-manifest.json';m.write_text(json.dumps({'sourceMaterialSha256':module.MATERIAL}))
   (b/'MANIFEST.sha256').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(b))+'\n'for p in [m,migration]))
   oldlog=work/'source-checks.log';oldlog.write_text('keep previous evidence');real_read=Path.read_text;calls=[]
   def read(p,*a,**kw):
    if str(p)=='/proc/sys/kernel/osrelease':return 'microsoft-synthetic'
    if str(p)=='/proc/meminfo':return 'MemAvailable: 9999999 kB\n'
    return real_read(p,*a,**kw)
   def run(cmd,**kw):
    calls.append(cmd)
    if 'SELECT current_database()'in cmd:return SimpleNamespace(returncode=0,stdout=b'aia_acreditacao_test\n',stderr=b'')
    if 'input'in kw:return SimpleNamespace(returncode=1 if fail_migration else 0,stdout=b'',stderr=b'ERROR: 42501\n' if fail_migration else b'')
    if cmd[0]=='/usr/bin/docker':
     if cmd[3]=='inspect':return SimpleNamespace(returncode=0,stdout=json.dumps({'Status':'exited','ExitCode':0,'OOMKilled':False}),stderr='')
     return SimpleNamespace(returncode=0,stdout='',stderr='')
    return SimpleNamespace(returncode=0)
   with patch.object(module.sys,'argv',['run_pc.py',str(work),'--continue-verified-checks']),patch.object(Path,'home',return_value=parent),patch.object(Path,'read_text',read),patch.object(module,'verify_current_workspace'),patch.object(module,'prepare_local_base'),patch.object(module.subprocess,'run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):
    try:module.main()
    finally:self.last_calls=calls
   self.assertEqual(oldlog.read_text(),'keep previous evidence')
   if not fail_migration:
    self.assertEqual(len(list(work.glob('checks-passed-*.json'))),1)
    self.assertEqual(len(list(work.glob('checks-attempt-*/isolated-database-checks.log'))),1)
    self.assertTrue(any(c[0]==module.sys.executable and 'build_pc.py'in c[3] for c in calls))
   return calls
 def test_readiness_loop_does_not_overwrite_attempt_path_and_build_follows_success(self):self.execute(r)
 def test_sql_failure_retains_real_diagnostic_and_never_builds_application(self):
  with self.assertRaisesRegex(RuntimeError,'ISOLATED_PC_FULL_MIGRATION_CHECK_FAILED'):self.execute(r,True)
  self.assertFalse(any(c[0]==r.sys.executable for c in self.last_calls))
  self.assertTrue(any(c[3]=='stop'for c in self.last_calls if c[0]=='/usr/bin/docker'))
 def test_traceback_never_contains_exception_values_or_credentials(self):
  stream=io.StringIO()
  with patch.object(r,'CURRENT_ATTEMPT',None),contextlib.redirect_stdout(stream):r.report_failure(TypeError('SYNTHETIC_SECRET_MUST_NOT_APPEAR'))
  self.assertNotIn('SYNTHETIC_SECRET_MUST_NOT_APPEAR',stream.getvalue());self.assertEqual(json.loads(stream.getvalue())['exceptionType'],'TypeError')
if __name__=='__main__':unittest.main()
