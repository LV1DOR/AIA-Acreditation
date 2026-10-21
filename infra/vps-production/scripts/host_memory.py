#!/usr/bin/env python3
"""Read-only host overhead diagnosis; no Docker calls, signals, arguments or secrets.

Run through sudo in normal SSH to see the host process namespace. Only numeric
fields for dockerd/containerd/Codex are returned; RSS values must not be added to
container working sets as an independent total or assumed reclaimable.
"""
import sys
sys.dont_write_bytecode = True
import argparse, datetime, json
from pathlib import Path
from common import safe_main

NAMES = {'dockerd', 'containerd', 'codex'}
STATUS = {'VmRSS', 'RssAnon', 'RssFile', 'RssShmem', 'VmSwap', 'VmHWM'}
ROLLUP = {'Rss', 'Pss', 'Pss_Anon', 'Pss_File', 'Pss_Shmem', 'Private_Clean',
          'Private_Dirty', 'Shared_Clean', 'Shared_Dirty', 'Swap', 'SwapPss', 'LazyFree'}

def memory_fields(text, allowed):
    result = {}
    for line in text.splitlines():
        key, sep, value = line.partition(':')
        if sep and key in allowed:
            words = value.split()
            if len(words) != 2 or words[1] != 'kB' or not words[0].isdigit():
                raise RuntimeError('HOST_MEMORY_NUMERIC_FIELD_INVALID')
            result[key + 'MiB'] = round(int(words[0]) / 1024, 2)
    return result

def collect(proc=Path('/proc')):
    rows = []
    for folder in sorted((x for x in proc.iterdir() if x.name.isdigit()), key=lambda x: int(x.name)):
        row = None
        try:
            name = (folder / 'comm').read_text().strip()
            if name not in NAMES:
                continue
            row = {'pid': int(folder.name), 'name': name}
            status = (folder / 'status').read_text()
            numeric = dict(line.split(':', 1) for line in status.splitlines() if ':' in line)
            row.update(parentPid=int(numeric['PPid']), uid=int(numeric['Uid'].split()[0]),
                       threads=int(numeric['Threads']))
            row['statusMemory'] = memory_fields(status, STATUS)
            row['proportionalMemory'] = memory_fields((folder / 'smaps_rollup').read_text(), ROLLUP)
            if not {'RssMiB', 'PssMiB', 'Pss_AnonMiB'} <= row['proportionalMemory'].keys():
                raise RuntimeError('HOST_MEMORY_ROLLUP_INCOMPLETE')
            if (folder / 'comm').read_text().strip() != name:
                row = {'pid': int(folder.name), 'name': name, 'error': 'PROCESS_CHANGED_RETRY'}
        except FileNotFoundError:
            if row is not None:
                row = {'pid': row['pid'], 'name': row['name'], 'error': 'PROCESS_EXITED_OR_ROLLUP_UNAVAILABLE'}
        except PermissionError:
            if row is not None:
                row = {'pid': row['pid'], 'name': row['name'], 'error': 'HOST_PROC_PERMISSION_DENIED'}
        if row is not None:
            rows.append(row)
    return {'collectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'readOnly': True, 'dockerInvoked': False,
            'hostDaemonVisible': any(x['name'] == 'dockerd' for x in rows),
            'processes': rows,
            'limitations': ['Observation only; not a capacity admission or leak diagnosis.',
                            'RSS includes shared mappings; PSS apportions them.',
                            'No memory is assumed reclaimable and no process was signalled.']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='Include all selected numeric fields as JSON')
    args = parser.parse_args()
    report = collect()
    if args.json:
        print(json.dumps(report, indent=2))
        return
    print('HOST_MEMORY_READ_ONLY; MiB; PSS apportions shared pages; not reclaimable-memory estimates.')
    print(f'{"PID":>8} {"PPID":>8} {"NAME":<11} {"RSS":>9} {"PSS":>9} {"PSS_ANON":>9} {"PSS_FILE":>9} {"SWAP":>8}')
    for row in report['processes']:
        if row.get('error'):
            print(str(row['pid']) + ' ' + row['name'] + ' ' + row['error'])
            continue
        m = row['proportionalMemory']
        print(f'{row["pid"]:>8} {row["parentPid"]:>8} {row["name"]:<11} '
              f'{m["RssMiB"]:>9.2f} {m["PssMiB"]:>9.2f} {m["Pss_AnonMiB"]:>9.2f} '
              f'{m.get("Pss_FileMiB", 0):>9.2f} {m.get("SwapMiB", 0):>8.2f}')
    if not report['hostDaemonVisible']:
        print('HOST_DAEMON_NOT_VISIBLE: run from normal host SSH; this namespace is insufficient.')

if __name__ == '__main__':
    safe_main(main)
