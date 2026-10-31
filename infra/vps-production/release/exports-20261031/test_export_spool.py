"""Private scratch storage/Compose isolation checks; no infrastructure or privileged calls."""
import copy,json,os,stat,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import yaml
import export_spool as s
class Spool(unittest.TestCase):
 def test_changes_only_web_tmpfs_to_private_disk_bind_and_preserves_shared_environment(self):
  original=b'services:\n  web:\n    read_only: true\n    environment: &env {AIA_RUNTIME_ENV_FILE: /run/secrets/runtime_env}\n    tmpfs: ["/tmp:size=64m,mode=1777"]\n    mem_limit: 768m\n  worker:\n    environment: *env\n    mem_limit: 384m\nnetworks: {backend: {internal: true}}\n'
  before=yaml.safe_load(original);after=yaml.safe_load(s.compose_with_spool(original,Path('/synthetic/private/export-tmp')))
  self.assertEqual(after['services']['worker'],before['services']['worker']);self.assertEqual(after['networks'],before['networks'])
  web=after['services']['web'];self.assertTrue(web['read_only']);self.assertEqual(web['environment'],before['services']['web']['environment']);self.assertEqual(web['mem_limit'],'768m');self.assertNotIn('tmpfs',web)
  self.assertEqual(web['volumes'],[{'type':'bind','source':'/synthetic/private/export-tmp','target':'/tmp','read_only':False,'bind':{'create_host_path':False}}])
 def test_refuses_unexpected_existing_mount_or_writable_root(self):
  for source in ['services: {web: {read_only: false, tmpfs: [/tmp]}}','services: {web: {read_only: true}}','services: {web: {read_only: true, tmpfs: [/tmp], volumes: ["/other:/tmp"]}}']:
   with self.assertRaises(RuntimeError):s.compose_with_spool(source,Path('/synthetic'))
 def test_new_directory_is_private_and_only_it_is_chowned(self):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t)
   with patch.object(s.os,'chown')as chown:folder=s.prepare_spool(state)
   chown.assert_called_once_with(folder,1000,1000);self.assertEqual(stat.S_IMODE(folder.stat().st_mode),0o700);self.assertEqual(stat.S_IMODE((state/'export-spool.json').stat().st_mode),0o600)
   self.assertEqual(json.loads((state/'export-spool.json').read_text())['project'],'aia-accreditation-production')
 def test_unmarked_existing_directory_and_symlinks_are_never_adopted(self):
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);(state/'export-tmp').mkdir();(state/'export-tmp/keep').write_text('keep')
   with patch.object(s.os,'chown')as chown,self.assertRaises(RuntimeError):s.prepare_spool(state)
   chown.assert_not_called();self.assertEqual((state/'export-tmp/keep').read_text(),'keep')
  with tempfile.TemporaryDirectory()as t:
   state=Path(t);(state/'export-tmp').symlink_to(state)
   with self.assertRaises(RuntimeError):s.prepare_spool(state)
if __name__=='__main__':unittest.main()
