#!/usr/bin/env python3
"""Read only the official digest of the running staging storage image. No env/licence reads."""
import sys
sys.dont_write_bytecode=True
import argparse,json,os,re,subprocess
from common import require,safe_main

def read(*args):
    env={k:os.environ[k] for k in ('PATH','HOME') if k in os.environ}
    result=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],env=env,
        capture_output=True,text=True,timeout=20)
    require(result.returncode==0,'STORAGE_IMAGE_METADATA_READ_FAILED')
    return result.stdout.strip()

def selected_image():
    ids=read('ps','-q','--no-trunc','--filter','label=com.docker.compose.project=aia-accreditation-staging',
             '--filter','label=com.docker.compose.service=minio').split()
    require(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0]),'ONE_RUNNING_STAGING_STORAGE_REQUIRED')
    value=read('inspect','--format','{{.Image}}',ids[0])
    require(re.fullmatch('sha256:[a-f0-9]{64}',value),'STORAGE_IMAGE_ID_INVALID')
    refs=json.loads(read('image','inspect','--format','{{json .RepoDigests}}',value))
    matches=sorted(set(x for x in refs if re.fullmatch('quay.io/minio/aistor/minio@sha256:[a-f0-9]{64}',x)))
    require(len(matches)==1,'ONE_OFFICIAL_AISTOR_DIGEST_REQUIRED')
    return matches[0]

def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    require(os.geteuid()==0,'RUN_READ_ONLY_DOCKER_STEP_WITH_SUDO_IN_PUTTY')
    print(selected_image())
if __name__=='__main__':safe_main(main)
