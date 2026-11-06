"""Send only the operator-approved bilingual deadline notice; no services/config changes."""
import sys
sys.dont_write_bytecode=True
import json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;KIT=ROOT.parents[1]
sys.path.insert(0,str(KIT/'scripts'));sys.path.insert(0,str(KIT/'release/controlled-cutover-20261021'))
sys.path.insert(0,str(KIT/'release/resend-monitoring-20261104'))
import production
from common import STATE,PROJECT,MATERIAL,require,operation_lock,put,safe_main
from capacity_gate import bounded_probe_capacity
from quiesced_capacity import memory_bytes

def command(name):
 return ['docker','--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--env-file',str(STATE/'compose.env'),'-f',str(KIT/'compose.yaml'),'-f',str(ROOT/'compose.notice.yaml'),'--profile','maintenance','run','--name',name,'--no-deps','--pull','never','-T','-v',str(ROOT/'send.ts')+':/app/deadline_notice_send.ts:ro','-v',str(ROOT/'notice.mjs')+':/app/deadline_notice.mjs:ro','-e','AIA_NOTICE_APPROVAL=SEND_APPROVED_BILINGUAL_NOTICE','admin','node','node_modules/tsx/dist/cli.mjs','/app/deadline_notice_send.ts']

def main():
 require(sys.argv[1:]==['--send-approved-bilingual-notice'],'EXPLICIT_SEND_FLAG_REQUIRED')
 require(os.geteuid()==0,'OPERATOR_PUTTY_SUDO_REQUIRED')
 require(MATERIAL=='6ead68a93095cee8468628bdf943c1bd6a4c18bba2396d08b3d41a9532cd9b59','INSTALLED_RELEASE_CHANGED_INSPECT_FIRST')
 os.umask(0o077)
 with operation_lock():
  config=json.loads(production.dc('-f',str(ROOT/'compose.notice.yaml'),'--profile','maintenance','config','--format','json'))
  admin=config['services']['admin'];tools=json.loads((STATE/'images.json').read_text())['images']['tools']['id']
  require(config['name']==PROJECT and admin['image']==tools,'EXACT_CURRENT_ADMIN_IMAGE_REQUIRED')
  require(memory_bytes(admin['mem_limit'])==384*1024**2 and memory_bytes(admin['memswap_limit'])==384*1024**2,'NOTICE_JOB_CAP_REQUIRED')
  bounded_probe_capacity(KIT/'release/deadline-recovery-20261106/compose.probe.yaml')
  name=PROJECT+'-deadline-notice-'+production.stamp()
  print('SENDING_APPROVED_PT_EN_NOTICE_PRIMARY_VERIFIED_LEADERS_ONLY_NO_SERVICES_CHANGED',flush=True)
  env={k:v for k,v in os.environ.items()if not k.startswith(('DOCKER_','COMPOSE_','AIA_','CLERK_','SMTP_','RESEND_'))}
  try:
   result=subprocess.run(command(name),env=env,cwd=KIT,capture_output=True,text=True,timeout=900)
  except subprocess.TimeoutExpired:
   print('STOP: NOTICE_TIMEOUT_CHECK_PROVIDER_AND_SCOPED_JOB_BEFORE_RETRY',flush=True)
   raise RuntimeError('NOTICE_STATUS_UNCERTAIN_DO_NOT_RESEND')
  reports=[]
  for line in result.stdout.splitlines():
   try:
    report=json.loads(line)
    if isinstance(report,dict) and ('passed'in report or report.get('stage')in ['BILINGUAL_NOTICE_PREFLIGHT','NOTICE_SMTP_ACCEPTED']):reports.append(report)
   except ValueError:pass
  path=STATE/'logs'/('deadline-notice-'+production.stamp()+'.json')
  put(path,{'container':name,'exitCode':result.returncode,'reports':reports})
  print('PROTECTED_NOTICE_REPORT: '+str(path),flush=True)
  for report in reports:print(json.dumps(report),flush=True)
  require(result.returncode==0 and reports and reports[-1].get('passed')is True,'NOTICE_FAILED_INSPECT_BEFORE_RETRY')
  print('BILINGUAL_NOTICE_SMTP_ACCEPTANCE_RECORDED_NO_DUPLICATE_RESENDS',flush=True)
if __name__=='__main__':safe_main(main)
