#!/usr/bin/env python3
"""Push the prepared Accreditation commits, then independently verify remote master."""
import sys
sys.dont_write_bytecode = True
import json, os, re, stat, subprocess
from pathlib import Path

REPO = Path('/home/luke/aia-accreditation-publish')
KEY = Path('/home/luke/.ssh/aia_accreditation_deploy')
ORIGIN = 'git@github.com:LV1DOR/AIA-Acreditation.git'

def need(ok, code):
    if not ok: raise RuntimeError(code)

def git(*args):
    env = {k: v for k, v in os.environ.items() if not k.startswith(('GIT_', 'SSH_'))}
    env['GIT_SSH_COMMAND'] = ('ssh -F /dev/null -i ' + str(KEY) +
        ' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes')
    result = subprocess.run(['git', '-C', str(REPO), *args], env=env,
                            capture_output=True, text=True, timeout=180)
    if result.returncode:
        error = result.stderr.lower()
        if 'repository not found' in error: code = 'REPOSITORY_NOT_FOUND_OR_KEY_NOT_AUTHORISED'
        elif 'read only' in error or 'read-only' in error or 'denied to deploy key' in error:
            code = 'ACCREDITATION_DEPLOY_KEY_NEEDS_WRITE_ACCESS'
        elif 'non-fast-forward' in error or 'fetch first' in error: code = 'REMOTE_CHANGED_NO_FORCE_PUSH_PERFORMED'
        else: code = 'GITHUB_OPERATION_FAILED_NO_SUCCESS_CLAIMED'
        raise RuntimeError(code)
    return result.stdout.strip()

def remote_head():
    rows = git('ls-remote', 'origin', 'refs/heads/master').splitlines()
    need(len(rows) == 1, 'EXACT_REMOTE_MASTER_REQUIRED')
    fields = rows[0].split()
    need(len(fields) == 2 and re.fullmatch('[a-f0-9]{40}', fields[0]) and fields[1] == 'refs/heads/master',
         'VALID_REMOTE_MASTER_REQUIRED')
    return fields[0]

def main():
    need(os.geteuid() != 0, 'RUN_AS_LUKE_WITHOUT_SUDO')
    info = KEY.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_mode & 0o077 == 0, 'PRIVATE_ACCREDITATION_KEY_REQUIRED')
    need(git('remote', 'get-url', 'origin') == ORIGIN, 'EXACT_ACCREDITATION_REPOSITORY_REQUIRED')
    need(git('branch', '--show-current') == 'master', 'EXPECTED_MASTER_BRANCH_REQUIRED')
    need(not git('status', '--porcelain'), 'COMMIT_ALL_REVIEWED_CHANGES_BEFORE_PUSH')
    expected = git('rev-parse', 'HEAD')
    need(re.fullmatch('[a-f0-9]{40}', expected), 'VALID_LOCAL_COMMIT_REQUIRED')
    before = remote_head()
    if before != expected:
        git('push', '--porcelain', 'origin', 'HEAD:refs/heads/master')
    need(remote_head() == expected and git('rev-parse', 'HEAD') == expected, 'REMOTE_MASTER_VERIFICATION_FAILED')
    print('GITHUB_MASTER_VERIFIED=' + expected)
    print('NO_IMAGES_BUILT_LOADED_OR_DEPLOYED')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[A-Z0-9_]+', str(error)) else type(error).__name__
        print(json.dumps({'passed': False, 'code': code, 'pushVerified': False}))
        sys.exit(1)
