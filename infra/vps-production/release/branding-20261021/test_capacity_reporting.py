import importlib.util, io, json, unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('branding_capacity', Path(__file__).with_name('deploy_approved.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

class CapacityReportingTests(unittest.TestCase):
    def test_existing_three_images_are_not_loaded_again(self):
        with patch.object(d.production, 'docker', return_value='\n'.join(d.EXPECTED_IDS.values())) as docker:
            d.ensure_images_imported()
            docker.assert_called_once_with('image', 'ls', '--no-trunc', '--quiet')

    def test_missing_image_requires_original_archive_import(self):
        with patch.object(d.production, 'docker', side_effect=['', '']) as docker:
            d.ensure_images_imported()
            self.assertEqual(docker.call_args_list[-1].args, ('load', '--input', str(d.INCOMING / 'images.tar')))

    def test_pressure_failure_remains_blocking_and_prints_only_allowed_diagnostics(self):
        report = {'availableMiB': 5493, 'requiredAvailableMiB': 4679, 'hostHeadroomMiB': 1536,
                  'deficitMiB': 0, 'passed': False, 'stopReasons': ['HOST_MEMORY_PRESSURE'],
                  'unexpected': 'SYNTHETIC_PRIVATE_DETAIL'}
        result = SimpleNamespace(returncode=1, stdout=json.dumps(report), stderr='SYNTHETIC_PRIVATE_DETAIL')
        output = io.StringIO()
        with patch.object(d.subprocess, 'run', return_value=result), redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, '^HOST_MEMORY_PRESSURE$'): d.capacity_preflight('steady')
        self.assertIn('HOST_MEMORY_PRESSURE', output.getvalue())
        self.assertIn('1536', output.getvalue())
        self.assertNotIn('SYNTHETIC_PRIVATE_DETAIL', output.getvalue())

    def test_process_failure_cannot_pass_based_on_report_alone(self):
        result = SimpleNamespace(returncode=1, stdout='{"passed":true}', stderr='')
        with patch.object(d.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError): d.capacity_preflight('steady')

    def test_passing_check_uses_same_interpreter_and_original_live_checker(self):
        result = SimpleNamespace(returncode=0, stdout='{"passed":true,"stopReasons":[]}', stderr='')
        with patch.object(d.subprocess, 'run', return_value=result) as child:
            d.capacity_preflight('steady')
            self.assertEqual(child.call_args.args[0], [d.sys.executable, '-B', str(d.KIT / 'scripts/resource_check.py'), '--phase', 'steady', '--live'])

if __name__ == '__main__': unittest.main()
