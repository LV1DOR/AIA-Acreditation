import importlib.util, unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('push_verified', Path(__file__).with_name('push_verified.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class PushTests(unittest.TestCase):
    def setUp(self):
        key = patch.object(m, 'KEY')
        key.start().lstat.return_value = SimpleNamespace(st_mode=0o100600)
        self.addCleanup(key.stop)

    def test_remote_head_requires_exact_branch_and_commit(self):
        with patch.object(m, 'git', return_value='a' * 40 + '\trefs/heads/master'):
            self.assertEqual(m.remote_head(), 'a' * 40)
        for value in ('', 'bad refs/heads/master', 'a' * 40 + ' refs/heads/other'):
            with patch.object(m, 'git', return_value=value):
                with self.assertRaises(RuntimeError): m.remote_head()

    def test_push_failure_cannot_print_verification_marker(self):
        def git(*args):
            if args == ('remote', 'get-url', 'origin'): return m.ORIGIN
            if args == ('branch', '--show-current'): return 'master'
            if args == ('status', '--porcelain'): return ''
            if args == ('rev-parse', 'HEAD'): return 'a' * 40
            if args[0] == 'push': raise RuntimeError('REPOSITORY_NOT_FOUND_OR_KEY_NOT_AUTHORISED')
            self.fail('Unexpected Git operation')
        with patch.object(m.os, 'geteuid', return_value=1000), patch.object(m, 'git', side_effect=git), \
             patch.object(m, 'remote_head', return_value='b' * 40), patch('builtins.print') as output:
            with self.assertRaises(RuntimeError): m.main()
            output.assert_not_called()

    def test_zero_exit_push_still_requires_remote_verification(self):
        def git(*args):
            if args == ('remote', 'get-url', 'origin'): return m.ORIGIN
            if args == ('branch', '--show-current'): return 'master'
            if args == ('status', '--porcelain'): return ''
            if args == ('rev-parse', 'HEAD'): return 'a' * 40
            if args == ('push', '--porcelain', 'origin', 'HEAD:refs/heads/master'): return ''
            self.fail('Unexpected or force Git operation')
        with patch.object(m.os, 'geteuid', return_value=1000), patch.object(m, 'git', side_effect=git), \
             patch.object(m, 'remote_head', return_value='b' * 40), patch('builtins.print') as output:
            with self.assertRaisesRegex(RuntimeError, 'REMOTE_MASTER_VERIFICATION_FAILED'): m.main()
            output.assert_not_called()

if __name__ == '__main__': unittest.main()
