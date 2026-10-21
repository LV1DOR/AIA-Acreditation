#!/usr/bin/env python3
"""OPERATOR-INSTALLED AUTOMATION ONLY. Uses only this kit's approved production actions."""
import json,subprocess,datetime
from common import KIT,STATE,approved,require,safe_main,operation_lock,locked_child_options
def cycle(fd):
    approved('backup-cycle')
    failure=STATE/'offsite/cycle-failure.json'
    failure.write_text(json.dumps({'failedOrIncomplete':True,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}));failure.chmod(0o600)
    before=set((STATE/'backups').glob('*.receipt.json'))
    r=subprocess.run(['python3',str(KIT/'scripts/production.py'),'backup-local'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=3600,**locked_child_options(fd))
    require(r.returncode==0,'LOCAL_BACKUP_CYCLE_FAILED')
    new=set((STATE/'backups').glob('*.receipt.json'))-before;require(len(new)==1,'EXACT_NEW_BACKUP_RECEIPT_REQUIRED')
    identifier=json.loads(new.pop().read_text())['id']
    r=subprocess.run(['python3',str(KIT/'scripts/offsite.py'),'upload','--backup-id',identifier],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=21600,**locked_child_options(fd))
    require(r.returncode==0,'OFFSITE_BACKUP_CYCLE_FAILED')
    failure.unlink()
    print(json.dumps({'backupId':identifier,'localAndRemoteCiphertextVerified':True,'restoreVerified':False}))
def main():
    approved('backup-cycle')
    with operation_lock() as fd:cycle(fd)
if __name__=='__main__':safe_main(main)
