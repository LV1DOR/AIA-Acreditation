#!/usr/bin/env python3
"""Explicit read-only operator telemetry. Only ps/inspect Docker GET operations.
No environment/credential/license access, exec, stats stream, host or Docker writes.
"""
import argparse,datetime,json,os,re,subprocess,time
from pathlib import Path
from common import require,safe_main,PROJECT

STAGING='aia-accreditation-staging'
MIB=1024**2

def host_sample():
    raw={k:int(v.split()[0]) for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())}
    vm={k:int(v) for k,v in (line.split() for line in Path('/proc/vmstat').read_text().splitlines())}
    pressure={}
    for line in Path('/proc/pressure/memory').read_text().splitlines():
        name,*values=line.split();pressure[name]=float(dict(x.split('=') for x in values)['avg10'])
    return {'totalMiB':raw['MemTotal']//1024,'availableMiB':raw['MemAvailable']//1024,
            'swapUsedMiB':(raw['SwapTotal']-raw['SwapFree'])//1024,
            'swapInPages':vm['pswpin'],'swapOutPages':vm['pswpout'],'hostOomKills':vm['oom_kill'],
            'psiSomeAvg10':pressure.get('some',0.0),'psiFullAvg10':pressure.get('full',0.0)}

def docker_read(*args):
    require(args[0] in ['ps','inspect'],'READ_ONLY_DOCKER_OPERATION_REQUIRED')
    env={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ}
    result=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],env=env,
                          capture_output=True,text=True,timeout=20)
    require(result.returncode==0,'CAPACITY_DOCKER_READ_FAILED_NO_DIAGNOSTICS_EXPOSED')
    return result.stdout.strip()

# Select individual non-secret fields; never fetch Config.Env, mounts or logs.
FORMAT='|'.join(['{{.Id}}','{{index .Config.Labels "com.docker.compose.project"}}',
 '{{index .Config.Labels "com.docker.compose.service"}}','{{.State.Status}}',
 '{{.State.Pid}}','{{.State.OOMKilled}}','{{.RestartCount}}','{{.HostConfig.Memory}}'])

def inventory():
    rows=[]
    for project in [STAGING,PROJECT]:
        ids=docker_read('ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+project).split()
        require(all(re.fullmatch('[a-f0-9]{64}',x) for x in ids),'CAPACITY_CONTAINER_ID_INVALID')
        for cid in ids:
            parts=docker_read('inspect','--format',FORMAT,cid).split('|')
            require(len(parts)==8 and parts[0]==cid and parts[1]==project,'CAPACITY_CONTAINER_SCOPE_CHANGED')
            require(re.fullmatch('[a-z0-9_-]{1,80}',parts[2]),'CAPACITY_SERVICE_INVALID')
            require(parts[3] in ['running','paused','exited','created','dead'],'CAPACITY_CONTAINER_TRANSITION_RETRY')
            rows.append(dict(id=cid,project=project,service=parts[2],status=parts[3],pid=int(parts[4]),
                             oomKilled=parts[5]=='true',restarts=int(parts[6]),limitBytes=int(parts[7])))
    return sorted(rows,key=lambda x:x['id'])

def cgroup_sample(row,proc=Path('/proc'),root=Path('/sys/fs/cgroup')):
    require(row['status'] in ['running','paused'] and row['pid']>0 and row['limitBytes']>0,'CAPACITY_RUNNING_LIMIT_REQUIRED')
    lines=(proc/str(row['pid'])/'cgroup').read_text().splitlines()
    paths=[line[3:] for line in lines if line.startswith('0::')]
    require(len(paths)==1,'CAPACITY_CGROUP_V2_REQUIRED')
    folder=(root/paths[0].lstrip('/')).resolve()
    require(folder.is_relative_to(root.resolve()) and row['id'] in folder.name,'CAPACITY_CGROUP_SCOPE_UNVERIFIED')
    stat={k:int(v) for k,v in (x.split() for x in (folder/'memory.stat').read_text().splitlines())}
    events={k:int(v) for k,v in (x.split() for x in (folder/'memory.events').read_text().splitlines())}
    current=int((folder/'memory.current').read_text());limit=(folder/'memory.max').read_text().strip()
    require(limit!='max' and int(limit)==row['limitBytes'],'CAPACITY_DOCKER_CGROUP_LIMIT_MISMATCH')
    anon=stat['anon'];require(0<=anon<=current,'CAPACITY_ANONYMOUS_ACCOUNTING_INVALID')
    return dict(anonBytes=anon,currentBytes=current,
                workingSetBytes=max(0,current-stat.get('inactive_file',0)),
                fileBytes=stat.get('file',0),peakBytes=int((folder/'memory.peak').read_text()),
                cgroupOomKills=events.get('oom_kill',0))

def collect(samples=3,interval=1.0):
    require(2<=samples<=30 and 0.1<=interval<=5,'CAPACITY_SAMPLE_WINDOW_INVALID')
    start=time.monotonic();base=inventory();running=[x for x in base if x['status'] in ['running','paused']]
    readings={row['id']:[] for row in running};hosts=[]
    for index in range(samples):
        hosts.append(host_sample())
        for row in running:readings[row['id']].append(cgroup_sample(row))
        if index+1<samples:time.sleep(interval)
    require(inventory()==base,'CAPACITY_INVENTORY_CHANGED_RETRY')
    rows=[]
    for row in running:
        values=readings[row['id']]
        rows.append({k:row[k] for k in ['id','project','service','status','limitBytes','oomKilled','restarts']}|{
          # Only resident anonymous bytes are credited against MemAvailable.
          # Docker's cache-adjusted working set is reported, not used as credit.
          'anonCreditBytes':min(x['anonBytes'] for x in values),
          'currentBytesMax':max(x['currentBytes'] for x in values),
          'workingSetBytesMax':max(x['workingSetBytes'] for x in values),
          'fileBytesMax':max(x['fileBytes'] for x in values),'peakBytes':max(x['peakBytes'] for x in values),
          'oomKillDelta':values[-1]['cgroupOomKills']-values[0]['cgroupOomKills']})
    duration=time.monotonic()-start
    return dict(schema=1,collectedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
      bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),samples=samples,durationSeconds=duration,
      inventoryStable=True,projectsInspected=[STAGING,PROJECT],containers=rows,
      stoppedProduction=[{k:x[k] for k in ['id','service','limitBytes']} for x in base
        if x['project']==PROJECT and x['status'] not in ['running','paused']
        and x['service'] in ['web','worker','postgres','redis','minio','ingress']],
      stoppedContainerCounts={project:sum(x['project']==project and x['status'] not in ['running','paused'] for x in base) for project in [STAGING,PROJECT]},
      host=dict(totalMiB=min(x['totalMiB'] for x in hosts),minimumAvailableMiB=min(x['availableMiB'] for x in hosts),
       swapUsedMiB=max(x['swapUsedMiB'] for x in hosts),
       swapInMiBPerSecond=max(0,hosts[-1]['swapInPages']-hosts[0]['swapInPages'])*os.sysconf('SC_PAGE_SIZE')/MIB/duration,
       swapOutMiBPerSecond=max(0,hosts[-1]['swapOutPages']-hosts[0]['swapOutPages'])*os.sysconf('SC_PAGE_SIZE')/MIB/duration,
       hostOomKillDelta=hosts[-1]['hostOomKills']-hosts[0]['hostOomKills'],
       psiSomeAvg10Max=max(x['psiSomeAvg10'] for x in hosts),psiFullAvg10Max=max(x['psiFullAvg10'] for x in hosts)))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--samples',type=int,default=3)
    parser.add_argument('--interval',type=float,default=1);args=parser.parse_args()
    print(json.dumps(collect(args.samples,args.interval),indent=2))
if __name__=='__main__':safe_main(main)
