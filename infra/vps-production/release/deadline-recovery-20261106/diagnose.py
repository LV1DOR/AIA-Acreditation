"""One bounded read-only production history job. Never repairs records or sends mail."""
import sys
sys.dont_write_bytecode=True
import json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;KIT=ROOT.parents[1]
sys.path.insert(0,str(KIT/'scripts'));sys.path.insert(0,str(KIT/'release/controlled-cutover-20261021'))
import production
from common import STATE,PROJECT,require,operation_lock,put,safe_main
from capacity_gate import bounded_probe_capacity

def main():
 require(os.geteuid()==0,'RUN_IN_PUTTY_WITH_SUDO')
 os.umask(0o077)
 with operation_lock():
  bounded_probe_capacity(ROOT/'compose.probe.yaml')
  name=PROJECT+'-deadline-readonly-'+production.stamp()
  command=['docker','--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--env-file',str(STATE/'compose.env'),'-f',str(KIT/'compose.yaml'),'-f',str(ROOT/'compose.probe.yaml'),'--profile','maintenance','run','--name',name,'--no-deps','--pull','never','-T','-v',str(ROOT/'diagnose.ts')+':/app/diagnose_deadline_recovery.ts:ro','monitor','node','node_modules/tsx/dist/cli.mjs','/app/diagnose_deadline_recovery.ts']
  env={k:v for k,v in os.environ.items()if not k.startswith(('DOCKER_','COMPOSE_','AIA_','SMTP_','CLERK_','RESEND_'))}
  result=subprocess.run(command,cwd=KIT,env=env,capture_output=True,text=True,timeout=120)
  try:report=json.loads(result.stdout)
  except ValueError:report={'passed':False,'readOnly':True,'code':'DEADLINE_DIAGNOSTIC_RUNTIME_FAILED','containerExitCode':result.returncode,'moduleResolutionFailed':'ERR_MODULE_NOT_FOUND'in result.stderr,'bindMountFailed':'error mounting'in result.stderr}
  require(isinstance(report,dict),'EXPECTED_SANITIZED_REPORT')
  path=STATE/'logs'/('deadline-history-'+production.stamp()+'.json');put(path,report)
  print('PROTECTED_METADATA_REPORT: '+str(path));print(json.dumps(report,indent=2))
  require(result.returncode==0 and report.get('passed')is True,'DEADLINE_DIAGNOSTIC_FAILED_NO_DATA_CHANGED')
if __name__=='__main__':safe_main(main)
