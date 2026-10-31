"""Prepare only the private production export scratch directory; no service actions."""
import copy,json,os,stat
import yaml

def need(ok,code):
    if not ok:raise RuntimeError(code)

def compose_with_spool(original,spool):
    before=yaml.safe_load(original);after=copy.deepcopy(before);web=after['services']['web']
    need(web.get('read_only')is True,'READ_ONLY_WEB_REQUIRED')
    mounts=web.get('tmpfs',[])
    need(isinstance(mounts,list) and sum(str(v).split(':',1)[0]=='/tmp'for v in mounts)==1,'EXACT_EXISTING_WEB_TMPFS_REQUIRED')
    remaining=[v for v in mounts if str(v).split(':',1)[0]!='/tmp']
    if remaining:web['tmpfs']=remaining
    else:web.pop('tmpfs')
    # /tmp already exists in the immutable image: no new mountpoint on a read-only root.
    volume={'type':'bind','source':str(spool),'target':'/tmp','read_only':False,'bind':{'create_host_path':False}}
    need(not any((isinstance(v,dict)and v.get('target')=='/tmp')or(isinstance(v,str)and v.split(':')[1:2]==['/tmp'])for v in web.get('volumes',[])),'EXPORT_MOUNT_ALREADY_CONFIGURED')
    web['volumes']=[*web.get('volumes',[]),volume]
    # Reject accidental YAML-anchor changes to any other service or resource.
    for name,s in before['services'].items():
        if name!='web':need(after['services'][name]==s,'UNRELATED_SERVICE_CHANGE_REFUSED')
    for name,v in before.items():
        if name!='services':need(after[name]==v,'UNRELATED_RESOURCE_CHANGE_REFUSED')
    return yaml.safe_dump(after,sort_keys=False).encode()

def prepare_spool(state):
    folder=state/'export-tmp';marker=state/'export-spool.json'
    need(not folder.is_symlink()and not marker.is_symlink(),'EXPORT_SPOOL_SYMLINK_REFUSED')
    expected={'project':'aia-accreditation-production','path':str(folder),'purpose':'private-temporary-id-all-zip','uid':1000,'gid':1000}
    if folder.exists():
        need(marker.is_file()and json.loads(marker.read_text())==expected,'UNREVIEWED_EXPORT_DIRECTORY_REFUSED')
        info=folder.stat();need(stat.S_ISDIR(info.st_mode)and stat.S_IMODE(info.st_mode)==0o700 and(info.st_uid,info.st_gid)==(1000,1000),'EXPORT_DIRECTORY_PERMISSIONS_CHANGED')
    else:
        need(not marker.exists(),'EXPORT_DIRECTORY_MARKER_ALREADY_EXISTS')
        folder.mkdir(mode=0o700);os.chown(folder,1000,1000)
        with marker.open('x')as f:os.fchmod(f.fileno(),0o600);json.dump(expected,f)
    return folder
