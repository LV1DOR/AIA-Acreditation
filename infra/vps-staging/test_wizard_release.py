"""Offline upgrade/rollback tests. All Docker and service calls are mocked."""
import contextlib,hashlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
import deploy as d
import wizard_release as w
from prepare import envput

class WizardReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.state=root/'state';self.state.mkdir();self.repo=root/'repo';self.repo.mkdir()
        self.kit=root/'kit';self.kit.mkdir()
        target=self.repo/w.TARGET;target.parent.mkdir(parents=True);target.write_bytes((d.REPO/w.TARGET).read_bytes())
        for name in ('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.tests.json','vitest.config.ts','eslint.config.mjs','.dockerignore'):(self.repo/name).write_text('{}')
        self.base_env={'AIA_PROJECT_NAME':d.PROJECT,'AIA_WEB_IMAGE':'sha256:'+'1'*64,'AIA_WORKER_IMAGE':'sha256:'+'2'*64,'AIA_TOOLS_IMAGE':'sha256:'+'3'*64,'AIA_MINIO_IMAGE':'fixture/aistor@sha256:'+'4'*64,'AIA_HTTPS_BIND_PORT':'18443'}
        envput(self.state/'compose.env',self.base_env)
        self.before_kit={'deploy.py':'before'};self.after_kit={'deploy.py':'after'}
        w.save(self.kit/'wizard-release-baseline.json',{'deploymentKit':self.before_kit})
        w.save(self.state/'bucket-name-fix.json',{'deploymentKit':self.before_kit})
        for p in (patch.object(d,'STATE',self.state),patch.object(d,'REPO',self.repo),patch.object(d,'KIT',self.kit),patch.object(d,'kit_materials',return_value=self.after_kit)):
            p.start();self.addCleanup(p.stop)
        self.base=d.materials()
        self.build={'commit':'fixture-commit','sourceSha':self.base['sourceSha'],'publicKeyHash':hashlib.sha256(b'pk_test_fixture').hexdigest(),'images':{role:{'id':self.base_env['AIA_'+role.upper()+'_IMAGE']} for role in w.ROLES},'deploymentKit':self.before_kit}
        w.save(self.state/'images.json',self.build)
        self.original={n:(self.state/n).read_bytes() for n in ('compose.env','images.json','bucket-name-fix.json')}

    def assert_preserved(self):
        for n,data in self.original.items():self.assertEqual((self.state/n).read_bytes(),data,n)

    def manifest(self):
        folder,source,materials,_=w.source_candidate(d)
        images={role:{'id':'sha256:'+str(n)*64,'sourceLabel':materials['sourceSha']} for n,role in enumerate(w.ROLES,5)}
        env={**self.base_env,**{'AIA_'+role.upper()+'_IMAGE':item['id'] for role,item in images.items()}}
        envput(folder/'compose.env',env)
        m=dict(kind=w.RELEASE,baseImagesReceiptHash=w.digest(self.state/'images.json'),source=str(source),composeEnv=str(folder/'compose.env'),build={**self.build,'sourceSha':materials['sourceSha'],'images':images})
        w.save(folder/'release.json',m);return m

    def test_candidate_contains_only_four_link_changes_and_original_remains_clean(self):
        folder,source,materials,_=w.source_candidate(d)
        self.assertEqual(w.digest(source/w.TARGET),w.AFTER);self.assertEqual(w.digest(self.repo/w.TARGET),w.BEFORE)
        changed=[x['path'] for x,y in zip(materials['files'],self.base['files']) if x!=y]
        self.assertEqual(changed,[w.TARGET]);self.assertEqual(w.source_candidate(d)[2],materials)
        (source/'apps/unreviewed.ts').write_text('unexpected')
        with self.assertRaisesRegex(RuntimeError,'ONLY_WIZARD_LINK_CHANGE_ALLOWED'):w.source_candidate(d)
        self.assert_preserved()

    def test_exact_kit_transition_is_additive_private_and_later_changes_are_rejected(self):
        w.authorize_kit(d);w.authorize_kit(d)
        self.assertEqual(w.installed_kit(self.state,self.kit,self.after_kit),self.before_kit)
        self.assertEqual((self.state/'wizard-release-kit.json').stat().st_mode&0o777,0o600)
        with self.assertRaisesRegex(RuntimeError,'WIZARD_RELEASE_KIT_CHANGED'):w.installed_kit(self.state,self.kit,{'deploy.py':'unreviewed'})
        self.assert_preserved()

    def test_compose_uses_new_release_env_without_changing_original_credentials_or_images_receipt(self):
        m=self.manifest();w.save(self.state/'active-release.json',{'release':w.RELEASE})
        self.assertEqual(w.active(self.state,self.kit),m)
        with patch.object(d,'docker',return_value='{}') as docker:d.dc('ps')
        args=docker.call_args.args
        self.assertEqual(args[args.index('--env-file')+1],m['composeEnv'])
        self.assertEqual(args[args.index('--project-name')+1],d.PROJECT)
        env=__import__('prepare').readenv(Path(m['composeEnv']));env['AIA_MINIO_IMAGE']='unreviewed'
        envput(Path(m['composeEnv']),env)
        with self.assertRaisesRegex(RuntimeError,'RELEASE_COMPOSE_ENV_CHANGED'):w.active(self.state,self.kit)
        self.assert_preserved()

    def test_failed_activation_restores_base_pointer_and_application_images_only(self):
        m=self.manifest();calls=[]
        def replace(_d,log):calls.append((log,w.load(self.state/'active-release.json')['release']))
        with patch.object(d,'validate'),patch.object(w,'dependency_ids',return_value={'postgres':'unchanged'}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps',side_effect=replace),patch.object(w,'health',side_effect=[RuntimeError('NEW_IMAGE_UNHEALTHY'),None]),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'NEW_IMAGE_UNHEALTHY'):w.activate(d,m)
        self.assertEqual(calls,[('wizard-activate.log',w.RELEASE),('wizard-rollback.log',None)])
        self.assertIsNone(w.active(self.state,self.kit));self.assert_preserved()

    def test_validation_failure_does_not_replace_any_running_service(self):
        m=self.manifest()
        with patch.object(d,'validate',side_effect=RuntimeError('CANDIDATE_REJECTED')),patch.object(w,'dependency_ids',return_value={}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps') as replace,patch.object(w,'health'),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'CANDIDATE_REJECTED'):w.activate(d,m)
        replace.assert_not_called();self.assertIsNone(w.active(self.state,self.kit));self.assert_preserved()

    def test_interrupted_activation_resumes_existing_candidate_and_can_rollback(self):
        m=self.manifest();w.save(self.state/'active-release.json',{'release':w.RELEASE})
        with patch.object(d,'validate'),patch.object(w,'dependency_ids',return_value={}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps') as replace,patch.object(w,'health'),contextlib.redirect_stdout(io.StringIO()):
            w.activate(d,m)
            replace.assert_called_once_with(d,'wizard-activate.log')
            w.activate(d,m);self.assertEqual(replace.call_count,1) # Healthy repeat is read-only.
            w.rollback(d);self.assertIsNone(w.active(self.state,self.kit))
        self.assert_preserved()

    def test_replacement_targets_only_web_and_worker_without_volume_or_dependency_operations(self):
        with patch.object(d,'dc') as dc:w.replace_apps(d,'fixture.log')
        self.assertEqual(dc.call_args.args,('up','-d','--no-deps','--wait','--wait-timeout','180','web','worker'))

    def test_partial_image_build_resumes_without_rebuilding_completed_web(self):
        (self.state/'secrets').mkdir();envput(self.state/'secrets/web.env',{'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_fixture'})
        admin=self.state/'storage-admin';admin.mkdir();(admin/'mc').write_bytes(b'OFFLINE_FAKE_CLIENT')
        w.save(admin/'receipt.json',{'sha256':w.digest(admin/'mc')})
        source_sha=w.source_candidate(d)[2]['sourceSha'];calls=[];fail=[True]
        ids={role:'sha256:'+str(n)*64 for n,role in enumerate(w.ROLES,5)}
        def docker(*args,**kwargs):
            calls.append(args)
            if args[0]=='build':
                role=args[args.index('--target')+1]
                if role=='worker' and fail[0]:fail[0]=False;raise RuntimeError('OFFLINE_BUILD_INTERRUPTION')
                return ''
            if args[:2]==('image','inspect'):
                ref=args[2];image=next((v for k,v in ids.items() if k+':wizard-' in ref),ref)
                return json.dumps([{'Id':image,'Config':{'Labels':{'org.opencontainers.image.revision':source_sha}}}])
            self.assertEqual(args[0],'run');self.assertIn('--network',args);self.assertIn('none',args);self.assertNotIn('--rm',args)
            return 'WIZARD_LINK_IMAGE_CHECK_PASSED'
        with patch.object(d,'docker',side_effect=docker),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'OFFLINE_BUILD_INTERRUPTION'):w.build_candidate(d)
            self.assertTrue((self.state/'releases'/w.RELEASE/'web-image.json').exists())
            marker=len(calls);manifest=w.build_candidate(d)
        roles=[a[a.index('--target')+1] for a in calls[marker:] if a[0]=='build']
        self.assertEqual(roles,['worker','tools'])
        self.assertEqual({i['sourceLabel'] for i in manifest['build']['images'].values()},{source_sha})
        self.assert_preserved()

if __name__=='__main__':unittest.main()
