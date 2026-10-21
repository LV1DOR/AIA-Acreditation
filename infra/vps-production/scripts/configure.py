#!/usr/bin/env python3
"""OPERATOR ONLY: create NEW production secrets/configuration. No infrastructure actions.
Run after explicit configuration approval. This agent has not run this script.
"""
import argparse, datetime, getpass, json, os, re, secrets, shutil, subprocess
from common import KIT, STATE, PROJECT, COMMIT, MATERIAL, DB, require, put, envput, safe_main
from audit import materials

def hidden(label, pattern):
    v=getpass.getpass(label+' (hidden): ').strip()
    require(bool(re.fullmatch(pattern,v)), 'INVALID_OPERATOR_INPUT')
    return v
def preparation_policy(value=None):
    """Operational backup defaults; no invented legal deadline or enabled erasure."""
    policy={**(value or {})}
    for key,default in [('backupRetentionHours',168),('backupMaxAgeHours',24)]:
        if policy.get(key) is None:policy[key]=default
        require(type(policy[key]) in (int,float) and policy[key]>0,'VALID_BACKUP_OPERATIONAL_INTERVAL_REQUIRED')
    policy['backupPolicyReference']=policy.get('backupPolicyReference') or 'INITIAL-ADMIN-ONLY-BACKUP'
    policy['authMetadataPolicyReference']=policy.get('authMetadataPolicyReference') or ''
    policy['authMetadataEraseBefore']=policy.get('authMetadataEraseBefore') or ''
    if policy['authMetadataPolicyReference'] or policy['authMetadataEraseBefore']:
        require(len(policy['authMetadataPolicyReference'])>=5 and bool(policy['authMetadataEraseBefore']), 'COMPLETE_AUTH_METADATA_POLICY_REQUIRED')
        try:datetime.datetime.fromisoformat(policy['authMetadataEraseBefore'].replace('Z','+00:00'))
        except (ValueError,TypeError):raise RuntimeError('VALID_AUTH_METADATA_CUTOFF_REQUIRED') from None
    return policy
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--approve-new-production-configuration',action='store_true');a=parser.parse_args()
    require(a.approve_new_production_configuration,'EXPLICIT_CONFIGURATION_APPROVAL_REQUIRED')
    require(os.getuid()==1000,'RUN_AS_LUKE_NOT_ROOT')
    require(os.access(__import__('common').REPO/'.git/index',os.R_OK),'REPOSITORY_INDEX_PERMISSION_REVIEW_REQUIRED')
    materials(); require(not STATE.exists(),'STATE_EXISTS_DO_NOT_REGENERATE_KEYS')
    policy_path=KIT/'policy.json'
    policy=preparation_policy(json.loads(policy_path.read_text()) if policy_path.exists() else None)
    pk=hidden('Clerk Production publishable key',r'pk_live_[A-Za-z0-9_-]+')
    sk=hidden('Clerk Production secret key',r'sk_live_[A-Za-z0-9_-]+')
    wh=hidden('Clerk Production webhook signing secret',r'whsec_[A-Za-z0-9_+/=-]+')
    smtp=hidden('Resend SMTP API key',r're_[A-Za-z0-9_-]+')
    image=input('Reviewed AIStor image INCLUDING @sha256 digest (non-secret): ').strip()
    require(bool(re.fullmatch(r'quay\.io/minio/aistor/minio@sha256:[a-f0-9]{64}',image)),'REVIEWED_AISTOR_DIGEST_REQUIRED')
    os.umask(0o077)
    if not policy_path.exists():put(policy_path,policy)
    STATE.mkdir(mode=0o700)
    for d in ['secrets','secrets/meta','tls','tls/minio','tls/minio/CAs','backups','logs','storage-admin','source','offsite']:(STATE/d).mkdir(mode=0o700)
    sec,tls=STATE/'secrets',STATE/'tls'
    pwd={k:secrets.token_hex(32) for k in ['cluster','migrator','web','worker','erasure','backup','ledger','redis','minio','s3web','s3worker','s3backup','document','fingerprint','mail','proxy']}
    for file,key in [('postgres-password','cluster'),('redis-password','redis'),('minio-root-password','minio')]:put(sec/file,pwd[key])
    put(sec/'minio-root-user','aia_production_root')
    put(sec/'redis.acl',f'user default off\nuser aia on >{pwd["redis"]} ~aia:* &aia:* +@connection +@read +@write +@scripting +@pubsub +@transaction -@admin -@dangerous +eval +evalsha\n')
    put(sec/'minio.license','# OPERATOR MUST REPLACE WITH A SEPARATE PRODUCTION LICENCE; NEVER COPY STAGING\n')
    put(sec/'archive.key',secrets.token_bytes(32).hex())
    put(sec/'custody.key',secrets.token_bytes(32).hex())
    # Binary 32-byte key files, matching the existing backup encryption/key-bundle format.
    for name in ['archive.key','custody.key']:(sec/name).write_bytes(bytes.fromhex((sec/name).read_text()))
    def ssl(*args):subprocess.run(['openssl',*args],cwd=tls,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    ssl('req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','365','-subj','/CN=AIA Accreditation Production Private CA','-keyout','ca.key','-out','ca.crt')
    for name in ['postgres','redis','ingress','minio']:
        sans=f'DNS:{name},DNS:localhost,IP:127.0.0.1'+(',DNS:app.joinaia.pt' if name=='ingress' else '')
        put(tls/(name+'.ext'),f'subjectAltName={sans}\nextendedKeyUsage=serverAuth\n')
        ssl('req','-new','-newkey','rsa:2048','-nodes','-subj',f'/CN={name}','-keyout',name+'.key','-out',name+'.csr')
        ssl('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','90','-sha256','-extfile',name+'.ext','-out',name+'.crt')
    for src,dest in [('minio.crt','minio/public.crt'),('minio.key','minio/private.key'),('ca.crt','minio/CAs/ca.crt')]:shutil.copyfile(tls/src,tls/dest)
    for p in tls.rglob('*'):
        if p.is_file():p.chmod(0o600 if p.suffix=='.key' else 0o444)
    pg=lambda user,key,db=DB:f'postgresql://{user}:{pwd[key]}@postgres:5432/{db}?sslmode=verify-full&sslrootcert=/run/secrets/ca_cert'
    common=dict(NODE_ENV='production',DEPLOYMENT_ENV='production',APP_ORIGIN='https://app.joinaia.pt',AUTH_ADDITIONAL_ORIGINS='',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk,CLERK_SECRET_KEY=sk,CLERK_WEBHOOK_SIGNING_SECRET=wh,AUTH_EMAIL_ENCRYPTION_KEY=pwd['mail'],DOCUMENT_ENCRYPTION_KEY=pwd['document'],DOCUMENT_FINGERPRINT_KEY=pwd['fingerprint'],REDIS_URL=f'rediss://aia:{pwd["redis"]}@redis:6379',MINIO_ENDPOINT='https://minio:9000',MINIO_REGION='us-east-1',MINIO_PHOTOS_BUCKET='aia-accreditation-production-photos',EMAIL_PROVIDER='smtp',SMTP_HOST='smtp.resend.com',SMTP_PORT='465',SMTP_SECURE='true',SMTP_REQUIRE_TLS='true',SMTP_FROM='notificacoes@notify.joinaia.pt',SMTP_USER='resend',SMTP_PASSWORD=smtp,AIA_PROXY_SECRET=pwd['proxy'],WORKER_HEALTH_HOST='0.0.0.0',WORKER_HEALTH_PORT='3102',AUTH_METADATA_POLICY_REFERENCE=policy['authMetadataPolicyReference'],AUTH_METADATA_ERASE_BEFORE=policy['authMetadataEraseBefore'],BACKUP_MAX_AGE_HOURS=str(policy['backupMaxAgeHours']))
    for flag in ['CLERK_PRODUCTION_REVIEWED','SMTP_SENDER_VERIFIED','MINIO_PRIVATE_BUCKET_VERIFIED','MINIO_SCOPED_CREDENTIAL_VERIFIED','PRIVATE_INGRESS_VERIFIED','SECRET_CUSTODY_VERIFIED','AIA_PRIVACY_CONFIGURATION_APPROVED','BACKUP_CONFIGURATION_APPROVED']:common[flag]='false'
    for role in ['web','worker']:
        envput(sec/(role+'.env'),{**common,'DATABASE_URL':pg('aia_'+role,role),'MINIO_ACCESS_KEY':'aia_production_'+role,'MINIO_SECRET_KEY':pwd['s3'+role]})
    tools={**common,'DATABASE_URL':pg('aia_web','web'),'MIGRATION_DATABASE_URL':pg('aia_migrator','migrator'),'MIGRATION_TARGET_FILE':'/run/operator-secrets/target-production.json','MINIO_ACCESS_KEY':'aia_production_web','MINIO_SECRET_KEY':pwd['s3web']}
    envput(sec/'tools.env',tools)
    provision={**tools,'AIA_CLUSTER_DATABASE_URL':pg('aia_cluster_admin','cluster','postgres')}
    for role in ['migrator','web','worker','erasure','backup','ledger']:provision['AIA_PROD_'+role.upper()+'_PASSWORD']=pwd[role]
    for role in ['web','worker','backup']:provision['AIA_PROD_S3_'+role.upper()+'_PASSWORD']=pwd['s3'+role]
    envput(sec/'provision.env',provision)
    envput(sec/'admin.env',{**common,'DATABASE_URL':pg('aia_web','web'),'MINIO_ACCESS_KEY':'aia_production_web','MINIO_SECRET_KEY':pwd['s3web']})
    envput(sec/'privacy.env',{**common,'DATABASE_URL':pg('aia_worker','worker'),'PRIVACY_DATABASE_URL':pg('aia_erasure','erasure'),'MINIO_ACCESS_KEY':'aia_production_worker','MINIO_SECRET_KEY':pwd['s3worker']})
    envput(sec/'monitor.env',{**common,'DATABASE_URL':pg('aia_backup_reader','backup'),'MINIO_ACCESS_KEY':'aia_production_backup','MINIO_SECRET_KEY':pwd['s3backup'],'MONITOR_WEB_ORIGIN':'http://web:3100','MONITOR_WORKER_ORIGIN':'http://worker:3102','MONITOR_TLS_ORIGIN':'https://app.joinaia.pt','BACKUP_DESTINATION':'/backups','QUEUE_MAX_AGE_MINUTES':'15'})
    envput(sec/'backup.env',{**common,'DATABASE_URL':pg('aia_backup_reader','backup'),'BACKUP_DATABASE_URL':pg('aia_backup_reader','backup'),'AIA_BACKUP_LEDGER_URL':pg('aia_backup_ledger','ledger'),'MINIO_ACCESS_KEY':'aia_production_backup','MINIO_SECRET_KEY':pwd['s3backup'],'BACKUP_ENCRYPTION_KEY_FILE':'/run/secrets/archive_key','RECOVERY_CUSTODY_KEY_FILE':'/run/secrets/custody_key','BACKUP_RETENTION_HOURS':str(policy['backupRetentionHours']),'BACKUP_POLICY_REFERENCE':policy['backupPolicyReference'],'BACKUP_DESTINATION':'/backups','BACKUP_PRIVATE_WORK_DIRECTORY':'/tmp/backup-work'})
    put(sec/'meta/target-production.json',(KIT/'templates/target-production.json').read_text())
    put(sec/'meta/recovery-metadata.json',(KIT/'templates/recovery-metadata.json').read_text())
    put(sec/'proxy-auth.conf',f'set $aia_proxy_secret "{pwd["proxy"]}";\n')
    put(sec/'ingress-site.conf',(KIT/'templates/ingress-site.conf').read_text())
    envput(STATE/'compose.env',dict(AIA_WEB_IMAGE='REQUIRED_IMMUTABLE_LOCAL_IMAGE_ID',AIA_WORKER_IMAGE='REQUIRED_IMMUTABLE_LOCAL_IMAGE_ID',AIA_TOOLS_IMAGE='REQUIRED_IMMUTABLE_LOCAL_IMAGE_ID',AIA_MINIO_IMAGE=image,AIA_TLS_DIRECTORY=str(tls),AIA_SECRETS_DIRECTORY=str(sec),AIA_BACKUP_DIRECTORY=str(STATE/'backups')))
    put(STATE/'review.json',(KIT/'templates/review.json.example').read_text())
    put(STATE/'configured.json',{'project':PROJECT,'commit':COMMIT,'material':MATERIAL,'credentialsPrinted':False,'runtimeFlagsApproved':False,'smtpDisplayNameAndReplyToSupported':False})
    from release_source import export_reviewed
    put(STATE/'source-manifest.json',export_reviewed(STATE/'source'))
    put(STATE/'effective-policy.json',policy)
    print('NEW_PRODUCTION_CONFIGURATION_CREATED_NO_INFRASTRUCTURE_STARTED')
    print('FROZEN_PRODUCTION_SOURCE_READY: audited base plus the reviewed optional-cleanup startup fix.')
    print('SMTP_FROM: notificacoes@notify.joinaia.pt; auth-metadata erasure unconfigured unless explicitly supplied.')
    print('Operational backup defaults: 24-hour freshness, 168-hour archive metadata lifetime; no purge/timer enabled. Security review flags remain false.')
    print('NEXT: review flags remain false. Set them only after documented evidence. Install production AIStor licence privately. Escrow archive/custody/CA keys separately off-host.')
if __name__=='__main__':safe_main(main)
