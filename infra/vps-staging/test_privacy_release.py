"""Offline privacy-release upgrade and rollback checks; no privileged operations."""
import contextlib,hashlib,io,json,shutil,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import deploy as d
import wizard_release as w
from prepare import envput

class PrivacyReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.state=root/'state';self.state.mkdir();self.repo=root/'repo';self.repo.mkdir();self.kit=root/'kit';self.kit.mkdir()
        review=self.kit/'review/privacy-ui';shutil.copytree(d.KIT/'review/privacy-ui/overlay',review/'overlay');shutil.copyfile(d.KIT/'review/privacy-ui/release.json',review/'release.json')
        for item in w.changes_for(w.PRIVACY_RELEASE,self.kit):
            if item['before'] is not None:
                p=self.repo/item['path'];p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(d.REPO/item['path'],p)
        for name in ('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.tests.json','vitest.config.ts','eslint.config.mjs','.dockerignore'):(self.repo/name).write_text('{}')
        for p in (patch.object(d,'STATE',self.state),patch.object(d,'REPO',self.repo),patch.object(d,'KIT',self.kit),patch.object(d,'kit_materials',return_value={'kit':'privacy'})):
            p.start();self.addCleanup(p.stop)
        self.base=d.materials();self.base_env={'AIA_PROJECT_NAME':d.PROJECT,'AIA_WEB_IMAGE':'sha256:'+'1'*64,'AIA_WORKER_IMAGE':'sha256:'+'2'*64,'AIA_TOOLS_IMAGE':'sha256:'+'3'*64,'AIA_MINIO_IMAGE':'aistor@sha256:'+'4'*64}
        envput(self.state/'compose.env',self.base_env)
        self.original_build={'sourceSha':self.base['sourceSha'],'images':{},'publicKeyHash':'fixture','deploymentKit':{'kit':'base'}}
        w.save(self.state/'images.json',self.original_build)
        self.before={n:(self.state/n).read_bytes() for n in ('images.json','compose.env')}
        w.save(self.kit/'wizard-release-baseline.json',{'deploymentKit':{'kit':'base'}})
        w.save(self.kit/'privacy-release-baseline.json',{'deploymentKit':{'kit':'wizard'}})
        w.save(self.state/'bucket-name-fix.json',{'deploymentKit':{'kit':'base'}})
        w.save(self.state/'wizard-release-kit.json',{'previousDeploymentKit':{'kit':'base'},'deploymentKit':{'kit':'wizard'}})

    def preserved(self):
        for n,b in self.before.items():self.assertEqual((self.state/n).read_bytes(),b)

    def manifest(self,kind):
        folder,source,materials,_=w.source_candidate(d,kind)
        start=4 if kind==w.RELEASE else 7
        images={role:{'id':'sha256:'+str(n)*64,'sourceLabel':materials['sourceSha']} for n,role in enumerate(w.ROLES,start)}
        env=dict(self.base_env)
        for role,item in images.items():env['AIA_'+role.upper()+'_IMAGE']=item['id']
        envput(folder/'compose.env',env)
        value={'kind':kind,'baseImagesReceiptHash':w.digest(self.state/'images.json'),'source':str(source),'composeEnv':str(folder/'compose.env'),'build':{'sourceSha':materials['sourceSha'],'images':images}}
        w.save(folder/'release.json',value);return value

    def test_privacy_candidate_has_exact_reviewed_delta_and_keeps_wizard_fix(self):
        folder,source,materials,_=w.source_candidate(d,w.PRIVACY_RELEASE)
        self.assertEqual(w.digest(source/w.TARGET),w.AFTER)
        self.assertEqual(w.digest(self.repo/w.TARGET),w.BEFORE)
        self.assertTrue((source/'packages/domain/src/privacy/communication-cleanup.ts').exists())
        self.assertEqual(w.source_candidate(d,w.PRIVACY_RELEASE)[2],materials)
        (source/'apps/unreviewed.ts').write_text('unreviewed')
        with self.assertRaisesRegex(RuntimeError,'ONLY_REVIEWED_PRIVACY_CHANGES_ALLOWED'):w.source_candidate(d,w.PRIVACY_RELEASE)
        self.preserved()

    def test_new_kit_receipt_preserves_existing_wizard_receipt_and_rejects_drift(self):
        before=(self.state/'wizard-release-kit.json').read_bytes();w.authorize_kit(d);w.authorize_kit(d)
        self.assertEqual((self.state/'wizard-release-kit.json').read_bytes(),before)
        self.assertEqual(w.installed_kit(self.state,self.kit,{'kit':'privacy'}),{'kit':'base'})
        with self.assertRaisesRegex(RuntimeError,'PRIVACY_RELEASE_KIT_CHANGED'):w.installed_kit(self.state,self.kit,{'kit':'changed'})
        self.preserved()

    def test_transition_from_base_does_not_require_prior_wizard_activation(self):
        (self.state/'wizard-release-kit.json').unlink();w.authorize_kit(d)
        self.assertEqual(w.installed_kit(self.state,self.kit,{'kit':'privacy'}),{'kit':'base'});self.preserved()

    def test_failed_privacy_activation_rolls_back_to_previous_wizard_release(self):
        old=self.manifest(w.RELEASE);new=self.manifest(w.PRIVACY_RELEASE)
        old_receipt=(self.state/'releases'/w.RELEASE/'release.json').read_bytes()
        w.save(self.state/'active-release.json',{'release':w.RELEASE});calls=[]
        def replace(_d,log):calls.append(w.load(self.state/'active-release.json')['release'])
        with patch.object(d,'validate'),patch.object(w,'dependency_ids',return_value={'postgres':'unchanged'}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps',side_effect=replace),patch.object(w,'health',side_effect=[RuntimeError('FAILED_CANDIDATE'),None]),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'FAILED_CANDIDATE'):w.activate(d,new)
        self.assertEqual(calls,[w.PRIVACY_RELEASE,w.RELEASE]);self.assertEqual(w.active(self.state,self.kit),old)
        self.assertEqual((self.state/'releases'/w.RELEASE/'release.json').read_bytes(),old_receipt);self.preserved()

    def test_interrupted_privacy_activation_and_explicit_rollback_keep_predecessor(self):
        old=self.manifest(w.RELEASE);new=self.manifest(w.PRIVACY_RELEASE)
        w.save(self.state/'active-release.json',{'release':w.PRIVACY_RELEASE})
        w.save(self.state/'releases'/w.PRIVACY_RELEASE/'activation.json',{'status':'ACTIVATING','previousRelease':w.RELEASE})
        with patch.object(d,'validate'),patch.object(w,'dependency_ids',return_value={}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps') as replace,patch.object(w,'health'),contextlib.redirect_stdout(io.StringIO()):
            w.activate(d,new);self.assertEqual(replace.call_count,1)
            w.activate(d,new);self.assertEqual(replace.call_count,1)
            w.rollback(d,w.PRIVACY_RELEASE)
        self.assertEqual(w.active(self.state,self.kit),old);self.preserved()

    def test_active_privacy_source_or_storage_configuration_drift_is_rejected(self):
        value=self.manifest(w.PRIVACY_RELEASE);w.save(self.state/'active-release.json',{'release':w.PRIVACY_RELEASE})
        self.assertEqual(w.active(self.state,self.kit),value)
        target=Path(value['source'])/'packages/domain/src/privacy/communication-cleanup.ts';target.write_text('unreviewed')
        with self.assertRaisesRegex(RuntimeError,'REVIEWED_RELEASE_SOURCE_CHANGED'):w.active(self.state,self.kit)
        self.preserved()

    def test_image_checks_precede_activation_and_retry_reuses_completed_builds(self):
        old=self.manifest(w.RELEASE);w.save(self.state/'active-release.json',{'release':w.RELEASE})
        original=w.load(self.state/'images.json');original.update(commit='fixture',publicKeyHash=hashlib.sha256(b'pk_test_fixture').hexdigest());w.save(self.state/'images.json',original)
        self.before['images.json']=(self.state/'images.json').read_bytes()
        # The original wizard receipt still correctly refers to the updated fixture receipt.
        old['baseImagesReceiptHash']=w.digest(self.state/'images.json');w.save(self.state/'releases'/w.RELEASE/'release.json',old)
        (self.state/'secrets').mkdir();envput(self.state/'secrets/web.env',{'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_fixture'})
        admin=self.state/'storage-admin';admin.mkdir();(admin/'mc').write_bytes(b'OFFLINE_CLIENT');w.save(admin/'receipt.json',{'sha256':w.digest(admin/'mc')})
        sha=w.source_candidate(d,w.PRIVACY_RELEASE)[2]['sourceSha'];calls=[];fail=[True]
        images={role:'sha256:'+str(n)*64 for n,role in enumerate(w.ROLES,7)}
        def docker(*args,**kwargs):
            calls.append(args)
            if args[0]=='build':return ''
            if args[:2]==('image','inspect'):
                ref=args[2];image=next((v for role,v in images.items() if role+':privacy-' in ref),ref)
                return json.dumps([{'Id':image,'Config':{'Labels':{'org.opencontainers.image.revision':sha}}}])
            self.assertEqual(args[0],'run');self.assertIn('--read-only',args);self.assertIn('none',args);self.assertNotIn('--rm',args)
            if '/review/cleanup-checks.mjs' in args and fail[0]:fail[0]=False;raise RuntimeError('OFFLINE_CHECK_FAILURE')
            return 'PASSED'
        with patch.object(d,'docker',side_effect=docker),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'OFFLINE_CHECK_FAILURE'):w.build_candidate(d,w.PRIVACY_RELEASE)
            self.assertEqual(w.active(self.state,self.kit),old)
            boundary=len(calls);result=w.build_candidate(d,w.PRIVACY_RELEASE)
        self.assertEqual(result['kind'],w.PRIVACY_RELEASE)
        self.assertFalse(any(c[0]=='build' for c in calls[boundary:]))
        self.assertTrue(any('/review/checks.mjs' in c for c in calls[boundary:]))
        self.assertTrue(any('/review/cleanup-checks.mjs' in c for c in calls[boundary:]))
        self.assertTrue(any('/app/node_modules/typescript/lib/tsc.js' in c and '--noEmit' in c and '--incremental' in c for c in calls[boundary:]))
        self.assertEqual(w.active(self.state,self.kit),old);self.preserved()

if __name__=='__main__':unittest.main()
