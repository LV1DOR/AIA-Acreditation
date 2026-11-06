"""Explicit, audited recovery for one proven deadline edit. No images/config/grants changes."""
import sys
sys.dont_write_bytecode=True
import importlib.util,json,os,re,subprocess,uuid,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent;KIT=ROOT.parents[1]
sys.path.insert(0,str(KIT/'scripts'));sys.path.insert(0,str(KIT/'release/controlled-cutover-20261021'));sys.path.insert(0,str(KIT/'release/resend-monitoring-20261104'))
import production
from common import STATE,PROJECT,MATERIAL,require,operation_lock,put,locked_child_options,safe_main
from capacity_gate import bounded_probe_capacity
from quiesced_capacity import memory_bytes
spec=importlib.util.spec_from_file_location('reviewed_release_capacity',KIT/'release/resend-monitoring-20261104/deploy_approved.py');release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
EXPECTED_MATERIAL='6ead68a93095cee8468628bdf943c1bd6a4c18bba2396d08b3d41a9532cd9b59'
EVENT='c995c218-d0f3-47b0-bf11-f6c7e841190d';AUDIT='d122d026-2c3e-4293-8d9d-9254aa7fd9c5';DEADLINE='2026-11-10T23:55:00.000Z'
JOB_UNCERTAIN=False

def arguments(mode,name,plan=None):
 require(mode in ['preview','apply','verify'],'FIXED_RECOVERY_MODE_REQUIRED')
 require(re.fullmatch(re.escape(PROJECT)+r'-deadline-(preview|apply|verify)-[0-9TZ]+',name),'SCOPED_JOB_NAME_REQUIRED')
 command=['docker','--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--env-file',str(STATE/'compose.env'),'-f',str(KIT/'compose.yaml'),'-f',str(ROOT/'compose.probe.yaml'),'-f',str(ROOT/'compose.recovery.yaml'),'--profile','maintenance','run','--name',name,'--no-deps','--pull','never','-T','-v',str(ROOT/'recover.ts')+':/app/deadline_recovery.ts:ro','-v',str(ROOT/'policy.mjs')+':/app/deadline_policy.mjs:ro','-e','AIA_DEADLINE_RECOVERY_MODE='+mode]
 if mode!='preview':
  require(plan is not None and plan.is_file()and not plan.is_symlink()and plan.parent.parent==STATE,'PRIVATE_RECOVERY_PLAN_REQUIRED')
  command+=['-v',str(plan)+':/tmp/deadline-recovery-plan.json:ro']
 if mode=='apply':command+=['-e','AIA_DEADLINE_RECOVERY_CONFIRM=RESTORE_ONLY_PREVIOUS_APPROVALS_KEEP_10_NOVEMBER']
 return command+['admin','node','node_modules/tsx/dist/cli.mjs','/app/deadline_recovery.ts']

def settle_job(name):
 ids=production.docker('ps','-aq','--filter','name=^/'+name+'$').splitlines()
 if not ids:return
 require(len(ids)==1,'ONE_SCOPED_RECOVERY_JOB_REQUIRED')
 info=json.loads(production.docker('inspect',ids[0]))[0]
 require(info['Config']['Labels'].get('com.docker.compose.project')==PROJECT and info['Config']['Labels'].get('com.docker.compose.service')=='admin','RECOVERY_JOB_SCOPE_MISMATCH')
 if info['State']['Running']:production.docker('stop','--time','60',name)
 require(not production.docker('ps','-q','--filter','name=^/'+name+'$'),'RECOVERY_JOB_STILL_RUNNING_KEEP_WRITERS_STOPPED')

def job(mode,plan=None):
 global JOB_UNCERTAIN
 name=PROJECT+'-deadline-'+mode+'-'+production.stamp()
 env={k:v for k,v in os.environ.items()if not k.startswith(('DOCKER_','COMPOSE_','AIA_','SMTP_','CLERK_','RESEND_'))}
 JOB_UNCERTAIN=True
 try:
  result=subprocess.run(arguments(mode,name,plan),env=env,cwd=KIT,capture_output=True,text=True,timeout=180)
  reports=[]
  for line in result.stdout.splitlines():
   try:
    item=json.loads(line)
    if isinstance(item,dict)and type(item.get('passed'))is bool:reports.append(item)
   except ValueError:pass
  report=reports[-1]if reports else {'passed':False,'code':'SCOPED_RECOVERY_JOB_OUTPUT_MISSING','exitCode':result.returncode}
  return report
 finally:
  settle_job(name);JOB_UNCERTAIN=False

def summarize(plan):
 reasons={}
 for item in plan.get('excluded',[]):reasons[item['reason']]=reasons.get(item['reason'],0)+1
 return {k:plan[k]for k in ['eventId','eventVersion','deadline','eligibleRegistrations','workersToRestore','workersInRecoveredRegistrations']}|{'excludedByReason':reasons}

def require_report(report):
 require(report.get('passed')is True,report.get('code','SCOPED_RECOVERY_FAILED')if re.fullmatch('[A-Z0-9_]{4,100}',str(report.get('code','')))else'SCOPED_RECOVERY_FAILED')

def verify_admin_config(config,tools_id):
 require(config.get('name')==PROJECT,'EXACT_RECOVERY_PROJECT_REQUIRED')
 service=config['services']['admin']
 require(service['image']==tools_id,'CURRENT_IMMUTABLE_TOOLS_REQUIRED')
 require(memory_bytes(service.get('mem_limit'))==384*1024**2 and memory_bytes(service.get('memswap_limit'))==384*1024**2,'RECOVERY_ADMIN_JOB_MUST_BE_CAPPED_AT_384_MIB')
 require(any(isinstance(secret,dict)and secret.get('source')=='web_env'and secret.get('target')=='deadline_recovery_env'for secret in service['secrets']),'EXISTING_WEB_KEY_READ_ONLY_MOUNT_REQUIRED')

def main():
 require(sys.argv[1:]==['--restore-previously-approved'],'EXPLICIT_RECOVERY_FLAG_REQUIRED')
 require(os.geteuid()==0,'RUN_IN_PUTTY_WITH_SUDO');require(sys.stdin.isatty(),'INTERACTIVE_RECOVERY_REQUIRED');require(MATERIAL==EXPECTED_MATERIAL,'INSTALLED_RELEASE_CHANGED_INSPECT_FIRST')
 os.umask(0o077)
 with operation_lock()as fd:
  verify_admin_config(json.loads(production.dc('-f',str(ROOT/'compose.probe.yaml'),'-f',str(ROOT/'compose.recovery.yaml'),'--profile','maintenance','config','--format','json')),json.loads((STATE/'images.json').read_text())['images']['tools']['id'])
  production.healthy(production.SERVICES);bounded_probe_capacity(ROOT/'compose.probe.yaml')
  print('READ_ONLY_RECOVERY_PREVIEW',flush=True)
  plan=job('preview');require_report(plan)
  require(plan['eventId']==EVENT and plan['eventAuditId']==AUDIT and plan['deadline']==DEADLINE,'EXACT_DEADLINE_SCOPE_REQUIRED')
  print(json.dumps(summarize(plan)),flush=True)
  require(plan['eligibleRegistrations']>0,'NO_UNCHANGED_PREVIOUSLY_APPROVED_REGISTRATIONS_FOUND')
  print('Fresh encrypted backup with brief web/worker/ingress pause, then quiesce web/worker for atomic recovery. Restore ONLY proven prior approvals; add immutable recovery revisions, preserve all original history/photos/privacy evidence and keep 10 November. No email, link reactivation, images, migrations, credentials, Nginx, staging or Volunteers changes.',flush=True)
  require(input('Type RESTORE-APPROVALS to approve exactly the previewed recovery: ').strip()=='RESTORE-APPROVALS','EXPLICIT_RECOVERY_APPROVAL_REQUIRED')
  attempt=STATE/('deadline-recovery-'+production.stamp());attempt.mkdir(mode=0o700)
  plan['recoveryId']=str(uuid.uuid4());path=attempt/'plan.json';put(path,plan)
  code_hash={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest()for n in ['recover.py','recover.ts','policy.mjs','compose.probe.yaml','compose.recovery.yaml']}
  put(attempt/'reviewed-code.json',code_hash)
  dependencies={s:json.loads(production.docker('inspect','--format','{{json .}}',PROJECT+'-'+s+'-1'))['Id']for s in ['postgres','redis','minio']}
  print('FRESH_ENCRYPTED_BACKUP_BEFORE_RECOVERY',flush=True)
  before=set((STATE/'backups').glob('*.receipt.json'));release.child('backup-local',fd)
  fresh=set((STATE/'backups').glob('*.receipt.json'))-before;require(len(fresh)==1,'ONE_FRESH_ENCRYPTED_BACKUP_REQUIRED')
  put(attempt/'backup.json',{'receipt':str(next(iter(fresh))),'offSiteVerified':False})
  require(all(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h for n,h in code_hash.items()),'RECOVERY_CODE_CHANGED')
  print('PAUSING_ORIGINAL_WEB_AND_WORKER_ONLY',flush=True)
  failure=None;applied=None;verified=None
  try:
   production.dc('stop','--timeout','60','web','worker')
   bounded_probe_capacity(ROOT/'compose.probe.yaml')
   print('APPLYING_ATOMIC_HISTORY_PRESERVING_RECOVERY',flush=True)
   applied=job('apply',path);put(attempt/'apply.json',applied)
   if not applied.get('passed'):
    # A client can fail after COMMIT: consult the idempotency marker before any retry.
    verified=job('verify',path);put(attempt/'verify-after-failure.json',verified)
    if not verified.get('passed'):require_report(applied)
   if verified is None:verified=job('verify',path);put(attempt/'verify.json',verified)
   require_report(verified)
  except Exception as error:failure=error
  finally:
   require(not JOB_UNCERTAIN,'RECOVERY_JOB_UNCERTAIN_KEEP_WRITERS_STOPPED')
   release.capacity_preflight('steady')
   production.dc('start','--wait','--wait-timeout','120','web','worker')
   production.healthy(production.SERVICES);release.public_ready()
   for s,id in dependencies.items():require(production.docker('inspect','--format','{{.Id}}',PROJECT+'-'+s+'-1')==id,'DEPENDENCY_CONTAINER_CHANGED')
  print('PROTECTED_RECOVERY_REPORTS: '+str(attempt),flush=True)
  if failure:raise failure
  print(json.dumps(verified),flush=True)
  print('DEADLINE_APPROVAL_RECOVERY_PASSED_10_NOVEMBER_PRESERVED',flush=True)
if __name__=='__main__':safe_main(main)
