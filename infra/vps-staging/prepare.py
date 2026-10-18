#!/usr/bin/env python3
"""Prepare synthetic VPS staging locally; never invokes Docker or host services."""
import json, os, secrets, shutil, socket, subprocess, argparse
from pathlib import Path

REPO = Path('/opt/aia-accreditation')
KIT = Path(__file__).resolve().parent
STATE = Path('/home/luke/.local/share/aia-accreditation-staging')
PROJECT = 'aia-accreditation-staging'
DB = 'aia_accreditation_staging'
COMMIT = '4c3c3eaa62db13e3dde0008df99661e02f5fd8db'

def require(ok, code):
    if not ok:
        raise RuntimeError(code)

def readenv(path):
    # Only reads this kit's JSON-quoted dotenv serialization.
    return {k: json.loads(v) for line in path.read_text().splitlines() if line and not line.startswith('#') for k, v in [line.split('=', 1)]}

def put(path, value):
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2)+'\n')
    path.chmod(0o600)

def envput(path, values):
    put(path, ''.join(f'{k}={json.dumps(v)}\n' for k, v in values.items()))

def check_repo():
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip() == COMMIT, 'REVIEWED_COMMIT_CHANGED')
    require(not subprocess.check_output(['git', 'status', '--porcelain=v1'], cwd=REPO, text=True).strip(), 'REPOSITORY_MUST_BE_CLEAN')

def ports():
    for port in (18880, 18443, 18025):
        with socket.socket() as s:
            s.bind(('127.0.0.1', port))

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--defer-port-check', action='store_true', help='Prepare offline when sandbox denies sockets. PuTTY host check remains mandatory.')
    args=parser.parse_args()
    check_repo()
    if not args.defer_port_check:
        ports()
    require(not STATE.exists(), 'STATE_ALREADY_EXISTS_DO_NOT_REGENERATE_SECRETS')
    STATE.mkdir(parents=True, mode=0o700)
    for d in ('secrets', 'tls', 'tls/minio', 'tls/minio/CAs', 'backups', 'logs', 'storage-admin'):
        (STATE/d).mkdir(mode=0o700)
    sec, tls = STATE/'secrets', STATE/'tls'
    pwd = {k: secrets.token_hex(32) for k in ('cluster','migrator','web','worker','erasure','redis','minio','s3web','s3worker','document','fingerprint','mail','proxy')}
    for name, key in [('postgres-password','cluster'), ('redis-password','redis'), ('minio-root-password','minio')]:
        put(sec/name, pwd[key])
    put(sec/'minio-root-user', 'aia_staging_root')
    put(sec/'redis.acl', f'user default off\nuser aia on >{pwd["redis"]} ~aia:* &aia:* +@connection +@read +@write +@scripting +@pubsub +@transaction -@admin -@dangerous +eval +evalsha\n')
    def ssl(*args):
        subprocess.run(['openssl', *args], cwd=tls, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ssl('req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','90','-subj','/CN=AIA Accreditation PRIVATE SYNTHETIC STAGING','-keyout','ca.key','-out','ca.crt')
    for name in ('postgres','redis','ingress','minio','mailpit'):
        put(tls/(name+'.ext'), f'subjectAltName=DNS:{name},DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n')
        ssl('req','-new','-newkey','rsa:2048','-nodes','-subj',f'/CN={name}','-keyout',name+'.key','-out',name+'.csr')
        ssl('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','30','-sha256','-extfile',name+'.ext','-out',name+'.crt')
    for src, dest in [('minio.crt','minio/public.crt'),('minio.key','minio/private.key'),('ca.crt','minio/CAs/ca.crt')]:
        shutil.copyfile(tls/src, tls/dest)
    pg = lambda user, password, db: f'postgresql://{user}:{password}@postgres:5432/{db}?sslmode=verify-full&sslrootcert=/run/secrets/ca_cert'
    common = dict(NODE_ENV='production', DEPLOYMENT_ENV='staging', AIA_SYNTHETIC_DATA='true', AIA_STAGE_PROJECT=PROJECT,
        APP_ORIGIN='https://localhost:18443', AUTH_ADDITIONAL_ORIGINS='', REDIS_URL=f'rediss://aia:{pwd["redis"]}@redis:6379',
        MINIO_ENDPOINT='https://minio:9000', MINIO_PHOTOS_BUCKET='aia-accreditation-staging-photos', MINIO_REGION='us-east-1',
        DOCUMENT_ENCRYPTION_KEY=pwd['document'], DOCUMENT_FINGERPRINT_KEY=pwd['fingerprint'], AUTH_EMAIL_ENCRYPTION_KEY=pwd['mail'],
        EMAIL_PROVIDER='smtp', SMTP_HOST='mailpit', SMTP_PORT='1025', SMTP_SECURE='false', SMTP_REQUIRE_TLS='true', SMTP_FROM='synthetic@example.invalid',
        AIA_PROXY_SECRET=pwd['proxy'], WORKER_HEALTH_HOST='0.0.0.0', WORKER_HEALTH_PORT='3102', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='', CLERK_SECRET_KEY='', CLERK_WEBHOOK_SIGNING_SECRET='')
    for role in ('web','worker'):
        envput(sec/(role+'.env'), {**common, 'DATABASE_URL':pg('aia_'+role,pwd[role],DB), 'MINIO_ACCESS_KEY':'aia_staging_'+role, 'MINIO_SECRET_KEY':pwd['s3'+role]})
    # Privacy execution is deliberately absent from the continuously running worker.
    tools = {**common, 'DATABASE_URL':pg('aia_migrator',pwd['migrator'],DB), 'MIGRATION_DATABASE_URL':pg('aia_migrator',pwd['migrator'],DB),
        'MIGRATION_TARGET_FILE':'/run/operator-secrets/target-stage.json', 'AIA_CLUSTER_DATABASE_URL':pg('aia_cluster_admin',pwd['cluster'],'postgres'),
        'MINIO_ACCESS_KEY':'aia_staging_root', 'MINIO_SECRET_KEY':pwd['minio']}
    for key in ('migrator','web','worker','erasure'):
        tools['AIA_STAGE_'+key.upper()+'_PASSWORD'] = pwd[key]
    for key in ('web','worker'):
        tools['AIA_STAGE_S3_'+key.upper()+'_PASSWORD'] = pwd['s3'+key]
    envput(sec/'tools.env', tools)
    # Required mount in the existing staging override; no test DB or test runner is enabled.
    put(sec/'test.env', '# Intentionally unused. Never run phase4a test/restore helpers against VPS staging.\n')
    put(sec/'target-stage.json', dict(environment='staging', host='postgres',port=5432,database=DB))
    put(sec/'proxy-auth.conf', f'set $aia_proxy_secret "{pwd["proxy"]}";\n')
    ingress = (REPO/'infra/production/ingress-site.example.conf').read_text().replace('accreditation.example.invalid','localhost:18443').replace('server_name localhost:18443;', 'server_name localhost;')
    # Do not persist HSTS for all localhost apps during a temporary staging exercise.
    ingress = ingress.replace('    add_header Strict-Transport-Security "max-age=31536000" always;\n','')
    put(sec/'ingress-site.conf', ingress)
    envput(STATE/'compose.env', dict(AIA_PROJECT_NAME=PROJECT, AIA_WEB_IMAGE='', AIA_WORKER_IMAGE='', AIA_TOOLS_IMAGE='', AIA_MINIO_IMAGE='',
        AIA_TLS_DIRECTORY=str(tls), AIA_SECRETS_DIRECTORY=str(sec), AIA_BACKUP_DIRECTORY=str(STATE/'backups'), AIA_HTTP_BIND_PORT='18880', AIA_HTTPS_BIND_PORT='18443'))
    put(STATE/'prepared.json', dict(project=PROJECT, database=DB, commit=COMMIT, synthetic=True, credentialsPrinted=False))
    print('PREPARED: private secrets/TLS generated. '+('Port check deferred to PuTTY. ' if args.defer_port_check else 'Ports available now. ')+'Clerk keys and supported MinIO image remain required.')

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('STOP: '+(str(e) if isinstance(e, RuntimeError) else type(e).__name__))
        raise SystemExit(1)
