"""Import the actual installed launcher without Docker, secrets or network access."""
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch

class LauncherChecks(unittest.TestCase):
 def test_actual_imports_and_memory_encodings(self):
  with patch('subprocess.run', side_effect=AssertionError('NO_SUBPROCESSES_ALLOWED')):
   module=runpy.run_path(str(Path(__file__).with_name('send.py')),run_name='notice_import_test')
   self.assertEqual(module['memory_bytes']('402653184'),384*1024**2)
   self.assertEqual(module['memory_bytes']('384m'),384*1024**2)
 def test_unapproved_invocation_stops_before_docker(self):
  with patch('subprocess.run', side_effect=AssertionError('NO_SUBPROCESSES_ALLOWED')):
   module=runpy.run_path(str(Path(__file__).with_name('send.py')),run_name='notice_import_test')
   with patch('sys.argv',['send.py']):
    with self.assertRaisesRegex(RuntimeError,'EXPLICIT_SEND_FLAG_REQUIRED'):
     module['main']()

if __name__=='__main__':unittest.main()
