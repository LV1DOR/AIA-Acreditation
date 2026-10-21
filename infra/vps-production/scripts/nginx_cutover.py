#!/usr/bin/env python3
"""OPERATOR ONLY. Explicitly approved single-site cutover or immediate holding-page rollback."""
import argparse,hashlib,json,os,shutil,subprocess
from common import KIT,STATE,approved,require,put,safe_main

SITE='/etc/nginx/sites-available/aia-accreditation-public'
def require_cutover_review(review):
    require(review.get('status')=='GO_FOR_CONTROLLED_CUTOVER','SIGNED_CONTROLLED_CUTOVER_REVIEW_REQUIRED')
    for key in ['storageErasureEvidence','privacyApprovalReference','restoreEvidence','resourceEvidence','networkAndPortsEvidence','alertDeliveryEvidence']:
        require(review.get(key),'LAUNCH_GATE_EVIDENCE_REQUIRED')
def run(args):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=120)
    require(p.returncode==0,'NGINX_OPERATOR_STEP_FAILED');return p.stdout
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['candidate-test','apply','rollback']);a=p.parse_args()
    r=approved('nginx-'+a.action);require(os.geteuid()==0,'PRIVILEGED_NGINX_OPERATOR_REQUIRED')
    candidate=KIT/'nginx/app.joinaia.pt.conf';saved=STATE/'nginx-previous-holding.conf'
    if a.action=='rollback':
        require(saved.is_file(),'EXACT_HOLDING_BACKUP_REQUIRED');shutil.copyfile(saved,SITE);os.chmod(SITE,0o644)
        run(['nginx','-t']);run(['systemctl','reload','nginx']);print('HOLDING_CONFIGURATION_RESTORED_ALL_PRODUCTION_DATA_PRESERVED');return
    if a.action=='candidate-test':
        # Test shadow configuration; no existing host site, trust file, or service is changed.
        from pathlib import Path
        folder=STATE/'nginx-test';folder.mkdir(mode=0o700,exist_ok=True)
        c=candidate.read_text().replace('/etc/nginx/aia-accreditation-production-ca.crt',str(STATE/'tls/ca.crt'))
        (folder/'site.conf').write_text(c);(folder/'site.conf').chmod(0o600)
        global_config=Path('/etc/nginx/nginx.conf').read_text()
        require(global_config.count('include /etc/nginx/sites-enabled/*;')==1,'GLOBAL_NGINX_LAYOUT_CHANGED_REVIEW_REQUIRED')
        includes=[]
        for path in sorted(Path('/etc/nginx/sites-enabled').iterdir()):
            if path.name!='aia-accreditation-public':includes.append('include '+str(path)+';')
        global_config=global_config.replace('include /etc/nginx/sites-enabled/*;','\n'.join(includes+['include '+str(folder/'site.conf')+';']))
        (folder/'nginx.conf').write_text(global_config);(folder/'nginx.conf').chmod(0o600)
        run(['nginx','-t','-c',str(folder/'nginx.conf')]);print('CANDIDATE_SYNTAX_PASSED_NO_LIVE_CONFIG_CHANGED');return
    require_cutover_review(r)
    acceptance=json.loads((STATE/'acceptance.json').read_text());require(acceptance.get('preCutoverRequiredPassed') is True and acceptance.get('postCutoverChecksPrepared') is True and acceptance.get('operator') and acceptance.get('evidenceReference'),'SIGNED_ACCEPTANCE_REQUIRED')
    from pathlib import Path
    require(Path('/etc/nginx/sites-enabled/aia-accreditation-public').resolve()==Path(SITE),'EXPECTED_SINGLE_SITE_SYMLINK_REQUIRED')
    require(Path(SITE).read_bytes()==(KIT/'nginx/holding-page.observed.conf').read_bytes(),'HOLDING_CONFIG_CHANGED_REAUDIT_REQUIRED')
    require(not saved.exists(),'PREVIOUS_CUTOVER_BACKUP_ALREADY_EXISTS_INSPECT_FIRST')
    put(saved,Path(SITE).read_text())
    ca=Path('/etc/nginx/aia-accreditation-production-ca.crt');require(not ca.exists(),'PRODUCTION_CA_PATH_ALREADY_EXISTS_REVIEW_FIRST')
    shutil.copyfile(STATE/'tls/ca.crt',ca);ca.chmod(0o644)
    shutil.copyfile(candidate,SITE);os.chmod(SITE,0o644)
    try:
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
        run(['curl','--fail','--silent','--show-error','--resolve','app.joinaia.pt:443:127.0.0.1','https://app.joinaia.pt/api/health/ready'])
    except Exception:
        shutil.copyfile(saved,SITE);os.chmod(SITE,0o644);run(['nginx','-t']);run(['systemctl','reload','nginx']);raise RuntimeError('CUTOVER_FAILED_HOLDING_RESTORED')
    print('PUBLIC_ROUTE_ACTIVATED_OPERATOR_MUST_RUN_EXTERNAL_ACCEPTANCE_NOW')
if __name__=='__main__':safe_main(main)
