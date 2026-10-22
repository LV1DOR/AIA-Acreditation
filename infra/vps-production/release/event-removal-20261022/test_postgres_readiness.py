"""Reproduce the official-image socket-only initialization phase without Docker."""
import contextlib,importlib.util,io,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('postgres_ready',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Readiness(unittest.TestCase):
 def test_temporary_socket_server_never_opens_migration_gate(self):
  calls=[];tcp_attempts=0
  def run(cmd,**kw):
   nonlocal tcp_attempts
   calls.append(cmd)
   if 'pg_isready'in cmd:
    self.assertIn('127.0.0.1',cmd);tcp_attempts+=1
    return SimpleNamespace(returncode=1 if tcp_attempts<3 else 0)
   self.assertEqual(tcp_attempts,3)
   return SimpleNamespace(returncode=0,stdout=b'aia_acreditacao_test\n')
  with patch.object(r.subprocess,'run',side_effect=run),patch.object(r.time,'sleep')as sleep,contextlib.redirect_stdout(io.StringIO()):r.wait_for_isolated_database('aia-event-removal-db-123',{})
  self.assertEqual(sleep.call_count,2);self.assertEqual(len(calls),4)
 def test_database_missing_or_wrong_name_never_passes_even_with_tcp_ready(self):
  for database_result in [SimpleNamespace(returncode=2,stdout=b''),SimpleNamespace(returncode=0,stdout=b'postgres\n')]:
   def run(cmd,**kw):return SimpleNamespace(returncode=0)if 'pg_isready'in cmd else database_result
   with patch.object(r.subprocess,'run',side_effect=run),patch.object(r.time,'sleep'),self.assertRaisesRegex(RuntimeError,'ISOLATED_PC_DATABASE_NOT_READY'):r.wait_for_isolated_database('aia-event-removal-db-123',{})
 def test_unrelated_container_is_refused_before_any_process(self):
  with patch.object(r.subprocess,'run')as run,self.assertRaisesRegex(RuntimeError,'ISOLATED_PC_DATABASE_NAME_REQUIRED'):r.wait_for_isolated_database('aia-volunteers-postgres-1',{})
  run.assert_not_called()
if __name__=='__main__':unittest.main()
