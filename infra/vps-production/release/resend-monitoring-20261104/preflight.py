"""Read-only source baseline and public TLS readiness. No Docker, env files or personal data."""
import sys,subprocess
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT.parents[1]/'scripts'))
from common import MATERIAL,require,safe_main

def main():
    require(MATERIAL=='ad0b3cf4a81b359d4cf6598c14b7c33506bfef3496a0be780b181324b1c7e8cc','LIVE_RELEASE_BASELINE_CHANGED')
    result=subprocess.run(['curl','--silent','--show-error','--max-time','20','--output','/dev/null','--write-out','%{http_code}','https://app.joinaia.pt/api/health/ready'],capture_output=True,text=True)
    require(result.returncode==0 and result.stdout=='200','PUBLIC_TLS_READINESS_REQUIRED_BEFORE_BUILD')
    print('LIVE_BASELINE_AND_PUBLIC_TLS_READY_NO_SERVICES_OR_DATA_CHANGED')
if __name__=='__main__':safe_main(main)
