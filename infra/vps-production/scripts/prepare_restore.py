#!/usr/bin/env python3
"""OPERATOR ONLY. Prepare fresh restore configuration; never starts containers."""
import argparse,getpass,json,os,re,secrets,shutil,subprocess
from common import KIT,put,envput,require,safe_main
def main():
    p=argparse.ArgumentParser();p.add_argument('--approve-isolated-restore-configuration',action='store_true');a=p.parse_args();require(a.approve_isolated_restore_configuration,'RESTORE_CONFIGURATION_APPROVAL_REQUIRED')
    os.umask(0o077);state=KIT/'restore-state';require(not state.exists(),'RESTORE_STATE_EXISTS_INSPECT_DO_NOT_RESET')
    tools=input('Matching immutable tools image ID sha256: (non-secret): ').strip();image=input('Reviewed restore AIStor image@sha256: (non-secret): ').strip()
    require(re.fullmatch('sha256:[a-f0-9]{64}',tools) and re.fullmatch('quay.io/minio/aistor/minio@sha256:[a-f0-9]{64}',image),'PINNED_RESTORE_IMAGES_REQUIRED')
    identifier=input('Exact approved backup UUID (non-secret): ').strip();require(re.fullmatch('[a-f0-9-]{36}',identifier),'EXACT_BACKUP_ID_REQUIRED')
    state.mkdir(mode=0o700)
    for d in ['input','secrets','tls','tls/minio','tls/minio/CAs','work','evidence']:(state/d).mkdir(mode=0o700)
    tls=state/'tls';cluster,migrator,minio=[secrets.token_hex(32) for _ in range(3)]
    put(state/'secrets/postgres-password',cluster);put(state/'secrets/minio-user','aia_restore_root');put(state/'secrets/minio-password',minio)
    def ssl(*args):subprocess.run(['openssl',*args],cwd=tls,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    ssl('req','-x509','-newkey','rsa:3072','-nodes','-days','30','-subj','/CN=AIA Isolated Restore CA','-keyout','ca.key','-out','ca.crt')
    for name in ['restore-postgres','restore-minio']:
        put(tls/(name+'.ext'),'subjectAltName=DNS:'+name+'\nextendedKeyUsage=serverAuth\n')
        ssl('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+name,'-keyout',name+'.key','-out',name+'.csr')
        ssl('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','14','-extfile',name+'.ext','-out',name+'.crt')
    for src,dest in [('restore-minio.crt','minio/public.crt'),('restore-minio.key','minio/private.key'),('ca.crt','minio/CAs/ca.crt')]:shutil.copyfile(tls/src,tls/dest)
    for file in tls.rglob('*'):
        if file.is_file():file.chmod(0o600 if file.suffix=='.key' else 0o444)
    pg=lambda user,password,db:f'postgresql://{user}:{password}@restore-postgres:5432/{db}?sslmode=verify-full&sslrootcert=/run/secrets/ca_cert'
    envput(state/'secrets/restore.env',dict(NODE_ENV='production',DEPLOYMENT_ENV='local',AIA_RESTORE_CONFIRM='ISOLATED_PRODUCTION_BACKUP_RESTORE',AIA_RESTORE_BACKUP_ID=identifier,AIA_RESTORE_CLUSTER_URL=pg('aia_restore_cluster',cluster,'postgres'),AIA_RESTORE_DATABASE_URL=pg('aia_migrator',migrator,'aia_accreditation_production_restore'),AIA_RESTORE_STORAGE_ENDPOINT='https://restore-minio:9000',AIA_RESTORE_MINIO_USER='aia_restore_root',AIA_RESTORE_MINIO_PASSWORD=minio))
    envput(state/'compose.env',dict(AIA_RESTORE_STATE=str(state),AIA_RESTORE_TOOLS_IMAGE=tools,AIA_RESTORE_MINIO_IMAGE=image))
    print('RESTORE_CONFIGURATION_CREATED_NO_CONTAINERS_STARTED')
    print('Operator must securely install a separately authorised restore licence, archive.key, custody.key and the three encrypted backup artifacts. No production runtime credentials are needed.')
if __name__=='__main__':safe_main(main)
