"""Logger-contract regression and immutable candidate upgrade; Docker calls are mocked."""
import contextlib,hashlib,io,json,re,shutil,unittest
from pathlib import Path
from unittest.mock import patch
import wizard_release as w
import deploy as d
import test_privacy_release as fixtures
REAL_REPO=d.REPO

class PrivacyLoggerFixTests(unittest.TestCase):
    manifest=fixtures.PrivacyReleaseTests.manifest
    preserved=fixtures.PrivacyReleaseTests.preserved
    def setUp(self):
        fixtures.PrivacyReleaseTests.setUp(self)
        shutil.copytree(Path(__file__).parent/'review/privacy-ui-v2',self.kit/'review/privacy-ui-v2')

    def test_only_one_logger_call_changes_and_all_worker_codes_match_actual_contract(self):
        review=Path(__file__).parent/'review'
        old=review/'privacy-ui/overlay';new=review/'privacy-ui-v2/overlay'
        paths=lambda root:{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
        before,after=paths(old),paths(new)
        self.assertEqual(set(before),set(after))
        worker='apps/worker/src/main.ts'
        self.assertEqual([p for p in before if before[p]!=after[p]],[worker])
        self.assertEqual(before[worker].replace(b'logger.error("COMMUNICATION_CLEANUP_FAILED")',b'logger.error("CLEANUP_FAILED")'),after[worker])
        logger=(REAL_REPO/'packages/config/src/logger.ts').read_text()
        union=re.search(r'export type LogCode\s*=\s*([^;]+);',logger).group(1)
        allowed=set(re.findall(r'"([A-Z_]+)"',union))
        calls=lambda text:set(re.findall(r'logger\.(?:error|info)\("([A-Z_]+)"',text))
        self.assertEqual(calls(before[worker].decode())-allowed,{'COMMUNICATION_CLEANUP_FAILED'})
        self.assertEqual(calls(after[worker].decode())-allowed,set())
        self.assertIn(b'lastErrorCode:"COMMUNICATION_CLEANUP_FAILED"',after[worker])
        old_spec=w.load(review/'privacy-ui/release.json');new_spec=w.load(review/'privacy-ui-v2/release.json')
        self.assertEqual(new_spec['kind'],w.PRIVACY_LOGGER_RELEASE)
        for item in new_spec['changes']:
            self.assertEqual(w.digest(new/item['path']),item['after'])
            original=next(x for x in old_spec['changes'] if x['path']==item['path'])
            self.assertEqual(item['before'],original['before'])
            if item['path']!=worker:self.assertEqual(item,original)

    def test_logger_kit_upgrade_preserves_all_existing_receipts_and_rejects_drift(self):
        w.authorize_kit(d)
        previous={n:(self.state/n).read_bytes() for n in ['wizard-release-kit.json','privacy-release-kit.json','bucket-name-fix.json','images.json','compose.env']}
        w.save(self.kit/'privacy-logger-fix-baseline.json',{'deploymentKit':{'kit':'privacy'}})
        with patch.object(d,'kit_materials',return_value={'kit':'logger-fix'}):
            w.authorize_kit(d);w.authorize_kit(d)
            self.assertEqual(w.installed_kit(self.state,self.kit,d.kit_materials()),{'kit':'base'})
            self.assertEqual((self.state/'privacy-logger-fix-kit.json').stat().st_mode&0o777,0o600)
        for n,b in previous.items():self.assertEqual((self.state/n).read_bytes(),b,n)
        with self.assertRaisesRegex(RuntimeError,'PRIVACY_LOGGER_FIX_KIT_CHANGED'):
            w.installed_kit(self.state,self.kit,{'kit':'unreviewed'})
        with patch.object(d,'kit_materials',return_value={'kit':'unreviewed'}):
            with self.assertRaisesRegex(RuntimeError,'PRIVACY_LOGGER_FIX_KIT_CHANGED'):w.authorize_kit(d)

    def test_new_candidate_preserves_failed_v1_and_preflight_uses_retained_image(self):
        old_folder,old_source,old_materials,_=w.source_candidate(d,w.PRIVACY_RELEASE)
        image='sha256:'+'a'*64
        for role in w.ROLES:w.save(old_folder/(role+'-image.json'),{'id':image,'sourceLabel':old_materials['sourceSha']})
        before={str(p.relative_to(old_folder)):p.read_bytes() for p in old_folder.rglob('*') if p.is_file()}
        folder,source,materials,_=w.source_candidate(d,w.PRIVACY_LOGGER_RELEASE)
        self.assertNotEqual(folder,old_folder)
        self.assertNotEqual(materials['sourceSha'],old_materials['sourceSha'])
        self.assertFalse((folder/'compose.env').exists());self.assertFalse((folder/'release.json').exists())
        with patch.object(d,'docker',side_effect=[json.dumps([{'Id':image,'Config':{'Labels':{'org.opencontainers.image.revision':old_materials['sourceSha']}}}]),'']) as docker,contextlib.redirect_stdout(io.StringIO()):
            w.logger_fix_preflight(d,source,materials)
        args=docker.call_args.args
        self.assertEqual(args[0],'run');self.assertIn(image,args)
        self.assertEqual(args[args.index('--network')+1],'none')
        self.assertIn('--read-only',args);self.assertIn('--noEmit',args)
        reviewed=self.kit/'review/privacy-ui-v2/overlay/apps/worker/src/main.ts'
        self.assertIn(str(reviewed)+':/app/apps/worker/src/main.ts:ro',args)
        self.assertNotIn('--env-file',args);self.assertNotIn('--rm',args)
        self.assertEqual(before,{str(p.relative_to(old_folder)):p.read_bytes() for p in old_folder.rglob('*') if p.is_file()})
        self.preserved()
        (old_source/'apps/worker/src/main.ts').write_text('unexpected')
        with patch.object(d,'docker') as docker:
            with self.assertRaisesRegex(RuntimeError,'LOGGER_FIX_MUST_BE_ONLY_V1_SOURCE_CHANGE'):w.logger_fix_preflight(d,source,materials)
            docker.assert_not_called()

    def test_corrected_release_activation_failure_still_rolls_back_to_wizard(self):
        old=self.manifest(w.RELEASE);new=self.manifest(w.PRIVACY_LOGGER_RELEASE)
        w.save(self.state/'active-release.json',{'release':w.RELEASE});calls=[]
        def replace(_d,log):calls.append(w.load(self.state/'active-release.json')['release'])
        with patch.object(d,'validate'),patch.object(w,'dependency_ids',return_value={}),patch.object(w,'verify_dependencies'),patch.object(w,'replace_apps',side_effect=replace),patch.object(w,'health',side_effect=[RuntimeError('FAILED_CANDIDATE'),None]),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'FAILED_CANDIDATE'):w.activate(d,new)
        self.assertEqual(calls,[w.PRIVACY_LOGGER_RELEASE,w.RELEASE]);self.assertEqual(w.active(self.state,self.kit),old)
        self.preserved()

    def test_preflight_blocks_builds_and_later_check_failure_reuses_v2_images(self):
        from prepare import envput
        old=self.manifest(w.RELEASE);w.save(self.state/'active-release.json',{'release':w.RELEASE})
        original=w.load(self.state/'images.json')
        original.update(commit='fixture',publicKeyHash=hashlib.sha256(b'pk_test_fixture').hexdigest());w.save(self.state/'images.json',original)
        self.before['images.json']=(self.state/'images.json').read_bytes()
        old['baseImagesReceiptHash']=w.digest(self.state/'images.json');w.save(self.state/'releases'/w.RELEASE/'release.json',old)
        (self.state/'secrets').mkdir();envput(self.state/'secrets/web.env',{'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_fixture'})
        admin=self.state/'storage-admin';admin.mkdir();(admin/'mc').write_bytes(b'OFFLINE_CLIENT');w.save(admin/'receipt.json',{'sha256':w.digest(admin/'mc')})
        v1,_,previous,_=w.source_candidate(d,w.PRIVACY_RELEASE)
        retained='sha256:'+'a'*64
        w.save(v1/'tools-image.json',{'id':retained,'sourceLabel':previous['sourceSha']})
        retained_bytes=(v1/'tools-image.json').read_bytes()
        v2,_,candidate,_=w.source_candidate(d,w.PRIVACY_LOGGER_RELEASE)
        images={role:'sha256:'+str(n)*64 for n,role in enumerate(w.ROLES,7)}
        calls=[];fail={'preflight':True,'final':True}
        def docker(*args,**kw):
            calls.append(args)
            if args[0]=='build':return ''
            if args[:2]==('image','inspect'):
                ref=args[2]
                image=next((v for role,v in images.items() if role+':privacy-' in ref),ref)
                sha=previous['sourceSha'] if ref==retained else candidate['sourceSha']
                return json.dumps([{'Id':image,'Config':{'Labels':{'org.opencontainers.image.revision':sha}}}])
            self.assertEqual(args[0],'run');self.assertIn('--read-only',args);self.assertIn('none',args)
            if kw.get('log')=='privacy-logger-preflight.log' and fail['preflight']:
                fail['preflight']=False;raise RuntimeError('PREFLIGHT_TYPECHECK_FAILED')
            if kw.get('log')=='privacy-check-worker-types.log' and fail['final']:
                fail['final']=False;raise RuntimeError('FINAL_TYPECHECK_FAILED')
            return 'PASSED'
        with patch.object(d,'docker',side_effect=docker),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'PREFLIGHT_TYPECHECK_FAILED'):w.build_candidate(d,w.PRIVACY_LOGGER_RELEASE)
            self.assertFalse(any(c[0]=='build' for c in calls));self.assertFalse((v2/'release.json').exists())
            with self.assertRaisesRegex(RuntimeError,'FINAL_TYPECHECK_FAILED'):w.build_candidate(d,w.PRIVACY_LOGGER_RELEASE)
            self.assertEqual(sum(c[0]=='build' for c in calls),3);self.assertFalse((v2/'release.json').exists())
            boundary=len(calls);result=w.build_candidate(d,w.PRIVACY_LOGGER_RELEASE)
        self.assertFalse(any(c[0]=='build' for c in calls[boundary:]))
        self.assertEqual({i['sourceLabel'] for i in result['build']['images'].values()},{candidate['sourceSha']})
        self.assertEqual((v1/'tools-image.json').read_bytes(),retained_bytes)
        self.assertEqual(w.active(self.state,self.kit),old);self.preserved()

if __name__=='__main__':
    import unittest
    unittest.main()
