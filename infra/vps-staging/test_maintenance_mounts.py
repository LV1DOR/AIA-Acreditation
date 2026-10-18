"""Check real override merging and maintenance command paths without Docker runtime."""
import json,os,re,subprocess,tempfile,unittest
from pathlib import Path,PurePosixPath
from unittest.mock import patch
import deploy as d
from prepare import KIT,REPO

class MaintenanceMountTests(unittest.TestCase):
    def test_actual_three_file_merge_has_no_nested_readonly_mountpoints(self):
        with tempfile.TemporaryDirectory(prefix='aia-mount-test-') as tmp:
            p=Path(tmp);env=p/'compose.env'
            values={'AIA_PROJECT_NAME':d.PROJECT,'AIA_WEB_IMAGE':'fixture/web:local','AIA_WORKER_IMAGE':'fixture/worker:local','AIA_TOOLS_IMAGE':'fixture/tools:local','AIA_MINIO_IMAGE':'fixture/minio:local','AIA_TLS_DIRECTORY':str(p/'tls'),'AIA_SECRETS_DIRECTORY':str(p/'secrets'),'AIA_BACKUP_DIRECTORY':str(p/'backups'),'AIA_HTTP_BIND_PORT':'18880','AIA_HTTPS_BIND_PORT':'18443','AIA_AISTOR_MC_FILE':str(p/'mc'),'AIA_AISTOR_LICENSE_FILE':str(p/'license')}
            env.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
            args=['/usr/libexec/docker/cli-plugins/docker-compose','--env-file',str(env),'--profile','maintenance','-f',str(REPO/'infra/production/compose.yaml'),'-f',str(REPO/'infra/production/compose.staging.yaml'),'-f',str(KIT/'compose.vps.yaml'),'config','--format','json']
            process_env={k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','AIA_'))}
            cfg=json.loads(subprocess.run(args,env=process_env,capture_output=True,text=True,check=True,timeout=15).stdout)
        tools=cfg['services']['tools']
        self.assertFalse(tools.get('read_only',False))
        for role in ('web','worker','redis','minio','mailpit','ingress','storage-volume-init'):
            self.assertTrue(cfg['services'][role]['read_only'],role)
        volumes=tools['volumes']
        originals=next(x for x in volumes if x['target']=='/app/scripts')
        adapters=next(x for x in volumes if x['target']=='/app/staging-scripts')
        self.assertTrue(originals['read_only']);self.assertTrue(adapters['read_only'])
        # The reviewed Compose bind intentionally retains its canonical VPS path,
        # even when the source-only kit is archived in a separate Git checkout.
        self.assertEqual(adapters['source'],'/home/luke/aia-accreditation-staging-kit/runtime')
        self.assertFalse(any(x['target'].startswith('/app/scripts/') for x in volumes))
        for name in ('bootstrap.ts','acceptance.ts','check.ts','webhook.ts','admin.ts','storage.ts'):
            self.assertTrue((Path(adapters['source'])/name).is_file(),name)
            # Sibling /app directories preserve the adapters' ../packages/tests/apps imports.
            source=(Path(adapters['source'])/name).read_text()
            for relative in re.findall(r"(?:from\s+|import\()[\"'](\.\.[^\"']+)[\"']",source):
                resolved=PurePosixPath(os.path.normpath(str(PurePosixPath('/app/staging-scripts')/relative)))
                self.assertTrue((REPO/str(resolved.relative_to('/app'))).is_file(),(name,relative))
        self.assertIn("'../scripts/bootstrap-admin.ts'",(KIT/'runtime/admin.ts').read_text())
        for name in ('migrate.ts','bootstrap-admin.ts'):
            self.assertTrue((Path(originals['source'])/name).is_file())
        # Dockerfile supplies /app and the existing client target before these mounts.
        dockerfile=(REPO/'infra/production/Dockerfile').read_text()
        self.assertIn('WORKDIR /app',dockerfile)
        self.assertIn('/usr/local/bin/mc',dockerfile)

    def test_each_tool_maps_to_existing_script_and_retry_gets_new_container(self):
        with patch.object(d,'dc') as dc,patch.object(d,'stamp',side_effect=['attempt-one','attempt-two','three','four','five','six','seven','eight']):
            for script in ('storage','storage','bootstrap','acceptance','webhook','check','admin'):
                d.tool('scripts/vps-staging-'+script+'.ts')
            d.tool('scripts/migrate.ts','--preflight')
        names=[]
        for call in dc.call_args_list:
            args=call.args
            self.assertIn('--no-deps',args)
            self.assertNotIn('up',args);self.assertNotIn('--rm',args)
            self.assertNotIn('rm',args);self.assertNotIn('restart',args)
            names.append(args[args.index('--name')+1])
        self.assertNotEqual(names[0],names[1])
        self.assertEqual(dc.call_args_list[0].args[-1],'/app/staging-scripts/storage.ts')
        self.assertEqual(dc.call_args_list[2].args[-1],'/app/staging-scripts/bootstrap.ts')
        self.assertEqual(dc.call_args_list[-1].args[-2: ],('scripts/migrate.ts','--preflight'))

if __name__=='__main__':unittest.main()
