#!/usr/bin/env python3
"""OPERATOR ONLY. Dedicated encrypted restic repository; no shared backup configuration."""
import argparse,hashlib,json,os,re,subprocess,urllib.parse
from common import KIT,STATE,PROJECT,put,require,approved,safe_main,operation_lock
def parse_args():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['init','upload','retrieve','retention']);p.add_argument('--backup-id');p.add_argument('--snapshot');return p.parse_args()
def operation(a):
    review=approved('offsite-'+a.action)
    c=json.loads((STATE/'offsite/config.json').read_text())
    require(c.get('project')==PROJECT and c.get('repository','').startswith('s3:https://') and c['repository'].endswith('/'+PROJECT),'DEDICATED_HTTPS_OFFSITE_REPOSITORY_REQUIRED')
    u=urllib.parse.urlsplit(c['repository'][3:]);require(u.scheme=='https' and u.hostname and u.username is None and u.password is None,'NO_EMBEDDED_OFFSITE_CREDENTIALS')
    require(c.get('bucketVersioningAndExpiryReviewed') is True,'OFFSITE_HISTORY_RETENTION_REVIEW_REQUIRED')
    require(c.get('policyReference')==review.get('backupPolicyReference') and c.get('policyReference'),'APPROVED_OFFSITE_POLICY_REQUIRED')
    env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','SSL_CERT_FILE','SSL_CERT_DIR']}
    env.update(RESTIC_REPOSITORY=c['repository'],RESTIC_PASSWORD_FILE=str(STATE/'offsite/restic-password'),RESTIC_CACHE_DIR=str(STATE/'offsite/cache'))
    credentials=json.loads((STATE/'offsite/credentials.json').read_text())
    require(set(credentials).issubset({'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_DEFAULT_REGION','AWS_SESSION_TOKEN'}),'UNEXPECTED_OFFSITE_CREDENTIAL_KEY')
    env.update(credentials)
    def restic(*args):
        r=subprocess.run(['restic',*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=21600)
        require(r.returncode==0,'OFFSITE_OPERATION_FAILED_DETAILS_SUPPRESSED');return r.stdout
    if a.action=='init':restic('init');print('DEDICATED_RESTIC_REPOSITORY_INITIALISED');return
    if a.action=='retention':
        hours=c.get('retentionHours');require(isinstance(hours,(int,float)) and hours>0,'APPROVED_OFFSITE_RETENTION_REQUIRED')
        # Destructive operation is separate, scoped to this unique repository and explicit approval.
        restic('forget','--keep-within',str(hours)+'h','--prune');restic('check','--read-data')
        put(STATE/'offsite'/('retention-'+__import__('datetime').datetime.now().strftime('%Y%m%d%H%M%S')+'.json'),{'project':PROJECT,'pruneAndReadDataCheckPassed':True,'policyReference':c['policyReference']})
        print('OFFSITE_RETENTION_EXECUTED_LEDGER_AND_PROVIDER_COPY_RECONCILIATION_STILL_REQUIRED');return
    require(a.backup_id and re.fullmatch('[a-f0-9-]{36}',a.backup_id),'EXACT_BACKUP_ID_REQUIRED')
    names=[a.backup_id+x for x in ['.aia-backup','.aia-keys','.receipt.json']]
    if a.action=='upload':
        files=[STATE/'backups'/n for n in names]
        require(all(f.is_file() and not f.is_symlink() for f in files),'EXACT_BACKUP_ARTIFACTS_REQUIRED')
        r=json.loads(files[2].read_text());require(r.get('id')==a.backup_id and r.get('target',{}).get('database')=='aia_accreditation_production','PRODUCTION_RECEIPT_REQUIRED')
        for file,key in [(files[0],'archiveHash'),(files[1],'keyBundleHash')]:
            h=hashlib.sha256()
            with file.open('rb') as f:
                while chunk:=f.read(1024*1024):h.update(chunk)
            require(h.hexdigest()==r[key],'LOCAL_ARTIFACT_HASH_MISMATCH')
        output=restic('backup','--json','--tag',PROJECT,'--tag','backup:'+a.backup_id,*map(str,files))
        rows=[json.loads(line) for line in output.splitlines() if line.startswith('{')]
        snapshot=next((row.get('snapshot_id') for row in reversed(rows) if row.get('message_type')=='summary'),None)
        require(snapshot and re.fullmatch('[a-f0-9]{8,64}',snapshot),'OFFSITE_SNAPSHOT_RECEIPT_REQUIRED')
        restic('check','--read-data')
        put(STATE/'offsite'/('upload-'+a.backup_id+'.json'),{'project':PROJECT,'backupId':a.backup_id,'snapshot':snapshot,'remoteReadDataCheckPassed':True,'restoreVerified':False,'sourceArchiveDirectory':str(STATE/'backups')})
        print(json.dumps({'offSiteUploaded':True,'backupId':a.backup_id,'snapshot':snapshot,'restoreVerified':False}));return
    require(a.snapshot and re.fullmatch('[a-f0-9]{8,64}',a.snapshot),'EXACT_SNAPSHOT_REQUIRED')
    dest=KIT/'restore-state/input';require(dest.is_dir(),'PREPARE_ISOLATED_RESTORE_FIRST')
    source=c.get('sourceArchiveDirectory');require(source=='/home/luke/aia-accreditation-production-kit/state/backups','EXACT_BACKUP_SOURCE_DIRECTORY_REQUIRED')
    for name in names:
        path=dest/name;require(not path.exists(),'RESTORE_INPUT_EXISTS_DO_NOT_OVERWRITE')
        with path.open('xb') as f:
            path.chmod(0o600)
            r=subprocess.run(['restic','dump',a.snapshot,source+'/'+name],env=env,stdout=f,stderr=subprocess.PIPE,timeout=21600)
            require(r.returncode==0,'OFFSITE_DOWNLOAD_FAILED')
    print('THREE_ENCRYPTED_ARTIFACTS_RETRIEVED_RESTORE_NOT_YET_VERIFIED')
def main():
    a=parse_args()
    with operation_lock():operation(a)
if __name__=='__main__':safe_main(main)
