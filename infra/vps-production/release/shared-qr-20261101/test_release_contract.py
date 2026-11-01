"""Public artifact consistency; no state or infrastructure access."""
import ast,hashlib,importlib.util,json,re,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
class Contract(unittest.TestCase):
 def test_release_base_new_images_and_helper_pins_match(self):
  r=json.loads((ROOT/'release.json').read_text());values={}
  for name in ['build_pc.py','run_pc.py','deploy_approved.py']:
   tree=ast.parse((ROOT/name).read_text());values[name]={n.targets[0].id:ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and isinstance(n.value,ast.Constant)}
  self.assertEqual(values['deploy_approved.py']['OLD'],r['baseMaterial']);self.assertEqual(values['build_pc.py']['BASE_MATERIAL'],r['baseMaterial'])
  self.assertEqual(values['deploy_approved.py']['NEW'],r['material']);self.assertEqual(values['build_pc.py']['MATERIAL'],r['material']);self.assertEqual(values['run_pc.py']['MATERIAL'],r['material'])
  self.assertEqual(values['build_pc.py']['BASE'],values['run_pc.py']['BASE'])
 def test_source_and_bootstrap_hashes_are_exact(self):
  sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
  source=ROOT/'shared-qr-source.tar.gz'
  if not source.exists():self.skipTest('source archive is held outside Git')
  self.assertIn("ARCHIVE_SHA = '"+sha(source)+"'",(ROOT/'run_pc.py').read_text())
  ps=(ROOT/'prepare_pc.ps1').read_text()
  for n in ['shared-qr-source.tar.gz','run_pc.py','build_pc.py']:self.assertIn("'"+n+"' = '"+sha(ROOT/n)+"'",ps)
 def test_deployment_bundle_hash_matches_the_actual_reviewed_candidate(self):
  candidate=Path('/home/luke/aia-accreditation-shared-qr-20261101')
  if not candidate.exists():self.skipTest('operator-held build context')
  wrapper=(ROOT/'deploy_approved.py').read_text()
  expected=hashlib.sha256((candidate/'MANIFEST.sha256').read_bytes()).hexdigest()
  self.assertIn("'"+expected+"', 'CANDIDATE_MANIFEST_CHANGED'",wrapper)
  self.assertNotIn('cb7ae76a0f949f75058900d408938a80742cb50b164d473f73b9d79ee9b58cd5',wrapper)
  self.assertIn('Type DEPLOY-SHARED-QR',wrapper)
  self.assertNotIn('DEPLOY-WORKER-MAIL-FIX',wrapper)
if __name__=='__main__':unittest.main()
