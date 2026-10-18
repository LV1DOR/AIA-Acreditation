"""Focused offline adapter regression checks. Docker/network calls are mocked."""
import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import aistor as a
import deploy as d
from prepare import envput,put,readenv

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state=Path(self.temp.name)/'state';self.state.mkdir()
        self.kit=Path(self.temp.name)/'kit';self.kit.mkdir()
        for name in ('logs','secrets','licenses'): (self.state/name).mkdir()
        self.license=self.state/'licenses/minio.license'
        self.license.write_text('PRIVATE_TEST_LICENSE_SENTINEL');self.license.chmod(0o600)
        self.client=self.state/'aistor/mc'
        self.payload=b'OFFLINE_FAKE_BINARY'
        self.digest='sha256:'+'a'*64
        self.source='b'*64
        self.baseline={'deploy.py':'previous'}
        self.current={'deploy.py':'adapted'}
        self.images={role:{'id':'sha256:'+str(n)*64,'sourceLabel':self.source} for n,role in enumerate(('web','worker','tools'),1)}
        put(self.kit/'aistor-upgrade-baseline.json',{'previousDeploymentKit':self.baseline})
        put(self.state/'images.json',{'deploymentKit':self.baseline,'sourceSha':self.source,'images':self.images,'publicKeyHash':hashlib.sha256(b'pk_test_fixture').hexdigest()})
        put(self.state/'build.json',{'project':d.PROJECT})
        envput(self.state/'secrets/web.env',{'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_fixture'})
        envput(self.state/'compose.env',{'AIA_WEB_IMAGE':self.images['web']['id'],'AIA_WORKER_IMAGE':self.images['worker']['id'],'AIA_TOOLS_IMAGE':self.images['tools']['id']})
        self.calls=[]
        patches=[patch.object(a,'STATE',self.state),patch.object(a,'KIT',self.kit),patch.object(a,'LICENSE',self.license),patch.object(a,'CLIENT',self.client),patch.object(a,'MC_SHA256',hashlib.sha256(self.payload).hexdigest()),patch.object(a,'check_repo'),patch.object(a.os,'chown'),patch.object(d,'STATE',self.state),patch.object(d,'materials',return_value={'sourceSha':self.source}),patch.object(d,'kit_materials',return_value=self.current),patch.object(d,'docker',side_effect=self.docker),patch.object(d,'run',side_effect=self.download),patch.object(d,'permissions'),patch.object(d,'validate')]
        for p in patches: p.start();self.addCleanup(p.stop)

    def docker(self,*args,**kwargs):
        self.calls.append(args)
        if args[:3]==('buildx','imagetools','inspect'): return json.dumps({'digest':self.digest})
        if args[:2]==('image','inspect'):
            if 'quay.io/' in args[2]:return json.dumps([{'Id':'sha256:'+'c'*64,'Architecture':'amd64','Os':'linux'}])
            return json.dumps([{'Id':args[2],'Config':{'Labels':{'org.opencontainers.image.revision':self.source}}}])
        if args[0]=='run':
            if kwargs['log']=='aistor-probe.log':
                (self.state/'logs/aistor-probe.log').write_text('RELEASE.2026-09-19T17-05-25Z --license --certs-dir')
            return a.MC_RELEASE
        return ''

    def download(self,args,**kwargs):
        Path(args[args.index('--output')+1]).write_bytes(self.payload)
        return ''

    def test_preserves_application_images_and_never_builds_or_exposes_license(self):
        with patch.object(self.license.__class__,'read_text',autospec=True) as read:
            # Read other receipt/env files normally, but fail on license access.
            original=Path.open
            def read_text(path,*args,**kwargs):
                self.assertNotEqual(path,self.license)
                with original(path,mode='r',encoding=kwargs.get('encoding')) as f:return f.read()
            read.side_effect=read_text
            a.prepare_storage()
        self.assertFalse(any(c[0]=='build' for c in self.calls))
        self.assertFalse(any('--rm' in c for c in self.calls))
        self.assertNotIn('PRIVATE_TEST_LICENSE_SENTINEL',repr(self.calls))
        v=readenv(self.state/'compose.env')
        self.assertEqual(v['AIA_WEB_IMAGE'],self.images['web']['id'])
        self.assertEqual(v['AIA_WORKER_IMAGE'],self.images['worker']['id'])
        self.assertEqual(v['AIA_TOOLS_IMAGE'],self.images['tools']['id'])
        self.assertEqual(v['AIA_MINIO_IMAGE'],'quay.io/minio/aistor/minio@'+self.digest)
        self.assertEqual(self.license.stat().st_mode&0o777,0o400)
        self.assertTrue(json.loads((self.state/'aistor-adapter.json').read_text())['applicationRebuilt'] is False)
        self.assertEqual(a.adapter_guard()['image'],'quay.io/minio/aistor/minio@'+self.digest)

    def test_unknown_build_baseline_is_rejected_before_registry_access(self):
        p=self.state/'images.json';r=json.loads(p.read_text());r['deploymentKit']={'unknown':'changed'};put(p,r)
        with self.assertRaisesRegex(RuntimeError,'BASELINE'):a.prepare_storage()
        self.assertEqual(self.calls,[])

    def test_partial_attempt_retries_validation_without_rewriting_state_or_running_containers(self):
        # Reproduce the recorded boundary: selection and permissions succeeded,
        # then validate raised. Its actual failing expression is tested separately.
        d.validate.side_effect=TypeError('fixture validation boundary')
        with self.assertRaises(TypeError):a.prepare_storage()
        put(self.state/'permissions.json',{'project':d.PROJECT})
        put(self.kit/'aistor-typeerror-baseline.json',{'deploymentKit':self.current})
        (self.state/'tls').mkdir();(self.state/'tls/server.key').write_bytes(b'PRIVATE_CERTIFICATE_FIXTURE')
        before={str(p.relative_to(self.state)):p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        self.calls.clear();d.permissions.reset_mock();d.run.reset_mock()
        d.validate.side_effect=None
        d.kit_materials.return_value={'deploy.py':'fixed-validation-and-sanitized-traceback'}
        a.prepare_storage()
        for name,data in before.items():self.assertEqual((self.state/name).read_bytes(),data,name)
        self.assertTrue((self.state/'aistor-prepare.json').exists())
        self.assertTrue((self.state/'aistor-validation-fix.json').exists())
        self.assertTrue(all(c[:2]==('image','inspect') for c in self.calls))
        d.permissions.assert_not_called();d.run.assert_not_called()
        a.adapter_guard()

    def test_incorrect_client_checksum_cannot_activate_adapter(self):
        with patch.object(a,'MC_SHA256','0'*64):
            with self.assertRaisesRegex(RuntimeError,'CHECKSUM_FAILED'):a.prepare_storage()
        self.assertFalse((self.state/'aistor-adapter.json').exists())
        self.assertNotIn('AIA_MINIO_IMAGE',readenv(self.state/'compose.env'))

    def test_running_stack_mount_fix_records_exact_transition_without_rewriting_receipts(self):
        a.prepare_storage()
        put(self.kit/'aistor-typeerror-baseline.json',{'deploymentKit':self.current})
        old_fixed={'deploy.py':'validated-before-mount-fix'}
        put(self.state/'aistor-validation-fix.json',dict(previousDeploymentKit=self.current,deploymentKit=old_fixed))
        put(self.kit/'maintenance-mount-baseline.json',{'deploymentKit':old_fixed})
        put(self.state/'infra.json',{'project':d.PROJECT})
        preserve=('images.json','compose.env','aistor-adapter.json','aistor-validation-fix.json','infra.json')
        before={n:(self.state/n).read_bytes() for n in preserve}
        d.kit_materials.return_value={'deploy.py':'reviewed-maintenance-mount-fix'}
        self.calls.clear();a.adapter_guard();a.adapter_guard()
        self.assertEqual(self.calls,[])
        for n,data in before.items():self.assertEqual((self.state/n).read_bytes(),data)
        self.assertEqual((self.state/'maintenance-mount-fix.json').stat().st_mode&0o777,0o600)
        d.kit_materials.return_value={'deploy.py':'unexpected-later-change'}
        with self.assertRaisesRegex(RuntimeError,'MAINTENANCE_MOUNT_FIX_RECEIPT_CHANGED'):a.adapter_guard()

    def test_public_or_symlink_license_rejected(self):
        self.license.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError,'MODE_0400_OR_0600'):a.license_guard()
        self.license.chmod(0o600)
        other=self.license.with_name('other');other.write_text('fixture')
        link=self.license.with_name('link');link.symlink_to(other)
        with patch.object(a,'LICENSE',link):
            with self.assertRaisesRegex(RuntimeError,'REGULAR_PRIVATE'):a.license_guard()

    def test_diagnostic_revision_preserves_installed_stack_receipts(self):
        a.prepare_storage()
        put(self.kit/'aistor-typeerror-baseline.json',{'deploymentKit':self.current})
        fixed={'deploy.py':'validated-before-mount'}
        installed={'deploy.py':'installed-mount-fix'}
        put(self.state/'aistor-validation-fix.json',dict(previousDeploymentKit=self.current,deploymentKit=fixed))
        put(self.kit/'maintenance-mount-baseline.json',{'deploymentKit':fixed})
        put(self.state/'maintenance-mount-fix.json',dict(previousDeploymentKit=fixed,deploymentKit=installed))
        put(self.kit/'storage-diagnostics-baseline.json',{'deploymentKit':installed})
        before={n:(self.state/n).read_bytes() for n in ('images.json','compose.env','aistor-adapter.json','aistor-validation-fix.json','maintenance-mount-fix.json')}
        d.kit_materials.return_value={'deploy.py':'instrumented-storage-check'}
        self.calls.clear();a.adapter_guard();a.adapter_guard()
        self.assertEqual(self.calls,[])
        for n,v in before.items():self.assertEqual((self.state/n).read_bytes(),v)
        self.assertEqual((self.state/'storage-diagnostics-fix.json').stat().st_mode&0o777,0o600)

    def test_bucket_name_fix_preserves_all_prior_receipts_and_rejects_further_changes(self):
        a.prepare_storage()
        put(self.kit/'aistor-typeerror-baseline.json',{'deploymentKit':self.current})
        fixed={'deploy.py':'validated-before-mount'}
        mounted={'deploy.py':'installed-mount-fix'}
        diagnosed={'deploy.py':'installed-storage-diagnostics'}
        put(self.state/'aistor-validation-fix.json',dict(previousDeploymentKit=self.current,deploymentKit=fixed))
        put(self.kit/'maintenance-mount-baseline.json',{'deploymentKit':fixed})
        put(self.state/'maintenance-mount-fix.json',dict(previousDeploymentKit=fixed,deploymentKit=mounted))
        put(self.kit/'storage-diagnostics-baseline.json',{'deploymentKit':mounted})
        put(self.state/'storage-diagnostics-fix.json',dict(previousDeploymentKit=mounted,deploymentKit=diagnosed))
        put(self.kit/'bucket-name-fix-baseline.json',{'deploymentKit':diagnosed})
        before={str(p.relative_to(self.state)):p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        d.kit_materials.return_value={'deploy.py':'reviewed-bucket-probe-fix'}
        self.calls.clear();a.adapter_guard();a.adapter_guard()
        self.assertEqual(self.calls,[])
        for n,data in before.items():self.assertEqual((self.state/n).read_bytes(),data,n)
        self.assertEqual((self.state/'bucket-name-fix.json').stat().st_mode&0o777,0o600)
        d.kit_materials.return_value={'deploy.py':'unexpected-later-change'}
        with self.assertRaisesRegex(RuntimeError,'BUCKET_NAME_FIX_RECEIPT_CHANGED'):a.adapter_guard()

if __name__=='__main__':unittest.main()
