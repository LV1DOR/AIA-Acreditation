"""Catch the absent Prisma ledger and verify safe reuse of the inspected PC attempt."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('retry_runner',Path(__file__).with_name('run_pc.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
ROOT=Path(__file__).resolve().parent
class GrantsRetry(unittest.TestCase):
 def test_only_the_ledger_revoke_becomes_conditional_all_other_grants_unchanged(self):
  source=(Path('/home/luke/aia-accreditation-resend-monitoring-20261104/source/infra/production/runtime-roles.sql')).read_bytes()
  statement=b'REVOKE INSERT,UPDATE,DELETE ON "_prisma_migrations" FROM aia_runtime;'
  result=r.isolated_runtime_grants(source)
  guarded=result.split(b'DO $raw_schema$',1)[1].split(b'END $raw_schema$;',1)[0]
  self.assertIn(b'to_regclass',guarded);self.assertIn(b'IS NOT NULL THEN EXECUTE',guarded)
  prefix,suffix=source.split(statement);self.assertTrue(result.startswith(prefix));self.assertTrue(result.endswith(suffix))
  self.assertEqual(result.count(b'DO $raw_schema$'),1)
  with self.assertRaisesRegex(RuntimeError,'EXACT_RUNTIME_LEDGER_REVOKE_REQUIRED'):r.isolated_runtime_grants(source+statement)
  with self.assertRaisesRegex(RuntimeError,'EXACT_RUNTIME_LEDGER_REVOKE_REQUIRED'):r.isolated_runtime_grants(b'unknown grants')
 def test_exact_workspace_pristine_bundle_and_inspected_failure_are_required(self):
  with tempfile.TemporaryDirectory()as t:
   work=Path(t)/r.RETRY_WORKSPACE;work.mkdir()
   from unittest.mock import patch
   with self.assertRaisesRegex(RuntimeError,'ORIGINAL_TESTED_SOURCE_MANIFEST_REQUIRED'):
    try:r.verify_failed_workspace(work)
    except FileNotFoundError:raise RuntimeError('ORIGINAL_TESTED_SOURCE_MANIFEST_REQUIRED')from None
   with patch.object(r,'BUNDLE_MANIFEST_SHA','synthetic'):
    bundle=work/'resend-monitoring-release';bundle.mkdir();(bundle/'MANIFEST.sha256').write_text('')
    with patch.object(r,'digest',return_value='synthetic'):
     failed=work/r.FAILED_ATTEMPT;failed.mkdir();(failed/'runtime-grants.log').write_text('ERROR: relation "_prisma_migrations" does not exist')
     r.verify_failed_workspace(work)
     (work/'build-output.json').write_text('{}')
     with self.assertRaisesRegex(RuntimeError,'ONLY_FAILED_PRE_BUILD_WORKSPACE_CAN_RESUME'):r.verify_failed_workspace(work)
 def test_cached_image_must_have_successful_original_check_and_exact_command(self):
  with tempfile.TemporaryDirectory()as t:
   work=Path(t);attempt=work/r.FAILED_ATTEMPT;attempt.mkdir();(attempt/'test-build.log').write_text('naming to docker.io/aia-accreditation-checks/exports:123 done')
   container={'State':{'Status':'exited','ExitCode':1,'OOMKilled':False},'Config':{'Image':'aia-accreditation-checks/exports:123','Entrypoint':['node'],'Cmd':['/candidate/checks/in_image.mjs']},'Image':'sha256:synthetic'}
   calls=[]
   def docker(args,**kwargs):calls.append(args);return json.dumps([container])
   with self.assertRaisesRegex(RuntimeError,'ORIGINAL_OFFLINE_TESTS_MUST_HAVE_PASSED'):r.verified_cached_test_image(work,docker,'456')
   self.assertFalse(any(c[0]=='run'for c in calls))
   container['State']['ExitCode']=0;container['Config']['Cmd']=['other']
   with self.assertRaisesRegex(RuntimeError,'ORIGINAL_OFFLINE_TEST_COMMAND_REQUIRED'):r.verified_cached_test_image(work,docker,'456')
 def test_cached_image_proof_checks_source_and_harness_without_host_mount_or_network(self):
  with tempfile.TemporaryDirectory()as t:
   work=Path(t);attempt=work/r.FAILED_ATTEMPT;attempt.mkdir();(attempt/'test-build.log').write_text('naming to docker.io/aia-accreditation-checks/exports:123 done')
   bundle=work/'resend-monitoring-release';bundle.mkdir();(bundle/'source-manifest.json').write_text(json.dumps({'files':[{'path':'package.json','sha256':'a'*64}]}));(bundle/'MANIFEST.sha256').write_text('b'*64+'  checks/in_image.mjs\n')
   container={'State':{'Status':'exited','ExitCode':0,'OOMKilled':False},'Config':{'Image':'aia-accreditation-checks/exports:123','Entrypoint':['node'],'Cmd':['/candidate/checks/in_image.mjs']},'Image':'sha256:synthetic'}
   calls=[]
   def docker(args,**kwargs):
    calls.append((args,kwargs))
    if args[0]=='inspect':return json.dumps([container])
    if args[0]=='image':return json.dumps([{'Id':'sha256:synthetic','Os':'linux','Architecture':'amd64'}])
    self.assertEqual(json.loads(kwargs['input']),[{'path':'/app/package.json','sha256':'a'*64},{'path':'/candidate/checks/in_image.mjs','sha256':'b'*64}]);return 'CACHED_TEST_SOURCE_AND_HARNESS_VERIFIED'
   self.assertEqual(r.verified_cached_test_image(work,docker,'456'),'sha256:synthetic')
   run=calls[-1][0];self.assertIn('--read-only',run);self.assertIn('none',run);self.assertNotIn('--volume',run);self.assertNotIn('--mount',run)
class ExactCachedTypes(unittest.TestCase):
 def test_only_known_dockerfile_type_stub_is_substituted_not_skipped(self):
  import hashlib
  with tempfile.TemporaryDirectory()as t:
   bundle=Path(t)
   (bundle/'source-manifest.json').write_text(json.dumps({'files':[{'path':'apps/web/next-env.d.ts','sha256':'a'*64},{'path':'packages/domain/src/index.ts','sha256':'b'*64}]}))
   original=Path('/home/luke/aia-accreditation-resend-monitoring-20261104/Dockerfile.checks').read_text()
   (bundle/'Dockerfile.checks').write_text(original);(bundle/'MANIFEST.sha256').write_text('c'*64+'  checks/in_image.mjs\n')
   values=r.cached_test_files(bundle)
   self.assertEqual(values[0]['sha256'],'879741880b6ab48da99dcc06dcc674d381c9826137b0496bf7bb368f302de9fc')
   self.assertEqual(values[1],{'path':'/app/packages/domain/src/index.ts','sha256':'b'*64})
   self.assertEqual(values[2],{'path':'/candidate/checks/in_image.mjs','sha256':'c'*64})
   (bundle/'Dockerfile.checks').write_text(original.replace('image-types/global','changed-types'))
   with self.assertRaisesRegex(RuntimeError,'EXACT_TEST_NEXT_TYPE_STUB_REQUIRED'):r.cached_test_files(bundle)
 def test_actual_public_node_program_accepts_expected_bytes_and_rejects_changed_bytes(self):
  import ast,hashlib,subprocess,shutil
  if not shutil.which('node'):self.skipTest('Node is required for native public verifier test')
  tree=ast.parse((ROOT/'run_pc.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='verified_cached_test_image')
  program=next(ast.literal_eval(n.value)for n in ast.walk(fn)if isinstance(n,ast.Assign)and any(isinstance(v,ast.Name)and v.id=='program'for v in n.targets))
  with tempfile.TemporaryDirectory()as t:
   file=Path(t)/'synthetic-public-file';file.write_text('expected synthetic source')
   manifest=json.dumps([{'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}])
   passed=subprocess.run(['node','-e',program],input=manifest,capture_output=True,text=True,timeout=10)
   self.assertEqual(passed.returncode,0);self.assertEqual(passed.stdout.strip(),'CACHED_TEST_SOURCE_AND_HARNESS_VERIFIED')
   file.write_text('changed synthetic source')
   failed=subprocess.run(['node','-e',program],input=manifest,capture_output=True,text=True,timeout=10)
   self.assertNotEqual(failed.returncode,0);self.assertEqual(json.loads(failed.stdout)['code'],'CACHED_TEST_SOURCE_MISMATCH')

if __name__=='__main__':unittest.main()
