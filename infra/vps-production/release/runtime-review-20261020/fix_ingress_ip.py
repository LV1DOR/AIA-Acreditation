#!/usr/bin/env python3
"""Approved one-line Compose correction and replacement of failed, stateless ingress only."""
import sys
sys.dont_write_bytecode = True
import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
KIT = ROOT.parents[1]
sys.path.insert(0, str(KIT / 'scripts'))
import production
from common import (STATE, PROJECT, approved, require, operation_lock,
                    locked_child_options, put, safe_main)
from approve_runtime import apply_batch

ORIGINAL_COMPOSE_SHA = '7573d76b1df9ad21f0af8dc768893972a76ac674e976a6d743d0edfcacf2cbb6'
PIN = b'        ipv4_address: 172.31.219.2\n'
PROTECTED = ('postgres', 'redis', 'minio', 'web', 'worker')


def patch_compose(original):
    require(hashlib.sha256(original).hexdigest() == ORIGINAL_COMPOSE_SHA,
            'REVIEWED_COMPOSE_BASELINE_CHANGED')
    require(original.count(PIN) == 1, 'EXACT_INGRESS_STATIC_IP_LINE_REQUIRED')
    return original.replace(PIN, b'', 1)


def verify_effective_config(before, after):
    expected = copy.deepcopy(before)
    require(expected['services']['ingress']['networks']['egress'].pop('ipv4_address', None)
            == '172.31.219.2', 'EXPECTED_INGRESS_STATIC_IP_REQUIRED')
    require(after == expected, 'ONLY_INGRESS_STATIC_IP_MAY_CHANGE')


def container(service):
    ids = production.dc('ps', '-aq', service).splitlines()
    require(len(ids) == 1, 'EXACTLY_ONE_SCOPED_SERVICE_CONTAINER_REQUIRED')
    item = json.loads(production.docker('inspect', ids[0]))[0]
    labels = item['Config']['Labels']
    require(labels.get('com.docker.compose.project') == PROJECT and
            labels.get('com.docker.compose.service') == service, 'CONTAINER_SCOPE_MISMATCH')
    return item


def snapshot(item):
    state = item['State']
    return {'id': item['Id'], 'image': item['Image'], 'startedAt': state.get('StartedAt'),
            'restartCount': item.get('RestartCount'), 'status': state.get('Status'),
            'health': state.get('Health', {}).get('Status')}


def verify_unchanged(before, after):
    require(before == after, 'PROTECTED_SERVICE_CHANGED_INSPECT_DO_NOT_RESTART')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approve-ingress-ip-fix-and-failed-container-replacement', action='store_true')
    args = parser.parse_args()
    require(args.approve_ingress_ip_fix_and_failed_container_replacement,
            'EXPLICIT_INGRESS_CONFIG_AND_REPLACEMENT_APPROVAL_REQUIRED')
    require(os.geteuid() == 0, 'OPERATOR_SUDO_REQUIRED')
    require(input('Type FIX-INGRESS to approve the one-line config fix and replacement of failed ingress only: ').strip()
            == 'FIX-INGRESS', 'INGRESS_FIX_CONFIRMATION_REQUIRED')
    os.umask(0o077)
    with operation_lock() as fd:
        review = approved('start-private')
        approved('readiness')
        compose_path = KIT / 'compose.yaml'
        manifest_path = KIT / 'MANIFEST.sha256'
        original = compose_path.read_bytes()
        candidate = patch_compose(original)
        require(candidate == (ROOT / 'compose.ingress-ip-fixed.yaml').read_bytes(), 'CANDIDATE_COMPOSE_CHANGED')
        manifest = manifest_path.read_bytes()
        entries = []
        for line in manifest.decode().splitlines():
            digest, name = line.split('  ', 1)
            require(hashlib.sha256((KIT / name).read_bytes()).hexdigest() == digest,
                    'ACTIVE_KIT_MANIFEST_CHANGED')
            entries.append(name)
        require(entries.count('compose.yaml') == 1, 'EXACT_COMPOSE_MANIFEST_ENTRY_REQUIRED')
        production.healthy(list(PROTECTED))
        protected = {service: snapshot(container(service)) for service in PROTECTED}
        old = container('ingress')
        require(old['State']['Status'] == 'created' and not old['State']['Running'] and
                'Address already in use' in old['State'].get('Error', ''),
                'EXPECTED_FAILED_CREATED_INGRESS_REQUIRED')
        require(not any(m.get('Type') == 'volume' for m in old.get('Mounts', [])),
                'INGRESS_MUST_HAVE_NO_PERSISTENT_DATA_VOLUME')
        network_name = PROJECT + '_egress'
        network = json.loads(production.docker('network', 'inspect', network_name))[0]
        require(network.get('Labels', {}).get('com.docker.compose.project') == PROJECT,
                'EGRESS_NETWORK_SCOPE_MISMATCH')
        owner = [identifier for identifier, endpoint in network.get('Containers', {}).items()
                 if endpoint.get('IPv4Address', '').split('/')[0] == '172.31.219.2']
        require(owner == [protected['worker']['id']], 'CONFIRMED_WORKER_IP_COLLISION_REQUIRED')
        ports = production.run(['ss', '-H', '-ltn', '( sport = :18881 or sport = :18444 )'])
        require(not ports, 'INGRESS_HOST_PORT_IN_USE')
        production.resource_preflight('steady')
        before_config = production.cfg()
        candidate_config = json.loads(production.docker('compose', '--project-name', PROJECT,
            '--project-directory', str(KIT), '--env-file', str(STATE / 'compose.env'),
            '-f', str(ROOT / 'compose.ingress-ip-fixed.yaml'), '--profile', 'maintenance',
            'config', '--format', 'json'))
        verify_effective_config(before_config, candidate_config)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = STATE / ('ingress-ip-fix-before-' + stamp)
        backup.mkdir(mode=0o700)
        for name, content in (('compose.yaml', original), ('MANIFEST.sha256', manifest),
                              ('review.json', (STATE / 'review.json').read_bytes())):
            with (backup / name).open('xb') as out:
                os.fchmod(out.fileno(), 0o600)
                out.write(content)
                out.flush()
                os.fsync(out.fileno())
        put(backup / 'container-evidence.json', {'protectedServices': protected,
            'failedIngress': snapshot(old), 'egressNetworkId': network['Id']})
        replacement = hashlib.sha256(candidate).hexdigest().encode() + b'  compose.yaml'
        old_entry = ORIGINAL_COMPOSE_SHA.encode() + b'  compose.yaml'
        require(manifest.count(old_entry) == 1, 'EXACT_COMPOSE_MANIFEST_ENTRY_REQUIRED')
        updated_review = copy.deepcopy(review)
        updated_review.setdefault('approvedActions', []).append('ingress-ip-fix')
        updated_review['ingressIpFixApproval'] = {'atUtc': stamp,
            'scope': 'REMOVE_INGRESS_STATIC_IP_REPLACE_ONLY_FAILED_STATELESS_INGRESS',
            'originalComposeSha256': ORIGINAL_COMPOSE_SHA,
            'newComposeSha256': hashlib.sha256(candidate).hexdigest(),
            'healthyServicesMustRemainUnchanged': list(PROTECTED), 'publicCutoverApproved': False}
        apply_batch({compose_path: candidate, manifest_path: manifest.replace(old_entry, replacement, 1),
                     STATE / 'review.json': (json.dumps(updated_review, indent=2) + '\n').encode()})
        print('ONE_LINE_INGRESS_FIX_APPLIED_IMAGES_AND_CREDENTIALS_UNCHANGED', flush=True)
        print('PROTECTED_ROLLBACK_FILES: ' + str(backup), flush=True)
        try:
            production.validate()
            production.dc('up', '-d', '--no-deps', '--force-recreate', '--no-build', '--pull', 'never',
                          '--wait', '--wait-timeout', '90', 'ingress')
            production.healthy(list(PROTECTED) + ['ingress'])
            verify_unchanged(protected, {service: snapshot(container(service)) for service in PROTECTED})
            require(json.loads(production.docker('network', 'inspect', network_name))[0]['Id'] == network['Id'],
                    'EGRESS_NETWORK_CHANGED_INSPECT_FIRST')
            print('INGRESS_HEALTHY_FIVE_EXISTING_SERVICES_UNCHANGED', flush=True)
            # Complete the already approved standard startup/readiness workflow.
            # --no-recreate in start-private preserves these now-healthy containers.
            for action in ('start-private', 'readiness'):
                result = subprocess.run([sys.executable, str(KIT / 'scripts/production.py'), action],
                                        **locked_child_options(fd))
                require(result.returncode == 0, 'STANDARD_PRIVATE_START_OR_READINESS_FAILED')
            verify_unchanged(protected, {service: snapshot(container(service)) for service in PROTECTED})
            production.receipt('ingress-ip-fix', {'protectedServicesUnchanged': True,
                               'previousIngressId': old['Id'], 'publicRoutingChanged': False})
            print('PRIVATE_APPLICATION_READY_PUBLIC_HOLDING_PAGE_UNCHANGED')
        except Exception:
            subprocess.run([sys.executable, str(ROOT / 'diagnose_startup.py')], **locked_child_options(fd))
            raise RuntimeError('INGRESS_FIX_OR_READINESS_FAILED_KEEP_PUBLIC_HOLDING_PAGE') from None


if __name__ == '__main__':
    safe_main(main)
