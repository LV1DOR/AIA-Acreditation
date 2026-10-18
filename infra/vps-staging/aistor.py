"""Staging-only AIStor adapter; application release images are preserved."""
import hashlib, json, os, re, stat
from pathlib import Path
from prepare import STATE, KIT, PROJECT, require, put, readenv, envput, check_repo

IMAGE_TAG = 'quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z'
MC_RELEASE = 'RELEASE.2026-09-19T15-24-59Z'
MC_URL = 'https://dl.min.io/aistor/mc/release/linux-amd64/mc.'+MC_RELEASE
MC_SHA256 = '83938eded435e7c28c397ece1dc590b2a79626dd9354aae2107060fec559ae2b'
LICENSE = STATE/'licenses/minio.license'
CLIENT = STATE/'aistor/mc'

def license_guard():
    # Never decode, copy, hash, print, or put this file into a build context/receipt.
    require(LICENSE.parent.resolve()==STATE/'licenses' and not LICENSE.is_symlink(), 'REGULAR_PRIVATE_LICENSE_FILE_REQUIRED')
    s=LICENSE.stat()
    require(stat.S_ISREG(s.st_mode) and 0<s.st_size<1024*1024, 'NONEMPTY_REGULAR_LICENSE_REQUIRED')
    require(stat.S_IMODE(s.st_mode) in (0o400,0o600), 'LICENSE_MUST_BE_MODE_0400_OR_0600')
    require(s.st_uid in (0,1000), 'LICENSE_OWNER_MUST_BE_ROOT_OR_STAGING_UID')

def adapter_guard():
    import deploy as d
    from wizard_release import installed_kit
    # Keep the original adapter/build receipts immutable. The reviewed updater
    # authorizes this exact kit transition separately; storage itself is unchanged.
    reviewed_kit=installed_kit(STATE,KIT,d.kit_materials())
    r=json.loads((STATE/'aistor-adapter.json').read_text())
    built=json.loads((STATE/'images.json').read_text())
    require(r['applicationImages']==built['images'] and r['sourceSha']==built['sourceSha'], 'APPLICATION_RELEASE_RECEIPT_CHANGED')
    require(r['previousDeploymentKit']==built['deploymentKit'], 'BUILD_KIT_BASELINE_CHANGED')
    if r['deploymentKit']!=reviewed_kit:
        baseline=json.loads((KIT/'aistor-typeerror-baseline.json').read_text())['deploymentKit']
        fix=json.loads((STATE/'aistor-validation-fix.json').read_text())
        require(r['deploymentKit']==baseline and fix['previousDeploymentKit']==baseline, 'REVIEWED_AISTOR_ADAPTER_CHANGED')
        if fix['deploymentKit']!=reviewed_kit:
            # Exact, reviewed transition from the successful pre-mount-fix kit.
            # Preserve original adapter/build/configuration receipts and images.
            mount_baseline=json.loads((KIT/'maintenance-mount-baseline.json').read_text())['deploymentKit']
            require(fix['deploymentKit']==mount_baseline, 'UNKNOWN_MAINTENANCE_MOUNT_BASELINE')
            review=dict(previousDeploymentKit=mount_baseline,deploymentKit=reviewed_kit)
            path=STATE/'maintenance-mount-fix.json'
            if path.exists():
                previous=json.loads(path.read_text())
                if previous!=review:
                    diagnostic_baseline=KIT/'storage-diagnostics-baseline.json'
                    require(diagnostic_baseline.exists(), 'MAINTENANCE_MOUNT_FIX_RECEIPT_CHANGED')
                    known=json.loads(diagnostic_baseline.read_text())['deploymentKit']
                    require(previous==dict(previousDeploymentKit=mount_baseline,deploymentKit=known), 'MAINTENANCE_MOUNT_FIX_RECEIPT_CHANGED')
                    next_review=dict(previousDeploymentKit=known,deploymentKit=reviewed_kit)
                    diagnostic_receipt=STATE/'storage-diagnostics-fix.json'
                    if diagnostic_receipt.exists():
                        previous_diagnostic=json.loads(diagnostic_receipt.read_text())
                        if previous_diagnostic!=next_review:
                            bucket_baseline=KIT/'bucket-name-fix-baseline.json'
                            require(bucket_baseline.exists(),'STORAGE_DIAGNOSTICS_FIX_RECEIPT_CHANGED')
                            installed=json.loads(bucket_baseline.read_text())['deploymentKit']
                            require(previous_diagnostic==dict(previousDeploymentKit=known,deploymentKit=installed),'STORAGE_DIAGNOSTICS_FIX_RECEIPT_CHANGED')
                            bucket_review=dict(previousDeploymentKit=installed,deploymentKit=reviewed_kit)
                            bucket_receipt=STATE/'bucket-name-fix.json'
                            if bucket_receipt.exists():
                                require(json.loads(bucket_receipt.read_text())==bucket_review,'BUCKET_NAME_FIX_RECEIPT_CHANGED')
                            else:
                                with bucket_receipt.open('x',encoding='utf8') as f:
                                    os.fchmod(f.fileno(),0o600);f.write(json.dumps(bucket_review,indent=2)+'\n')
                    else:
                        with diagnostic_receipt.open('x',encoding='utf8') as f:
                            os.fchmod(f.fileno(),0o600);f.write(json.dumps(next_review,indent=2)+'\n')
            else:
                with path.open('x',encoding='utf8') as f:
                    os.fchmod(f.fileno(),0o600);f.write(json.dumps(review,indent=2)+'\n')
    require(CLIENT.is_file() and not CLIENT.is_symlink() and hashlib.sha256(CLIENT.read_bytes()).hexdigest()==MC_SHA256, 'AISTOR_CLIENT_CHECKSUM_MISMATCH')
    license_guard()
    v=readenv(STATE/'compose.env')
    require(v['AIA_MINIO_IMAGE']==r['image'] and v['AIA_AISTOR_MC_FILE']==str(CLIENT) and v['AIA_AISTOR_LICENSE_FILE']==str(LICENSE), 'AISTOR_MOUNT_OR_IMAGE_CHANGED')
    return r

def prepare_storage():
    import deploy as d
    check_repo(); d.need('build'); license_guard()
    require(not (STATE/'infra-attempt.json').exists(), 'AISTOR_ADAPTATION_MUST_PRECEDE_FIRST_INFRA_START')
    baseline=json.loads((KIT/'aistor-upgrade-baseline.json').read_text())['previousDeploymentKit']
    built=json.loads((STATE/'images.json').read_text())
    require(built['deploymentKit']==baseline or built['deploymentKit']==d.kit_materials(), 'PREVIOUS_BUILD_KIT_DOES_NOT_MATCH_REVIEWED_BASELINE')
    require(d.materials()['sourceSha']==built['sourceSha'], 'APPLICATION_SOURCE_CHANGED_REVIEW_BEFORE_ADAPTATION')
    e=readenv(STATE/'secrets/web.env')
    require(hashlib.sha256(e['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].encode()).hexdigest()==built['publicKeyHash'], 'CLERK_PUBLIC_KEY_CHANGED')
    for role,item in built['images'].items():
        image=json.loads(d.docker('image','inspect',item['id']))[0]
        require(image['Id']==item['id'] and image['Config']['Labels']['org.opencontainers.image.revision']==built['sourceSha'], 'APPLICATION_IMAGE_CHANGED_'+role)
    # The previous attempt finished selection/permissions, then failed solely in
    # validate(). Resume there without pulls, probe containers or state rewrites.
    if (STATE/'aistor-adapter.json').exists():
        previous=json.loads((STATE/'aistor-adapter.json').read_text())
        current_kit=d.kit_materials()
        prior_kit=json.loads((KIT/'aistor-typeerror-baseline.json').read_text())['deploymentKit']
        require(previous['deploymentKit'] in (prior_kit,current_kit), 'UNKNOWN_PARTIAL_ADAPTER_DO_NOT_OVERWRITE')
        require(previous['applicationImages']==built['images'] and previous['sourceSha']==built['sourceSha'] and previous['previousDeploymentKit']==built['deploymentKit'], 'PARTIAL_ADAPTER_RELEASE_MISMATCH')
        v=readenv(STATE/'compose.env')
        for role,item in built['images'].items():
            require(v['AIA_'+role.upper()+'_IMAGE']==item['id'], 'EXISTING_APPLICATION_IMAGE_REFERENCE_CHANGED')
        require(previous['image']==v['AIA_MINIO_IMAGE'] and bool(re.fullmatch(r'quay\.io/minio/aistor/minio@sha256:[a-f0-9]{64}',previous['image'])), 'EXISTING_AISTOR_IMAGE_REFERENCE_CHANGED')
        image=json.loads(d.docker('image','inspect',previous['image']))[0]
        require(image['Id']==previous['imageId'], 'EXISTING_AISTOR_IMAGE_ID_CHANGED')
        require(v['AIA_AISTOR_LICENSE_FILE']==str(LICENSE) and v['AIA_AISTOR_MC_FILE']==str(CLIENT), 'EXISTING_AISTOR_MOUNT_CHANGED')
        require(CLIENT.is_file() and not CLIENT.is_symlink() and hashlib.sha256(CLIENT.read_bytes()).hexdigest()==MC_SHA256, 'AISTOR_CLIENT_CHECKSUM_MISMATCH')
        d.need('permissions')
        if previous['deploymentKit']!=current_kit:
            review=dict(previousDeploymentKit=prior_kit,deploymentKit=current_kit)
            fix_path=STATE/'aistor-validation-fix.json'
            if fix_path.exists():
                require(json.loads(fix_path.read_text())==review, 'VALIDATION_FIX_RECEIPT_CHANGED')
            else:
                # New review receipt only. Preserve original image/adapter/env receipts.
                with fix_path.open('x',encoding='utf8') as f:
                    os.fchmod(f.fileno(),0o600);f.write(json.dumps(review,indent=2)+'\n')
        d.validate();d.marker('aistor-prepare')
        print('AISTOR_PREPARED: resumed validation; existing configuration, certificates, credentials and image references preserved.')
        return
    # Resolve the reviewed dated official release to a digest before any execution.
    # This only retrieves registry metadata; no services are started.
    descriptor=json.loads(d.docker('buildx','imagetools','inspect',IMAGE_TAG,'--format','{{json .Manifest}}',log='aistor-manifest.log'))
    digest=descriptor.get('digest',descriptor.get('Digest',''))
    require(bool(re.fullmatch(r'sha256:[a-f0-9]{64}',digest)), 'OFFICIAL_IMAGE_MANIFEST_DIGEST_REQUIRED')
    image_ref='quay.io/minio/aistor/minio@'+digest
    d.docker('pull','--platform','linux/amd64',image_ref,log='aistor-pull.log')
    image=json.loads(d.docker('image','inspect',image_ref))[0]
    require(image['Architecture']=='amd64' and image['Os']=='linux', 'REVIEWED_PLATFORM_IS_LINUX_AMD64')
    d.docker('run','--name',PROJECT+'-aistor-probe-'+d.stamp(),'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--cpus','0.5','--entrypoint','/bin/sh',image_ref,'-c',
        'command -v minio >/dev/null && command -v curl >/dev/null && minio --version && minio server --help',log='aistor-probe.log')
    probe=(STATE/'logs/aistor-probe.log').read_text()
    require('RELEASE.2026-09-19T17-05-25Z' in probe and '--license' in probe and '--certs-dir' in probe, 'AISTOR_SERVER_VERSION_OR_FLAGS_MISMATCH')
    CLIENT.parent.mkdir(mode=0o700,exist_ok=True)
    if not CLIENT.exists() or hashlib.sha256(CLIENT.read_bytes()).hexdigest()!=MC_SHA256:
        part=CLIENT.with_name('mc.download')
        require(not part.is_symlink() and not CLIENT.is_symlink(), 'CLIENT_PATH_SYMLINK_FORBIDDEN')
        d.run(['curl','--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time','300','--output',str(part),MC_URL],log='aistor-client-download.log')
        require(hashlib.sha256(part.read_bytes()).hexdigest()==MC_SHA256, 'OFFICIAL_AISTOR_CLIENT_CHECKSUM_FAILED')
        part.chmod(0o555); os.replace(part,CLIENT)
    os.chown(CLIENT,1000,1000); CLIENT.chmod(0o555)
    version=d.docker('run','--name',PROJECT+'-aistor-client-probe-'+d.stamp(),'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--mount',f'type=bind,source={CLIENT},target=/usr/local/bin/mc,readonly','--entrypoint','/usr/local/bin/mc',built['images']['tools']['id'],'--version',log='aistor-client-probe.log')
    require(MC_RELEASE in version, 'AISTOR_CLIENT_VERSION_MISMATCH')
    # Ownership only: license content remains in the original, unmodified file.
    os.chown(LICENSE,1000,1000); LICENSE.chmod(0o400)
    os.chown(LICENSE.parent,1000,1000); LICENSE.parent.chmod(0o700)
    v=readenv(STATE/'compose.env')
    v.update(AIA_MINIO_IMAGE=image_ref,AIA_AISTOR_LICENSE_FILE=str(LICENSE),AIA_AISTOR_MC_FILE=str(CLIENT))
    envput(STATE/'compose.env',v)
    put(STATE/'aistor-adapter.json',dict(applicationImages=built['images'],sourceSha=built['sourceSha'],previousDeploymentKit=built['deploymentKit'],deploymentKit=d.kit_materials(),image=image_ref,imageId=image['Id'],reviewedTag=IMAGE_TAG,clientRelease=MC_RELEASE,clientSha256=MC_SHA256,licenseContentsRecorded=False,applicationRebuilt=False))
    put(STATE/'storage-review.json',dict(image=image_ref,supportReference='Official AIStor maintained distribution; Free is self-supported, no vendor SLA',licensePlan='User-supplied AIStor Free; live server/capability validation required',reviewedTag=IMAGE_TAG,compatibility='PENDING_SCOPED_S3_AND_ERASURE_TEST',source='https://docs.min.io/aistor/operations/licenses/'))
    d.permissions(); d.validate()
    d.marker('aistor-prepare')
    print('AISTOR_PREPARED: official digest pinned; license mounted privately; aligned client verified; existing app images preserved.')
    print('NEXT: infra, then storage-check. No database bootstrap or application start until STORAGE_CHECK_PASSED.')
