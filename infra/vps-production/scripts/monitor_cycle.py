#!/usr/bin/env python3
"""OPERATOR-INSTALLED ONLY: privacy-safe health, capacity, backup and certificate alerts."""
import datetime,json,os,subprocess,time
from common import KIT,STATE,PROJECT,approved,readenv,require,safe_main,operation_lock,locked_child_options
def cycle(fd):
    approved('monitor-cycle');alerts=[]
    if (STATE/'offsite/cycle-failure.json').exists():alerts.append('BACKUP_CYCLE_FAILED_OR_INCOMPLETE')
    r=subprocess.run(['python3',str(KIT/'scripts/production.py'),'monitor'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=1200,**locked_child_options(fd))
    if r.returncode:alerts.append('PRODUCTION_DEPENDENCY_OR_POLICY_ALERT')
    m={k:int(v.split()[0])//1024 for k,v in (line.split(':',1) for line in open('/proc/meminfo'))}
    if m['MemAvailable']<1536:alerts.append('HOST_MEMORY_HEADROOM_LOW')
    vm={k:int(v) for k,v in (line.split() for line in open('/proc/vmstat'))};position=STATE/'monitor-swap.json'
    if position.exists():
        previous=json.loads(position.read_text())
        if vm['pswpin']>previous['pswpin'] or vm['pswpout']>previous['pswpout']:alerts.append('HOST_SWAPPING')
    position.write_text(json.dumps({'pswpin':vm['pswpin'],'pswpout':vm['pswpout']}));position.chmod(0o600)
    disk=os.statvfs(STATE)
    if disk.f_bavail/disk.f_blocks<0.1 or disk.f_bavail*disk.f_frsize<30*1024**3:alerts.append('HOST_DISK_HEADROOM_LOW')
    for name in ['postgres','redis','ingress','minio']:
        r=subprocess.run(['openssl','x509','-checkend','1209600','-noout','-in',str(STATE/'tls'/(name+'.crt'))],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if r.returncode:alerts.append(name.upper()+'_PRIVATE_TLS_EXPIRING')
    r=subprocess.run(['openssl','x509','-checkend','1209600','-noout','-in','/etc/letsencrypt/live/app.joinaia.pt/fullchain.pem'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if r.returncode:alerts.append('PUBLIC_TLS_EXPIRING_OR_UNREADABLE')
    r=subprocess.run(['timedatectl','show','-p','NTPSynchronized','--value'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if r.returncode or r.stdout.strip()!='yes':alerts.append('HOST_TIME_NOT_SYNCHRONIZED')
    policy_file=STATE/'effective-policy.json'
    if not policy_file.exists():policy_file=KIT/'policy.json'
    uploads=list((STATE/'offsite').glob('upload-*.json'));limit=float(json.loads(policy_file.read_text())['backupMaxAgeHours'])*3600
    if not uploads or time.time()-max(p.stat().st_mtime for p in uploads)>limit:alerts.append('OFFSITE_BACKUP_MISSING_OR_OLD')
    # Acceptance must also induce and verify a real OOM/restart condition in an isolated rehearsal;
    # never inject destructive failures into production merely to test the monitor.
    args=['docker','--host','unix:///var/run/docker.sock','ps','-aq','--filter','label=com.docker.compose.project='+PROJECT]
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if p.returncode:alerts.append('CONTAINER_MONITOR_UNAVAILABLE')
    else:
        for container in p.stdout.split():
            p=subprocess.run(['docker','--host','unix:///var/run/docker.sock','inspect','--format','{{ index .Config.Labels "com.docker.compose.service" }}|{{.State.OOMKilled}}|{{.RestartCount}}',container],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            if p.returncode:alerts.append('CONTAINER_MONITOR_UNAVAILABLE');continue
            parts=p.stdout.strip().split('|')
            if len(parts)==3 and parts[0] in ['web','worker','postgres','redis','minio','ingress']:
                if parts[1]=='true':alerts.append(parts[0].upper()+'_OOM')
                if int(parts[2])>2:alerts.append(parts[0].upper()+'_REPEATED_RESTARTS')
    alerts=sorted(set(alerts));print(json.dumps({'project':PROJECT,'alerts':alerts}))
    if alerts:
        # No email is sent by this preparation session. Installing/enabling this monitor is externally visible.
        command=['docker','--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--env-file',str(STATE/'compose.env'),'-f',str(KIT/'compose.yaml'),'--profile','maintenance','run','--rm','--no-deps','-T','-e','AIA_MONITOR_ALERT_CODES='+','.join(alerts),'monitor','node','node_modules/tsx/dist/cli.mjs','/app/production-ops/monitor-alert.ts']
        capacity=subprocess.run(['python3',str(KIT/'scripts/resource_check.py'),'--phase','maintenance','--live'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
        require(capacity.returncode==0,'MONITOR_ALERT_JOB_CAPACITY_BLOCKED_NO_SECOND_CONTAINER_STARTED')
        p=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=1200)
        require(p.returncode==0,'OPERATOR_ALERT_DELIVERY_FAILED');raise RuntimeError('OPERATIONAL_ALERTS_DETECTED')
def main():
    approved('monitor-cycle')
    try:
        with operation_lock() as fd:cycle(fd)
    except RuntimeError as error:
        if str(error)!='ANOTHER_PRODUCTION_OPERATION_ACTIVE':raise
        print('MONITOR_DEFERRED_ACTIVE_OPERATOR_JOB: next scheduled check retries; Docker health checks continue.')
if __name__=='__main__':safe_main(main)
