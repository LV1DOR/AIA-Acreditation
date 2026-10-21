#!/usr/bin/env python3
"""Operator-approved review flags only; no secret rotation, Docker, database or network calls."""
import sys
sys.dont_write_bytecode=True
import argparse,datetime,hashlib,json,os,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent;KIT=ROOT.parents[1]
sys.path.insert(0,str(KIT/'scripts'))
from common import STATE,MATERIAL,approved,require,operation_lock,safe_main
FLAGS=('CLERK_PRODUCTION_REVIEWED','SMTP_SENDER_VERIFIED','MINIO_PRIVATE_BUCKET_VERIFIED','MINIO_SCOPED_CREDENTIAL_VERIFIED','PRIVATE_INGRESS_VERIFIED','SECRET_CUSTODY_VERIFIED','AIA_PRIVACY_CONFIGURATION_APPROVED','BACKUP_CONFIGURATION_APPROVED')
ROLES=('web','worker','tools','provision','admin','privacy','monitor','backup')
def edit_flags(text):
    lines=text.splitlines(keepends=True);found={}
    for i,line in enumerate(lines):
        key,sep,value=line.partition('=')
        if not sep or key not in FLAGS:continue
        require(key not in found,'DUPLICATE_REVIEW_FLAG')
        try:parsed=json.loads(value.strip()) if value.lstrip().startswith('"') else value.strip()
        except (TypeError,ValueError):raise RuntimeError('INVALID_REVIEW_FLAG') from None
        require(parsed in ['true','false'],'INVALID_REVIEW_FLAG');found[key]=True
        ending='\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
        lines[i]=key+'="true"'+ending
    require(set(found)==set(FLAGS),'EXPECTED_REVIEW_FLAGS_MISSING')
    return ''.join(lines)
def atomic_write(path,data):
    meta=path.stat();fd,name=tempfile.mkstemp(prefix='.runtime-review-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            os.fchmod(out.fileno(),meta.st_mode&0o777);os.fchown(out.fileno(),meta.st_uid,meta.st_gid)
            out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
def apply_batch(updates,writer=atomic_write):
    original={p:p.read_bytes() for p in updates}
    try:
        for p,data in updates.items():writer(p,data)
    except Exception:
        for p,data in original.items():atomic_write(p,data)
        raise RuntimeError('REVIEW_UPDATE_FAILED_ORIGINAL_FILES_RESTORED') from None

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ['approve-reviewed-private-runtime','confirm-encrypted-offhost-key-custody','approve-admin-only-privacy-configuration','approve-initial-backup-configuration']:p.add_argument('--'+flag,action='store_true')
    args=p.parse_args()
    require(all(vars(args).values()),'EXPLICIT_CONFIGURATION_AND_CUSTODY_CONFIRMATIONS_REQUIRED')
    require(os.geteuid()==0,'OPERATOR_SUDO_REQUIRED')
    review=approved('runtime-configuration-review')
    with operation_lock():
        require(not list(STATE.glob('start-private-*.json')),'INITIAL_PRIVATE_START_REVIEW_ONLY')
        require(list(STATE.glob('migrate-*.json')) and list(STATE.glob('grants-*.json')),'MIGRATIONS_AND_GRANTS_REQUIRED')
        storage=json.loads((STATE/'backups/storage-capability.json').read_text())
        require(storage.get('project')=='aia-accreditation-production' and storage.get('passed') is True,'SUCCESSFUL_SCOPED_STORAGE_CHECK_REQUIRED')
        require(json.loads((STATE/'images.json').read_text())['material']==MATERIAL,'RELEASE_REVIEW_CHANGED')
        updates={}
        for role in ROLES:
            path=STATE/'secrets'/(role+'.env');meta=path.lstat()
            require(path.is_file() and not path.is_symlink() and meta.st_mode&0o077==0,'PRIVATE_REGULAR_ENVIRONMENT_REQUIRED')
            with path.open(newline='') as src:before=src.read()
            after=edit_flags(before)
            if after!=before:updates[path]=after.encode()
        if not updates:print('REVIEW_FLAGS_ALREADY_SET_CONFIGURATION_CHECK_STILL_REQUIRED');return
        now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup=STATE/('runtime-review-before-'+now);backup.mkdir(mode=0o700)
        for path in updates:
            with (backup/path.name).open('xb') as out:os.fchmod(out.fileno(),0o600);out.write(path.read_bytes());out.flush();os.fsync(out.fileno())
        apply_batch(updates)
        record={'project':'aia-accreditation-production','material':MATERIAL,'approvalReference':review['approvalReference'],'scope':'PRIVATE_ADMIN_AND_CONTROLLED_TEST_IDENTITIES','operatorAttestedEncryptedOffHostKeyCustody':True,'configurationFlagsApproved':list(FLAGS),'rolesUpdated':[p.stem for p in updates],'runtimeAcceptancePassed':False,'servicesStarted':False}
        with (STATE/('runtime-review-'+now+'.json')).open('x') as out:os.fchmod(out.fileno(),0o600);out.write(json.dumps(record,indent=2)+'\n')
        print('REVIEW_FLAGS_UPDATED_CREDENTIALS_PRESERVED_NO_SERVICES_STARTED')
        print('PROTECTED_PREVIOUS_ENVIRONMENTS: '+str(backup))
        print('NEXT: run the separately approved configuration-check; functional acceptance remains pending.')
if __name__=='__main__':safe_main(main)
