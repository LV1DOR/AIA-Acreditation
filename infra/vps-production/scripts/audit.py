#!/usr/bin/env python3
"""Read-only source/permissions audit. Does not open the index or environment files."""
import hashlib, json, os, subprocess
from pathlib import Path
from common import REPO, COMMIT, BASE_MATERIAL, require, safe_main

TOP=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.tests.json','vitest.config.ts','eslint.config.mjs','.dockerignore']
IGNORED={'node_modules','.git','.impeccable','deployment','dist','generated','test-results','playwright-report','__pycache__'}
def selected(name):
    p=Path(name)
    return (p.parts[0] in ['apps','packages','infra','scripts','tests'] or name in TOP) and not any(x in IGNORED or x.startswith(('.env','.next','.candidate-')) for x in p.parts) and not name.endswith(('.log','.tsbuildinfo'))
def materials(root=REPO):
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
    require(head==COMMIT,'REVIEWED_COMMIT_CHANGED')
    entries=[]; differences=[]; tracked=set()
    tree=subprocess.check_output(['git','ls-tree','-r','-z','HEAD'],cwd=REPO)
    for row in tree.split(b'\0'):
        if not row: continue
        meta,rawname=row.split(b'\t',1); mode,kind,oid=meta.decode().split(); name=rawname.decode()
        if not selected(name): continue
        tracked.add(name); p=root/name
        require(kind=='blob' and mode in ['100644','100755'] and not p.is_symlink(), 'BUILD_INPUT_SYMLINK_OR_SPECIAL_FILE')
        if not p.is_file(): differences.append(name);continue
        b=p.read_bytes()
        if hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()!=oid: differences.append(name)
        entries.append({'path':name,'sha256':hashlib.sha256(b).hexdigest()})
    unexpected=[]
    for directory in ['apps','packages','infra','scripts','tests']:
        for current,dirs,files in os.walk(root/directory,followlinks=False):
            dirs[:]=[d for d in dirs if selected(str((Path(current)/d).relative_to(root)))]
            for f in files:
                p=Path(current)/f; name=p.relative_to(root).as_posix()
                if selected(name) and name not in tracked: unexpected.append(name)
    require(not differences,'TRACKED_BUILD_MATERIAL_CHANGED')
    require(not unexpected,'UNTRACKED_BUILD_INPUT_REQUIRES_REVIEW')
    entries.sort(key=lambda e:e['path'])
    digest=hashlib.sha256(json.dumps(entries,separators=(',',':')).encode()).hexdigest()
    require(digest==BASE_MATERIAL,'SOURCE_MATERIAL_HASH_CHANGED')
    return {'commit':head,'sourceMaterialSha256':digest,'files':entries}
def main():
    m=materials()
    print(json.dumps({'status':'BUILD_INPUTS_MATCH_AUDIT','commit':m['commit'],'material':m['sourceMaterialSha256'],'count':len(m['files'])}))
    for p in [REPO,REPO/'.git',REPO/'.git/index']:
        s=p.stat();print(json.dumps({'path':str(p),'uid':s.st_uid,'gid':s.st_gid,'mode':oct(s.st_mode&0o7777),'readable':os.access(p,os.R_OK),'xattrNames':os.listxattr(p)}))
    print('INDEX_UNREADABLE' if not os.access(REPO/'.git/index',os.R_OK) else 'INDEX_READABLE')
if __name__=='__main__':safe_main(main)
