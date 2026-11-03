"""Kit-only helpers. This module has no side effects."""
from pathlib import Path
import contextlib, fcntl, json, os, re, subprocess

KIT = Path(__file__).resolve().parents[1]
STATE = KIT/'state'
REPO = Path('/opt/aia-accreditation')
PROJECT = 'aia-accreditation-production'
COMMIT = '4c3c3eaa62db13e3dde0008df99661e02f5fd8db'
BASE_MATERIAL = 'bc2797870f4e29bd4c7c8295f606a35e78354fb7316ff212db92df7f4e2538b4'
# Audited base plus the exact reviewed initial-launch patch; no upstream edit.
MATERIAL = 'ad0b3cf4a81b359d4cf6598c14b7c33506bfef3496a0be780b181324b1c7e8cc'
DB = 'aia_accreditation_production'

@contextlib.contextmanager
def operation_lock(state=None):
    """One end-to-end operator job; wrappers pass the same locked FD to children."""
    inherited=os.environ.get('AIA_OPERATOR_LOCK_FD')
    path=(STATE if state is None else state)/'operator.lock'
    if inherited is not None:
        require(inherited.isdecimal() and int(inherited)>2,'INVALID_INHERITED_OPERATOR_LOCK')
        fd=int(inherited);actual=os.fstat(fd);expected=path.stat()
        require((actual.st_dev,actual.st_ino)==(expected.st_dev,expected.st_ino) and not path.is_symlink(),'INHERITED_OPERATOR_LOCK_SCOPE_MISMATCH')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('ANOTHER_PRODUCTION_OPERATION_ACTIVE') from None
        # Do not unlock an inherited open-file description: the parent still owns it.
        yield fd
        return
    with path.open('a') as lock:
        os.fchmod(lock.fileno(),0o600)
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('ANOTHER_PRODUCTION_OPERATION_ACTIVE') from None
        yield lock.fileno()

def locked_child_options(fd):
    return dict(env={**os.environ,'AIA_OPERATOR_LOCK_FD':str(fd)},pass_fds=(fd,))

def require(ok, code):
    if not ok:
        raise RuntimeError(code)

def put(path, data, mode=0o600):
    require(not path.exists() and not path.is_symlink(), 'REFUSE_OVERWRITE')
    with path.open('x') as f:
        f.write(data if isinstance(data,str) else json.dumps(data,indent=2)+'\n')
    path.chmod(mode)

def envput(path, data):
    # Values use dotenv double quotes. Reject literal expansion characters in credentials.
    for k,v in data.items():
        require(re.fullmatch(r'[A-Z][A-Z0-9_]*',k) and isinstance(v,str), 'INVALID_ENV_SERIALIZATION')
        require(not any(x in v for x in ['\n','\r','\x00','"','\\','$','`']), 'UNSUPPORTED_ENV_CHARACTER')
    put(path,''.join(k+'="'+v+'"\n' for k,v in data.items()))

def readenv(path):
    # Only the kit's exact serialization is supported. Never source a file as shell code.
    result={}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'): continue
        k,v=line.split('=',1)
        require(re.fullmatch(r'[A-Z][A-Z0-9_]*',k) and k not in result, 'INVALID_ENV_FILE')
        result[k]=json.loads(v) if v.startswith('"') else v
    return result

def approved(action):
    r=json.loads((STATE/'review.json').read_text())
    require(r.get('sourceCommit')==COMMIT and r.get('sourceMaterialSha256')==MATERIAL, 'SOURCE_REVIEW_CHANGED')
    require(action in r.get('approvedActions',[]) and r.get('operator') and len(r.get('approvalReference',''))>=5, 'EXPLICIT_OPERATOR_APPROVAL_REQUIRED')
    return r

def safe_main(work):
    try: work()
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch('[A-Z0-9_]{4,100}',str(error)) else 'OPERATION_FAILED_INSPECT_PRIVATE_STATE'
        print('STOP: '+code)
        raise SystemExit(1)
