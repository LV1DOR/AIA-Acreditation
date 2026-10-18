"""Offline event UI release/rollback guard checks. No Docker or data operations."""
import contextlib,hashlib,io,json,shutil,unittest
from pathlib import Path
from unittest.mock import patch
import deploy as d
import wizard_release as w
import test_privacy_release as fixtures
from prepare import envput
REAL_REPO=d.REPO
REAL_KIT=d.KIT

class EventsReleaseTests(unittest.TestCase):
    manifest=fixtures.PrivacyReleaseTests.manifest
    preserved=fixtures.PrivacyReleaseTests.preserved
    def setUp(self):
        fixtures.PrivacyReleaseTests.setUp(self)
        for name in ['privacy-ui-v2','event-ui']:
            shutil.copytree(REAL_KIT/'review'/name,self.kit/'review'/name)
        for item in w.changes_for(w.EVENT_UI_RELEASE,self.kit):
            if item['before'] is not None:
                p=self.repo/item['path'];p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(REAL_REPO/item['path'],p)
        self.base=d.materials();self.original_build['sourceSha']=self.base['sourceSha']
        w.save(self.state/'images.json',self.original_build);self.before['images.json']=(self.state/'images.json').read_bytes()

    def test_candidate_is_cumulative_and_active_accepts_exact_new_setup_hash(self):
        value=self.manifest(w.EVENT_UI_RELEASE);w.save(self.state/'active-release.json',{'release':w.EVENT_UI_RELEASE})
        self.assertEqual(w.active(self.state,self.kit),value)
        source=Path(value['source']);setup=(source/w.TARGET).read_text()
        self.assertIn('deleteUnusedEventAction',setup)
        self.assertNotIn('next={`${base}&step=3&eventId=${event.id}`}',setup)
        self.assertNotIn('${base}&step=2&eventId=${event.id}',setup)
        self.assertIn('logger.error("CLEANUP_FAILED")',(source/'apps/worker/src/main.ts').read_text())
        self.assertEqual(w.digest(self.repo/w.TARGET),w.BEFORE)
        (source/w.TARGET).write_text(setup+'\nUNREVIEWED')
        with self.assertRaisesRegex(RuntimeError,'REVIEWED_RELEASE_SOURCE_CHANGED'):w.active(self.state,self.kit)
        self.preserved()

    def test_kit_transition_preserves_old_receipts_with_or_without_prior_logger_upgrade(self):
        w.authorize_kit(d)
        w.save(self.kit/'privacy-logger-fix-baseline.json',{'deploymentKit':{'kit':'privacy'}})
        with patch.object(d,'kit_materials',return_value={'kit':'logger'}):w.authorize_kit(d)
        before={p.name:p.read_bytes() for p in self.state.glob('*kit.json')}
        w.save(self.kit/'events-release-baseline.json',{'deploymentKit':{'kit':'logger'}})
        with patch.object(d,'kit_materials',return_value={'kit':'events'}):
            w.authorize_kit(d);w.authorize_kit(d)
            self.assertEqual(w.installed_kit(self.state,self.kit,d.kit_materials()),{'kit':'base'})
        for name,data in before.items():self.assertEqual((self.state/name).read_bytes(),data)
        with self.assertRaisesRegex(RuntimeError,'EVENTS_RELEASE_KIT_CHANGED'):w.installed_kit(self.state,self.kit,{'kit':'changed'})
        with patch.object(d,'kit_materials',return_value={'kit':'changed'}):
            with self.assertRaisesRegex(RuntimeError,'EVENTS_RELEASE_KIT_CHANGED'):w.authorize_kit(d)
        # Operator may have stopped before deploying v2. The exact intermediate
        # receipt can be installed additively without running any v2 build.
        (self.state/'privacy-logger-fix-kit.json').unlink();(self.state/'events-release-kit.json').unlink()
        with patch.object(d,'kit_materials',return_value={'kit':'events'}):
            w.authorize_kit(d);self.assertEqual(w.installed_kit(self.state,self.kit,d.kit_materials()),{'kit':'base'})
        self.preserved()

    def test_failed_activation_returns_to_previous_privacy_v2_and_only_replaces_apps(self):
        old=self.manifest(w.PRIVACY_LOGGER_RELEASE);new=self.manifest(w.EVENT_UI_RELEASE)
        w.save(self.state/'active-release.json',{'release':w.PRIVACY_LOGGER_RELEASE})
        old_receipt=(self.state/'releases'/w.PRIVACY_LOGGER_RELEASE/'release.json').read_bytes();calls=[]
        def replace(_d,log):calls.append(w.load(self.state/'active-release.json')['release'])
        with patch.object(d,'validate'),patch.object(w,'dependency_ids',return_value={'postgres':'same'}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps',side_effect=replace),patch.object(w,'health',side_effect=[RuntimeError('FAILED_CANDIDATE'),None]),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'FAILED_CANDIDATE'):w.activate(d,new)
        self.assertEqual(calls,[w.EVENT_UI_RELEASE,w.PRIVACY_LOGGER_RELEASE]);self.assertEqual(w.active(self.state,self.kit),old)
        self.assertEqual((self.state/'releases'/w.PRIVACY_LOGGER_RELEASE/'release.json').read_bytes(),old_receipt);self.preserved()

    def test_build_checks_event_logic_before_activation_and_reuses_completed_images(self):
        old=self.manifest(w.PRIVACY_LOGGER_RELEASE);w.save(self.state/'active-release.json',{'release':w.PRIVACY_LOGGER_RELEASE})
        original=w.load(self.state/'images.json');original.update(commit='fixture',publicKeyHash=hashlib.sha256(b'pk_test_fixture').hexdigest());w.save(self.state/'images.json',original)
        self.before['images.json']=(self.state/'images.json').read_bytes();old['baseImagesReceiptHash']=w.digest(self.state/'images.json');w.save(self.state/'releases'/w.PRIVACY_LOGGER_RELEASE/'release.json',old)
        (self.state/'secrets').mkdir();envput(self.state/'secrets/web.env',{'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_fixture'})
        admin=self.state/'storage-admin';admin.mkdir();(admin/'mc').write_bytes(b'OFFLINE_CLIENT');w.save(admin/'receipt.json',{'sha256':w.digest(admin/'mc')})
        sha=w.source_candidate(d,w.EVENT_UI_RELEASE)[2]['sourceSha'];images={role:'sha256:'+str(n)*64 for n,role in enumerate(w.ROLES,7)};calls=[];fail=[True]
        def docker(*args,**kw):
            calls.append(args)
            if args[0]=='build':return ''
            if args[:2]==('image','inspect'):
                ref=args[2];image=next((v for role,v in images.items() if role+':events-' in ref),ref)
                return json.dumps([{'Id':image,'Config':{'Labels':{'org.opencontainers.image.revision':sha}}}])
            self.assertEqual(args[0],'run');self.assertIn('--read-only',args);self.assertIn('none',args);self.assertNotIn('--rm',args)
            self.assertNotIn('--env-file',args)
            if '/review/event-checks.mjs' in args:
                self.assertNotIn('--local-fixtures',args)
                if fail[0]:fail[0]=False;raise RuntimeError('EVENT_LOGIC_CHECK_FAILED')
            return 'PASSED'
        with patch.object(d,'docker',side_effect=docker),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'EVENT_LOGIC_CHECK_FAILED'):w.build_candidate(d,w.EVENT_UI_RELEASE)
            self.assertEqual(w.active(self.state,self.kit),old)
            boundary=len(calls);result=w.build_candidate(d,w.EVENT_UI_RELEASE)
        self.assertEqual(result['kind'],w.EVENT_UI_RELEASE)
        self.assertFalse(any(c[0]=='build' for c in calls[boundary:]))
        self.assertTrue(any('/review/event-checks.mjs' in c for c in calls[boundary:]))
        self.assertTrue(any('/app/node_modules/typescript/lib/tsc.js' in c and '--noEmit' in c for c in calls[boundary:]))
        self.assertEqual(w.active(self.state,self.kit),old);self.preserved()

if __name__=='__main__':unittest.main()
