"""Validate the real guard with JSON from the installed, daemon-free Compose parser."""
import copy,hashlib,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import yaml
import deploy as d
import aistor as a
from prepare import put,envput

class ComposeValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.state=Path(self.temp.name);self.sha='a'*64
        self.images={role:{'id':'sha256:'+str(n)*64} for n,role in enumerate(('web','worker','tools'),1)}
        model={'name':d.PROJECT,'services':{},'networks':{'backend':{'internal':True}},'volumes':{'postgres-data':{}},'secrets':{'minio_license':{'file':str(a.LICENSE)}}}
        for role in self.images:
            model['services'][role]={'image':self.images[role]['id'],'read_only':True,'cpus':1.5,'mem_limit':'768m','cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'restart':'no'}
        for role in ('postgres','redis','minio'):
            model['services'][role]={'image':'fixture:local','restart':'no'}
        model['services']['minio'].update(pull_policy='never',user='1000:1000',entrypoint=['/bin/sh','/run/aia/aistor-entrypoint.sh'],command=['server','/data','--address',':9000','--console-address','127.0.0.1:9001','--certs-dir','/run/minio-certs','--license','/run/secrets/minio_license'])
        model['services']['tools']['read_only']=False
        model['services']['tools']['volumes']=[{'type':'bind','source':str(a.CLIENT),'target':'/usr/local/bin/mc','read_only':True},{'type':'bind','source':str(d.KIT/'runtime'),'target':'/app/staging-scripts','read_only':True}]
        for role,port in (('ingress',18443),('mailpit',18025)):
            model['services'][role]={'image':'fixture:local','restart':'no','ports':[f'127.0.0.1:{port}:8443']}
        for service in model['services'].values():service['networks']=['backend']
        model['services']['postgres']['volumes']=['postgres-data:/var/lib/postgresql/data']
        model['services']['minio']['secrets']=['minio_license']
        f=self.state/'fixture.yaml';f.write_text(yaml.safe_dump(model))
        # Standalone config serialization only: no Docker CLI, daemon, socket,
        # container, privileged command, secret contents or real staging config.
        result=subprocess.run(['/usr/libexec/docker/cli-plugins/docker-compose','-f',str(f),'config','--format','json'],capture_output=True,text=True,check=True,timeout=15)
        self.cfg=json.loads(result.stdout)
        put(self.state/'images.json',dict(sourceSha=self.sha,images=self.images,deploymentKit={},publicKeyHash=hashlib.sha256(b'pk_test_fixture').hexdigest()))
        put(self.state/'storage-review.json',{})
        (self.state/'secrets').mkdir()
        envput(self.state/'secrets/web.env',{'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_fixture'})
        self.calls=[]
        for p in [patch.object(d,'STATE',self.state),patch.object(d,'need'),patch.object(d,'local_guard',return_value={'AIA_MINIO_IMAGE':'fixture:local'}),patch.object(d,'check_repo'),patch.object(d,'materials',return_value={'sourceSha':self.sha}),patch.object(d,'kit_materials',return_value={}),patch.object(d,'dc',side_effect=lambda *x:json.dumps(self.cfg)),patch.object(d,'docker',side_effect=self.inspect_image),patch.object(d,'run')]:
            p.start();self.addCleanup(p.stop)

    def inspect_image(self,*args):
        self.calls.append(args)
        self.assertEqual(args[:2],('image','inspect'))
        return json.dumps([{'Config':{'User':'node','Labels':{'org.opencontainers.image.revision':self.sha}}}])

    def test_validate_accepts_actual_compose_json_memory_string(self):
        self.assertEqual(self.cfg['services']['web']['mem_limit'],'805306368')
        self.assertIsInstance(self.cfg['services']['web']['cpus'],float)
        d.validate()
        self.assertTrue((self.state/'validate.json').exists())
        self.assertTrue((self.state/'validated-compose.json').exists())

    def test_zero_memory_still_refuses_isolation(self):
        self.cfg['services']['web']['mem_limit']='0'
        with self.assertRaisesRegex(RuntimeError,'APP_ISOLATION_REQUIRED'):d.validate()
        self.assertFalse((self.state/'validate.json').exists())

    def test_web_filesystem_must_remain_read_only(self):
        self.cfg['services']['web']['read_only']=False
        with self.assertRaisesRegex(RuntimeError,'APP_ISOLATION_REQUIRED'):d.validate()

    def test_nested_mount_under_readonly_scripts_is_rejected(self):
        self.cfg['services']['tools']['volumes'].append({'source':'/fixture/acceptance.ts','target':'/app/scripts/vps-staging-acceptance.ts','read_only':True})
        with self.assertRaisesRegex(RuntimeError,'NESTED_READONLY_SCRIPT_MOUNT_FORBIDDEN'):d.validate()

    def test_active_release_validation_uses_candidate_materials_and_preserves_original_build_receipt(self):
        before=(self.state/'images.json').read_bytes()
        candidate=json.loads(before);self.sha='b'*64;candidate['sourceSha']=self.sha
        for n,role in enumerate(('web','worker','tools'),5):
            candidate['images'][role]['id']='sha256:'+str(n)*64
            self.cfg['services'][role]['image']=candidate['images'][role]['id']
        d.materials.return_value={'sourceSha':self.sha}
        with patch('wizard_release.active',return_value={'source':'/fixture/reviewed-source','build':candidate}):d.validate()
        d.materials.assert_called_once_with('/fixture/reviewed-source')
        self.assertEqual((self.state/'images.json').read_bytes(),before)

if __name__=='__main__':unittest.main()
