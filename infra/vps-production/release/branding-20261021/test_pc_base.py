import importlib.util, json, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('pc_runner', Path(__file__).with_name('run_pc.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class LocalBaseTests(unittest.TestCase):
    def run_case(self, existing):
        calls = []
        def docker(args):
            calls.append(args)
            if args[:2] == ['image', 'inspect']:
                return json.dumps([{'Id': r.BASE, 'Os': 'linux', 'Architecture': 'amd64'}])
            if args[:2] == ['image', 'ls']: return existing
            if args[:2] == ['image', 'tag']: return ''
            self.fail('Unexpected Docker operation')
        return calls, docker

    def test_absent_tag_is_created_from_verified_id(self):
        calls, docker = self.run_case('')
        r.prepare_local_base(docker)
        self.assertIn(['image', 'tag', r.BASE, r.BASE_TAG], calls)

    def test_existing_matching_tag_is_reused(self):
        calls, docker = self.run_case(r.BASE + '\n')
        r.prepare_local_base(docker)
        self.assertFalse(any(x[:2] == ['image', 'tag'] for x in calls))

    def test_different_existing_tag_is_never_overwritten(self):
        calls, docker = self.run_case('sha256:' + '0' * 64)
        with self.assertRaisesRegex(RuntimeError, 'EXISTING_TEST_BASE_TAG_POINTS_TO_DIFFERENT_IMAGE'):
            r.prepare_local_base(docker)
        self.assertFalse(any(x[:2] == ['image', 'tag'] for x in calls))

    def test_reviewed_dockerfile_uses_a_named_reference(self):
        source = Path('/home/luke/aia-accreditation-branding-20261021/Dockerfile.checks')
        if not source.exists(): self.skipTest('VPS source bundle check')
        self.assertEqual(source.read_text().splitlines()[0], 'FROM ' + r.BASE_TAG)

if __name__ == '__main__': unittest.main()
