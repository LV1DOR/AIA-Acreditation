#!/usr/bin/env python3
"""Freeze audited source plus the one reviewed launch fix; no secrets or Docker.
Produces a transferable Linux-builder bundle before production secrets exist.
"""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,shutil,tarfile
from pathlib import Path
from common import KIT,REPO,COMMIT,MATERIAL,BASE_MATERIAL,require,put,safe_main
from audit import materials

def export_reviewed(destination):
    base=materials()
    require(base['sourceMaterialSha256']==BASE_MATERIAL,'BASE_AUDIT_CHANGED')
    destination=Path(destination)
    require(destination.is_dir() and not any(destination.iterdir()),'SOURCE_EXPORT_MUST_BE_EMPTY')
    release=KIT/'release/initial-launch'
    review=json.loads((release/'release.json').read_text())
    require(review['baseCommit']==COMMIT and review['baseMaterial']==BASE_MATERIAL and review['material']==MATERIAL,'LAUNCH_PATCH_REVIEW_CHANGED')
    require(len(review['changes'])==1 and review['changes'][0]['path']=='packages/config/src/deployment-env.ts','EXACT_REVIEWED_LAUNCH_PATCH_REQUIRED')
    changes={x['path']:x for x in review['changes']};entries=[]
    for entry in base['files']:
        data=(REPO/entry['path']).read_bytes()
        require(hashlib.sha256(data).hexdigest()==entry['sha256'],'BASE_CHANGED_DURING_EXPORT')
        if entry['path'] in changes:
            change=changes[entry['path']]
            require(change['before']==entry['sha256'],'PATCH_BASE_MISMATCH')
            data=(release/'overlay'/entry['path']).read_bytes()
            require(hashlib.sha256(data).hexdigest()==change['after'],'PATCH_CONTENT_CHANGED')
        target=destination/entry['path'];target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with target.open('xb') as out:os.fchmod(out.fileno(),0o600);out.write(data)
        entries.append({'path':entry['path'],'sha256':hashlib.sha256(data).hexdigest()})
    digest=hashlib.sha256(json.dumps(entries,separators=(',',':')).encode()).hexdigest()
    require(digest==MATERIAL,'PATCHED_RELEASE_MATERIAL_MISMATCH')
    return dict(commit=COMMIT,sourceMaterialSha256=digest,baseSourceMaterialSha256=BASE_MATERIAL,
                reviewedChanges=review['changes'],files=entries)

def main():
    import argparse
    argparse.ArgumentParser(description=__doc__).parse_args()
    os.umask(0o077)
    # Freeze/export is a reversible local preparation action, not a build/start.
    result=__import__('subprocess').run(['git','-C',str(REPO),'status','--porcelain=v1'],
        env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'},capture_output=True,text=True)
    require(result.returncode==0 and not result.stdout,'CLEAN_REPOSITORY_REQUIRED')
    bundle=KIT/'build-input'
    require(not bundle.exists(),'BUILD_INPUT_EXISTS_PRESERVE_AND_REVIEW')
    bundle.mkdir(mode=0o700);(bundle/'source').mkdir(mode=0o700)
    manifest=export_reviewed(bundle/'source')
    put(bundle/'source-manifest.json',manifest)
    (bundle/'scripts').mkdir(mode=0o700)
    for name in ['common.py','audit.py','production.py','build_on_builder.py','release_source.py']:
        shutil.copyfile(KIT/'scripts'/name,bundle/'scripts'/name)
    archive=KIT/'production-build-input.tar.gz'
    require(not archive.exists(),'BUILD_ARCHIVE_EXISTS_PRESERVE_AND_REVIEW')
    with tarfile.open(archive,'x:gz') as out:out.add(bundle,arcname='build-input')
    archive.chmod(0o600)
    print('PRODUCTION_BUILD_INPUT_PREPARED: '+str(archive))
    print('RELEASE_MATERIAL: '+MATERIAL)
    print('Source plus builder helpers only; no configuration, keys, licences or images included.')

if __name__=='__main__':safe_main(main)
