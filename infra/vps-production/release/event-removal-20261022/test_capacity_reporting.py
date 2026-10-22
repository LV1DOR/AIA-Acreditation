import importlib.util, io, json, unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('event-removal_capacity', Path(__file__).with_name('deploy_approved.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
d.EXPECTED_IDS.update({r: 'sha256:' + str(i) * 64 for i, r in enumerate(d.ROLES, 1)})

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
        with patch.object(d.subprocess, 'run', return_value=result) as child, patch.object(d.time, 'sleep') as sleep, redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, '^HOST_MEMORY_PRESSURE$'): d.capacity_preflight('steady')
        self.assertEqual(child.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_called_with(15)
        self.assertIn('HOST_MEMORY_PRESSURE', output.getvalue())
        self.assertIn('1536', output.getvalue())
        self.assertNotIn('SYNTHETIC_PRIVATE_DETAIL', output.getvalue())

    def test_transient_pressure_rechecks_full_gate_without_weakening_it(self):
        blocked = SimpleNamespace(returncode=1, stdout=json.dumps({'passed': False, 'stopReasons': ['HOST_MEMORY_PRESSURE']}), stderr='')
        passed = SimpleNamespace(returncode=0, stdout=json.dumps({'passed': True, 'stopReasons': []}), stderr='')
        with patch.object(d.subprocess, 'run', side_effect=[blocked, passed]) as child, patch.object(d.time, 'sleep') as sleep:
            d.capacity_preflight('steady')
        self.assertEqual(child.call_count, 2)
        self.assertEqual(child.call_args_list[0], child.call_args_list[1])
        sleep.assert_called_once_with(15)

    def test_other_blocker_never_retries_or_sleeps(self):
        blocked = SimpleNamespace(returncode=1, stdout=json.dumps({'passed': False, 'stopReasons': ['HOST_MEMORY_PRESSURE', 'OOM_EVIDENCE_REVIEW_REQUIRED']}), stderr='')
        with patch.object(d.subprocess, 'run', return_value=blocked) as child, patch.object(d.time, 'sleep') as sleep:
            with self.assertRaises(RuntimeError): d.capacity_preflight('steady')
        child.assert_called_once()
        sleep.assert_not_called()

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
