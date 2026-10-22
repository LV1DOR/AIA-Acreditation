"""Sequential migration budget with original limits/headroom/telemetry; no live tools."""
import copy,unittest
import quiesced_capacity as q
from common import PROJECT
MIB=1024**2
CAPS={'web':768,'worker':384,'postgres':512,'redis':384,'minio':1536,'ingress':128}
IDS={'web':'a'*64,'worker':'b'*64}
def fixture(available=5776):
 rows=[]
 for i,(s,credit)in enumerate([('postgres',10),('redis',7),('minio',123),('ingress',4)]):rows.append(dict(project=PROJECT,service=s,id=str(i)*64,limitBytes=CAPS[s]*MIB,anonCreditBytes=credit*MIB,currentBytesMax=credit*MIB,workingSetBytesMax=credit*MIB,peakBytes=credit*MIB,oomKillDelta=0,oomKilled=False))
 data={'containers':rows,'stoppedProduction':[dict(service=s,id=IDS[s],limitBytes=CAPS[s]*MIB)for s in IDS], 'host':dict(minimumAvailableMiB=available,swapInMiBPerSecond=0,swapOutMiBPerSecond=0,psiSomeAvg10Max=0,psiFullAvg10Max=0,hostOomKillDelta=0)}
 return dict(totalMiB=7945,availableMiB=available,swapUsedMiB=110),data
class SequentialBudget(unittest.TestCase):
 def assess(self,mem,data,disk=168):return q.assess(mem,CAPS,768,disk,data,IDS)
 def test_actual_failure_evidence_admits_sequential_work_and_full_resume(self):
  mem,data=fixture();r=self.assess(mem,data)
  self.assertEqual(r['phaseWorkRequiredAvailableMiB'],4720);self.assertEqual(r['resumeRequiredAvailableMiB'],5104);self.assertEqual(r['requiredAvailableMiB'],5104)
  self.assertEqual(r['hostHeadroomMiB'],1536);self.assertEqual(r['additionalJobOrBuildMiB'],768);self.assertTrue(r['passed'])
 def test_resume_gate_blocks_even_when_job_alone_fits(self):
  mem,data=fixture(5000);r=self.assess(mem,data);self.assertFalse(r['passed']);self.assertEqual(r['deficitMiB'],104)
 def test_running_or_unverified_stopped_writers_get_no_credit(self):
  mem,data=fixture();data['containers'].append(dict(project=PROJECT,service='web'))
  with self.assertRaisesRegex(RuntimeError,'MIGRATION_WRITERS_MUST_BE_STOPPED'):self.assess(mem,data)
  mem,data=fixture();data['stoppedProduction'][0]['id']='c'*64
  with self.assertRaisesRegex(RuntimeError,'FROZEN_WRITER_IDENTITIES_CHANGED'):self.assess(mem,data)
 def test_larger_stopped_limits_are_still_reserved_for_resume(self):
  mem,data=fixture();data['stoppedProduction'][0]['limitBytes']=1024*MIB;r=self.assess(mem,data)
  self.assertEqual(r['resumeRequiredAvailableMiB'],5360);self.assertEqual(r['phaseWorkRequiredAvailableMiB'],4720)
 def test_pressure_oom_disk_and_swapping_still_block(self):
  for field,value,code in [('psiFullAvg10Max',0.2,'HOST_MEMORY_PRESSURE'),('hostOomKillDelta',1,'OOM_EVIDENCE_REVIEW_REQUIRED'),('swapInMiBPerSecond',1,'SUSTAINED_HOST_SWAPPING')]:
   mem,data=fixture();data['host'][field]=value;self.assertIn(code,self.assess(mem,data)['stopReasons'])
  mem,data=fixture();self.assertIn('INSUFFICIENT_DISK_HEADROOM',self.assess(mem,data,20)['stopReasons'])
 def test_another_job_stays_blocking(self):
  mem,data=fixture();job=copy.deepcopy(data['containers'][0]);job.update(service='tools',limitBytes=768*MIB);data['containers'].append(job)
  self.assertIn('ANOTHER_PRODUCTION_JOB_ACTIVE',self.assess(mem,data)['stopReasons'])
if __name__=='__main__':unittest.main()
