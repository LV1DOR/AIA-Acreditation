"""Ensure business changes cannot bypass synthetic database and matching-image gates."""
import ast,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
class WorkflowGate(unittest.TestCase):
 def test_real_workflow_and_existing_submission_request_tests_are_required(self):
  source=(ROOT/'run_pc.py').read_text();tree=ast.parse(source)
  strings={node.value for node in ast.walk(tree)if isinstance(node,ast.Constant)and isinstance(node.value,str)}
  for name in ['approval-carry-forward','final-submission','requests','participant-onboarding','invitations','id-all-export','event-removal']:
   self.assertIn('tests/integration/'+name+'.test.ts',strings)
  self.assertIn('ISOLATED_DATABASE_TESTS_MUST_EXIT_ZERO',strings)
 def test_workflow_proof_and_new_namespace_are_bound_in_both_sides(self):
  build=(ROOT/'build_pc.py').read_text();deploy=(ROOT/'deploy_approved.py').read_text()
  self.assertIn("'approvalUpdatesDatabaseVerified':True",build)
  self.assertIn("build.get('approvalUpdatesDatabaseVerified') is True",deploy)
  self.assertIn("STATE.glob('approval-updates-attempt-*')",deploy)
  r=json.loads((ROOT/'release.json').read_text());self.assertFalse(r['requiresDatabaseMigration'])
  self.assertEqual(r['applicationImagesToRebuild'],['web','worker','tools'])
if __name__=='__main__':unittest.main()
