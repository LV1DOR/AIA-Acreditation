"""Offline deployment-transaction tests. No Docker, services or live state access."""
import importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('privacy_release', Path(__file__).with_name('deploy_approved.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
d.IDS.update({r: "sha256:" + str(i) * 64 for i, r in enumerate(d.ROLES, 1)})

class ReleaseTests(unittest.TestCase):
    def test_image_edit_preserves_every_other_environment_line(self):
        old = {'images': {r: {'id': 'sha256:old-' + r} for r in d.IDS}}
        text = '# keep\nOTHER="unchanged"\n' + ''.join('AIA_' + r.upper() + '_IMAGE="sha256:old-' + r + '"\n' for r in d.IDS)
        out = d.edit_compose(text, old).decode()
        self.assertTrue(out.startswith('# keep\nOTHER="unchanged"\n'))
        for r in d.IDS: self.assertIn(d.IDS[r], out)
        with self.assertRaises(RuntimeError): d.edit_compose(text + 'AIA_WEB_IMAGE="duplicate"\n', old)
        with self.assertRaises(RuntimeError): d.edit_compose(text.replace('old-web', 'unexpected'), old)

    def test_restore_pin_preserves_old_backups_and_accepts_new_reviewed_material(self):
        pin = ("['7227a412c854c076fd4df178135bbd116be1cdcf9553e388333579709172308e','1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343','debe402c7cd85914213a0c02f45f084d34d2abdea91467e7d5cc6941dabd94ad','" + d.OLD + "'].includes(manifest.configuration?.material)").encode()
        out = d.patch_restore(b'BEFORE&&' + pin + b'&&AFTER')
        self.assertIn(d.NEW.encode(), out)
        self.assertIn(d.OLD.encode(), out)
        self.assertTrue(out.startswith(b'BEFORE&&') and out.endswith(b'&&AFTER'))
        with self.assertRaises(RuntimeError): d.patch_restore(pin + pin)
        with self.assertRaises(RuntimeError): d.patch_restore(b'unknown release')

    def test_bad_candidate_and_symlink_are_refused(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            (root / 'file').write_text('original')
            manifest = d.digest(root / 'file') + '  file\n'
            d.verify_manifest(root, manifest)
            (root / 'file').write_text('tampered')
            with self.assertRaises(RuntimeError): d.verify_manifest(root, manifest)
            (root / 'link').symlink_to(root / 'file')
            with self.assertRaises(RuntimeError): d.safe_path(root, 'link')
            with self.assertRaises(RuntimeError): d.safe_path(root, '../outside')

    def test_release_bindings_preserve_existing_approvals_and_credentials(self):
        with tempfile.TemporaryDirectory() as t:
            kit = Path(t); state = kit / 'state'; state.mkdir()
            root = kit / 'release/privacy'; root.mkdir(parents=True)
            (kit / 'scripts').mkdir(); (kit / 'runtime').mkdir()
            (kit / 'scripts/common.py').write_text("MATERIAL = '" + d.OLD + "'\n")
            (kit / 'runtime/restore.ts').write_text("['7227a412c854c076fd4df178135bbd116be1cdcf9553e388333579709172308e','1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343','debe402c7cd85914213a0c02f45f084d34d2abdea91467e7d5cc6941dabd94ad','" + d.OLD + "'].includes(manifest.configuration?.material)")
            (kit / 'MANIFEST.sha256').write_text('unused  scripts/common.py\nunused  runtime/restore.ts\n')
            for name in ('deploy_approved.py', 'test_deploy_approved.py'): (root / name).write_text('fixture')
            old = {'images': {r: {'id': 'sha256:old-' + r} for r in d.IDS}}
            (state / 'compose.env').write_text('KEEP="original"\n' + ''.join('AIA_' + r.upper() + '_IMAGE="sha256:old-' + r + '"\n' for r in d.IDS))
            review = {'sourceCommit': d.COMMIT, 'sourceMaterialSha256': d.OLD,
                      'approvedActions': ['readiness'], 'existingEvidence': {'passed': True}}
            meta = {'project': d.PROJECT, 'commit': d.COMMIT, 'material': d.OLD,
                    'restoreQuarantineRequired': True, 'runtimeCredentials': {'fixture': 'UNCHANGED'},
                    'images': {r: old['images'][r]['id'] for r in d.IDS}}
            with patch.object(d, 'KIT', kit), patch.object(d, 'STATE', state), patch.object(d, 'ROOT', root):
                out = d.make_updates({'material': d.NEW}, {'sourceMaterialSha256': d.NEW}, review, meta, old)
            updated = json.loads(out[state / 'review.json'])
            self.assertEqual(updated['approvedActions'], review['approvedActions'])
            self.assertEqual(updated['existingEvidence'], review['existingEvidence'])
            self.assertEqual(json.loads(out[state / 'secrets/meta/recovery-metadata.json'])['runtimeCredentials'], meta['runtimeCredentials'])
            self.assertEqual(review['sourceMaterialSha256'], d.OLD)
            self.assertEqual(meta['material'], d.OLD)
            self.assertEqual(len(out), 8)
            self.assertIn(b'KEEP="original"', out[state / 'compose.env'])

    def transaction(self, failure):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); state = root / 'state'; state.mkdir()
            rollback = root / 'rollback'; rollback.mkdir()
            old = state / 'source'; old.mkdir(); (old / 'marker').write_text('OLD')
            candidate = rollback / 'new-source'; candidate.mkdir(); (candidate / 'marker').write_text('NEW')
            config = state / 'bindings'; config.write_bytes(b'OLD-BINDINGS'); config.chmod(0o600)
            calls = []; failed = False
            def child(action, fd):
                nonlocal failed
                calls.append(('child', action))
                if failure == action and not failed:
                    failed = True
                    raise RuntimeError('INJECTED_FAILURE')
            def dc(*args):
                nonlocal failed
                calls.append(('dc', args))
                if failure == 'up' and args[0] == 'up' and not failed:
                    failed = True
                    raise RuntimeError('INJECTED_FAILURE')
            def info(s): return {'service': s, 'Image': d.IDS.get(s, 'dependency')}
            def snapshot(item): return {'id': item['service']}
            before = {s: {'id': s} for s in ['postgres', 'redis', 'minio', 'ingress']}
            with patch.object(d, 'STATE', state), patch.object(d.production, 'dc', side_effect=dc), \
                 patch.object(d, 'capacity_preflight'), patch.object(d, 'child', side_effect=child), \
                 patch.object(d, 'public_ready'), patch.object(d, 'container', side_effect=info), \
                 patch.object(d, 'snapshot', side_effect=snapshot):
                if failure:
                    with self.assertRaisesRegex(RuntimeError, 'INJECTED_FAILURE'):
                        d.activate({config: b'NEW-BINDINGS'}, candidate, rollback, 9, before)
                    self.assertEqual(config.read_bytes(), b'OLD-BINDINGS')
                    self.assertEqual((state / 'source/marker').read_text(), 'OLD')
                    self.assertTrue((rollback / 'rollback-result.json').exists())
                    self.assertEqual((rollback / 'failed-source/marker').read_text(), 'NEW')
                else:
                    d.activate({config: b'NEW-BINDINGS'}, candidate, rollback, 9, before)
                    self.assertEqual(config.read_bytes(), b'NEW-BINDINGS')
                    self.assertEqual((state / 'source/marker').read_text(), 'NEW')
                    self.assertEqual((rollback / 'old-source/marker').read_text(), 'OLD')
            for kind, args in calls:
                if kind == 'dc':
                    self.assertEqual(args[-2:], ('web', 'worker'))
                    if args[0] == 'up':
                        self.assertIn('--no-deps', args)
                        self.assertIn('--no-build', args)
                        self.assertIn('never', args)
            return calls

    def test_success_replaces_only_web_worker_retains_old_source(self): self.transaction(None)
    def test_validation_failure_restores_bindings_and_source(self): self.transaction('validate')
    def test_partial_container_replacement_failure_restores_old_release(self): self.transaction('up')
    def test_readiness_failure_restores_old_release(self): self.transaction('readiness')

    def test_confirmation_precedes_live_state_reads(self):
        with patch.object(d.sys, 'argv', ['deploy_approved.py', '--approve-import-backup-and-application-update']), \
             patch.object(d.os, 'geteuid', return_value=0), patch('builtins.input', return_value='NO'), \
             patch.object(d, 'operation_lock') as lock:
            with self.assertRaisesRegex(RuntimeError, 'EXPLICIT_DEPLOYMENT_APPROVAL_REQUIRED'): d.main()
            lock.assert_not_called()

if __name__ == '__main__': unittest.main()
