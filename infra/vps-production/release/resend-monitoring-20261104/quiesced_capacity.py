"""Migration-only non-overlap admission. Original live checker and caps are unchanged."""
import json,re,shutil,time
import resource_check as base
from capacity_snapshot import collect,host_sample,MIB
from common import PROJECT,require
FROZEN={'web','worker'}

def assess(mem,caps,job,disk,data,expected_ids):
    require(set(expected_ids)==FROZEN,'EXACT_TWO_FROZEN_WRITERS_REQUIRED')
    running={r['service']for r in data['containers']if r['project']==PROJECT}
    require(not running.intersection(FROZEN),'MIGRATION_WRITERS_MUST_BE_STOPPED')
    stopped={r['service']:r for r in data['stoppedProduction']}
    require(all(s in stopped and stopped[s]['id']==expected_ids[s]for s in FROZEN),'FROZEN_WRITER_IDENTITIES_CHANGED')
    # Reuse every pressure/OOM/disk/staging/job/cap/anonymous-credit rule.
    report=base.assess(mem,'maintenance',caps,job,disk,data)
    frozen_caps=sum(max(caps[s],(stopped[s]['limitBytes']+MIB-1)//MIB)for s in FROZEN)
    work=report['phaseWorkRequiredAvailableMiB']-frozen_caps
    resume=report['phaseWorkRequiredAvailableMiB']-job
    required=max(work,resume)
    reasons=[x for x in report['stopReasons']if x!='INSUFFICIENT_PEAK_MEMORY_HEADROOM']
    if report['availableMiB']<required:reasons.append('INSUFFICIENT_PEAK_MEMORY_HEADROOM')
    report.update(phase='quiesced-migration',phaseWorkRequiredAvailableMiB=work,resumeRequiredAvailableMiB=resume,
                  requiredAvailableMiB=required,deficitMiB=max(0,required-report['availableMiB']),
                  frozenWriterLimitsMiB=frozen_caps,passed=not reasons,stopReasons=reasons)
    return report

def admit(expected_ids):
    for attempt in range(3):
        data=collect(3,1);mem=host_sample();base.validate_snapshot(data,mem['totalMiB'])
        caps,job=base.planned_limits()
        report=assess(mem,caps,job,shutil.disk_usage('/').free//1024**3,data,expected_ids)
        print(json.dumps({k:report[k]for k in ['phase','availableMiB','requiredAvailableMiB','phaseWorkRequiredAvailableMiB','resumeRequiredAvailableMiB','hostHeadroomMiB','additionalJobOrBuildMiB','frozenWriterLimitsMiB','stopReasons','passed']}),flush=True)
        if report['passed']:return job
        if report['stopReasons']==['HOST_MEMORY_PRESSURE']and attempt<2:time.sleep(15);continue
        raise RuntimeError(report['stopReasons'][0])

def memory_bytes(value):
    require(type(value) in (int,str),'MEMORY_CAP_ENCODING_INVALID')
    match=re.fullmatch(r'([0-9]+)([bkmg]?(?:i?b)?)',str(value).strip().lower())
    require(match is not None,'MEMORY_CAP_ENCODING_INVALID')
    unit=match[2]
    multipliers={'':1,'b':1,'k':1024,'kb':1024,'kib':1024,'m':1024**2,'mb':1024**2,'mib':1024**2,'g':1024**3,'gb':1024**3,'gib':1024**3}
    require(unit in multipliers,'MEMORY_CAP_ENCODING_INVALID')
    return int(match[1])*multipliers[unit]

def verify_tools_cap(config):
    memory=memory_bytes(config.get('mem_limit'));swap=memory_bytes(config.get('memswap_limit'))
    require(memory==768*MIB and swap==768*MIB,'MIGRATION_TOOLS_CAP_MUST_REMAIN_768_MIB')
    return {'passed':True,'toolsMemoryMiB':memory//MIB,'toolsMemoryAndSwapMiB':swap//MIB,
            'memoryEncoding':type(config['mem_limit']).__name__,'swapEncoding':type(config['memswap_limit']).__name__}
