#!/usr/bin/env python3
"""Read-only incremental peak admission. --live adds explicit Docker/cgroup reads only.
Default host-only report is diagnostic and cannot admit an unmeasured deployment.
"""
import argparse,datetime,json,math,re,shutil
from pathlib import Path
import yaml
from common import KIT,PROJECT,safe_main,require
from capacity_snapshot import STAGING,MIB,host_sample

HEADROOM_MIB=1536  # Additional available RAM after the modelled peak, not current OS RSS.
MAINTENANCE_MIB=768
BUILD_MIB=3072
STAGING_FALLBACK_MIB=3712
STEADY=('web','worker','postgres','redis','minio','ingress')
WRITERS={'web','worker','ingress'}
PHASES=('steady','maintenance','backup','offsite','build')

def limit_mib(value):
    match=re.fullmatch(r'(\d+)([kmg]?)',str(value).lower());require(match is not None,'MEMORY_CAP_FORMAT_INVALID')
    number=int(match[1])*{'':1,'k':1024,'m':MIB,'g':1024*MIB}[match[2]]
    require(number>0,'POSITIVE_MEMORY_CAP_REQUIRED');return (number+MIB-1)//MIB

def planned_limits():
    services=yaml.safe_load((KIT/'compose.yaml').read_text())['services']
    caps={name:limit_mib(services[name]['mem_limit']) for name in STEADY}
    jobs=[limit_mib(services[name]['mem_limit']) for name in ['tools','provision','backup','monitor','admin','privacy']]
    return caps,max(jobs)

def validate_snapshot(data,total,now=None):
    now=now or datetime.datetime.now(datetime.timezone.utc)
    require(data.get('schema')==1 and data.get('inventoryStable') is True and data.get('samples',0)>=2,'CAPACITY_SNAPSHOT_INVALID')
    require(set(data.get('projectsInspected',[]))=={STAGING,PROJECT},'CAPACITY_SNAPSHOT_SCOPE_INVALID')
    at=datetime.datetime.fromisoformat(data['collectedAt']);age=(now-at).total_seconds()
    require(0<=age<=60,'CAPACITY_SNAPSHOT_STALE_RECOLLECT')
    require(data.get('bootId')==Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'CAPACITY_SNAPSHOT_HOST_MISMATCH')
    require(data['host']['totalMiB']==total,'CAPACITY_SNAPSHOT_MEMORY_MISMATCH')
    require(isinstance(data.get('stoppedProduction'),list),'CAPACITY_STOPPED_INVENTORY_REQUIRED')
    host=data['host']
    require(type(host['minimumAvailableMiB']) is int and 0<=host['minimumAvailableMiB']<=total,'CAPACITY_SNAPSHOT_AVAILABLE_INVALID')
    for key in ['swapInMiBPerSecond','swapOutMiBPerSecond','psiSomeAvg10Max','psiFullAvg10Max']:
        require(type(host[key]) in [int,float] and math.isfinite(host[key]) and host[key]>=0,'CAPACITY_SNAPSHOT_PRESSURE_INVALID')
    require(type(host['hostOomKillDelta']) is int and host['hostOomKillDelta']>=0,'CAPACITY_SNAPSHOT_OOM_INVALID')
    seen=set()
    for row in data['containers']:
        require(row['project'] in {STAGING,PROJECT} and re.fullmatch('[a-f0-9]{64}',row['id']) and row['id'] not in seen,'CAPACITY_SNAPSHOT_CONTAINER_INVALID')
        seen.add(row['id']);require(row['status'] in ['running','paused'],'CAPACITY_SNAPSHOT_STATE_INVALID')
        require(re.fullmatch('[a-z0-9_-]{1,80}',row['service']) and type(row['oomKilled']) is bool,'CAPACITY_SNAPSHOT_SERVICE_INVALID')
        require(type(row['limitBytes']) is int and row['limitBytes']>0 and type(row['anonCreditBytes']) is int and 0<=row['anonCreditBytes']<=row['limitBytes'],'CAPACITY_SNAPSHOT_CREDIT_INVALID')
        require(row['anonCreditBytes']<=row['currentBytesMax'],'CAPACITY_SNAPSHOT_ACCOUNTING_INVALID')
    stopped_services=set()
    for row in data['stoppedProduction']:
        require(re.fullmatch('[a-f0-9]{64}',row['id']) and row['id'] not in seen and row['service'] in STEADY and row['service'] not in stopped_services,'CAPACITY_STOPPED_INVENTORY_INVALID')
        seen.add(row['id']);stopped_services.add(row['service'])
        require(type(row['limitBytes']) is int and row['limitBytes']>0,'CAPACITY_STOPPED_LIMIT_REQUIRED')

def assess(mem,phase,caps,job_mib,disk_gib,snapshot=None):
    require(phase in PHASES,'UNKNOWN_MEMORY_PHASE')
    reasons=[];rows=snapshot['containers'] if snapshot else []
    prod=[r for r in rows if r['project']==PROJECT];staging=[r for r in rows if r['project']==STAGING]
    available=min(mem['availableMiB'],snapshot['host']['minimumAvailableMiB']) if snapshot else mem['availableMiB']
    effective_caps=dict(caps)
    # Compose start resumes existing stopped containers without changing their
    # actual caps, so a higher observed cap must also be reserved for resumption.
    for row in (snapshot or {}).get('stoppedProduction',[]):
        effective_caps[row['service']]=max(effective_caps[row['service']],(row['limitBytes']+MIB-1)//MIB)
    targets=dict(effective_caps)
    if phase=='backup':targets={k:v for k,v in effective_caps.items() if k not in WRITERS}
    if phase=='build':targets={}
    # Existing runtime processes are accounted once: target cap minus resident
    # anonymous credit already charged to host MemAvailable. Cache is never credited.
    production_remaining=0;matched=set();seen_services=set();existing_jobs=[]
    for row in prod:
        service=row['service'];require(service not in seen_services,'DUPLICATE_PRODUCTION_SERVICE_REVIEW_REQUIRED');seen_services.add(service)
        actual=(row['limitBytes']+MIB-1)//MIB;credit=row['anonCreditBytes']//MIB
        production_remaining+=max(actual,targets.get(service,0))-credit
        matched.add(service)
        if service not in caps:existing_jobs.append(service)
    production_remaining+=sum(v for k,v in targets.items() if k not in matched)
    staging_remaining=sum((r['limitBytes']+MIB-1)//MIB-r['anonCreditBytes']//MIB for r in staging) if snapshot else STAGING_FALLBACK_MIB
    extra=0
    if phase in ['maintenance','backup','offsite']:extra=job_mib
    # Offsite restic runs after the container lock is released; until explicitly
    # serialised, reserve both restic and one concurrent production operator job.
    if phase=='offsite' and not existing_jobs:extra+=job_mib
    if phase=='build':extra=BUILD_MIB
    if phase=='backup' and any(r['service'] in WRITERS for r in prod):reasons.append('BACKUP_WRITERS_NOT_QUIESCED_NO_RELEASE_CREDIT')
    if phase=='build' and prod:reasons.append('ON_HOST_BUILD_WITH_PRODUCTION_FORBIDDEN')
    if phase in ['maintenance','backup'] and existing_jobs:reasons.append('ANOTHER_PRODUCTION_JOB_ACTIVE')
    phase_required=production_remaining+staging_remaining+HEADROOM_MIB+extra
    # Backup and restored writers do not overlap. Still prove that writers can
    # resume after the backup job exits, rather than admitting only its lower peak.
    resume_required=(production_remaining+sum(effective_caps[k] for k in WRITERS)+staging_remaining+HEADROOM_MIB) if phase=='backup' else None
    required=max(phase_required,resume_required or 0)
    if not snapshot:reasons.append('FRESH_CAPACITY_SNAPSHOT_REQUIRED')
    if available<required:reasons.append('INSUFFICIENT_PEAK_MEMORY_HEADROOM')
    if disk_gib<30:reasons.append('INSUFFICIENT_DISK_HEADROOM')
    if snapshot:
        host=snapshot['host']
        if max(host['swapInMiBPerSecond'],host['swapOutMiBPerSecond'])>=1:reasons.append('SUSTAINED_HOST_SWAPPING')
        if host['psiSomeAvg10Max']>=1 or host['psiFullAvg10Max']>=0.1:reasons.append('HOST_MEMORY_PRESSURE')
        if host['hostOomKillDelta'] or any(r['oomKillDelta'] or r['oomKilled'] for r in rows):reasons.append('OOM_EVIDENCE_REVIEW_REQUIRED')
    return dict(phase=phase,hostTotalMiB=mem['totalMiB'],availableMiB=available,
      productionConfiguredLimitsMiB=sum(caps.values()),productionRemainingPeakMiB=production_remaining,
      stagingRemainingPeakMiB=staging_remaining,stagingAnonCreditMiB=sum(r['anonCreditBytes']//MIB for r in staging),
      productionAnonCreditMiB=sum(r['anonCreditBytes']//MIB for r in prod),additionalJobOrBuildMiB=extra,
      hostHeadroomMiB=HEADROOM_MIB,requiredAvailableMiB=required,deficitMiB=max(0,required-available),
      phaseWorkRequiredAvailableMiB=phase_required,resumeRequiredAvailableMiB=resume_required,
      rootFreeGiB=disk_gib,swapUsedMiB=mem['swapUsedMiB'],freshInventoryUsed=bool(snapshot),
      inventoryBasis='fresh-scoped-cgroup-v2' if snapshot else 'unmeasured-worst-case-diagnostic-only',
      observedContainers=[dict(project=r['project'],service=r['service'],limitMiB=(r['limitBytes']+MIB-1)//MIB,
        anonCreditMiB=r['anonCreditBytes']//MIB,workingSetMiB=r['workingSetBytesMax']//MIB,
        recordedPeakMiB=(r['peakBytes']+MIB-1)//MIB) for r in rows],
      passed=not reasons,stopReasons=reasons,
      limitations=['Capacity arithmetic is not workload acceptance or deployment approval.',
       'Offsite host-process allowance requires measured/enforced bounds; it is not a container cap.',
       'Unknown external host growth and actual upload/backup peaks require operator load evidence.'])

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--phase',choices=PHASES,default='steady')
    source=parser.add_mutually_exclusive_group();source.add_argument('--snapshot',type=Path);source.add_argument('--live',action='store_true')
    parser.add_argument('--samples',type=int,default=3);parser.add_argument('--interval',type=float,default=1)
    args=parser.parse_args();data=None
    if args.live:
        from capacity_snapshot import collect
        data=collect(args.samples,args.interval)
    elif args.snapshot:data=json.loads(args.snapshot.read_text())
    mem=host_sample()
    if data:validate_snapshot(data,mem['totalMiB'])
    caps,job=planned_limits();report=assess(mem,args.phase,caps,job,shutil.disk_usage('/').free//1024**3,data)
    print(json.dumps(report,indent=2))
    require(report['passed'],report['stopReasons'][0] if report['stopReasons'] else 'CAPACITY_PREFLIGHT_FAILED')
    print('CAPACITY_PREFLIGHT_PASSED_LOAD_TEST_STILL_REQUIRED')
if __name__=='__main__':safe_main(main)
