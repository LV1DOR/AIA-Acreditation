$ErrorActionPreference = 'Stop'
$pscp = 'C:\Program Files\PuTTY\pscp.exe'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$key = 'C:\Users\Luke\.ssh\aia-vps-LukePC.ppk'
foreach ($file in @($pscp, $plink, $key)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Required PuTTY executable or key is missing.' }
}
if ((Read-Host 'Type BUILD-UPLOAD-PUSH to approve PC-only offline tests, serial builds, uploading the image bundle and pushing source commits, then opening SSH for a separately confirmed deployment') -cne 'BUILD-UPLOAD-PUSH') {
    throw 'Operation not approved.'
}
$name = 'aia-leader-updates-' + [guid]::NewGuid().ToString('N')
$dir = Join-Path "$env:USERPROFILE\Downloads" $name
New-Item -ItemType Directory -Path $dir | Out-Null
$hashes = @{
    'leader-updates-source.tar.gz' = '9fd4be28b7aaae20cd96506109701cf1c5df53c581e89950b8617a6cf9f6ef7b'
    'run_pc.py' = '60cc8a9674505df4145e6e008a102f8be01964a731499f92a8e8fd8213029f2b'
    'build_pc.py' = '07be31e2bc5ba2f777f6c6185f47abb6dab2cead57d326aa0edc1396e9462156'
}
foreach ($file in $hashes.Keys) {
    $target = Join-Path $dir $file
    & $pscp -sftp -P 22 -i $key "luke@159.195.252.245:/home/luke/aia-accreditation-production-kit/release/leader-updates-20261021/$file" $target
    if ($LASTEXITCODE -ne 0) { throw 'Download failed; nothing deployed.' }
    if ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -cne $hashes[$file]) {
        throw 'Downloaded helper or source checksum mismatch; stop here.'
    }
}
$work = "/home/luke/$name"
wsl.exe -d Ubuntu --user luke --exec /usr/bin/python3 -B -u "/mnt/c/Users/Luke/Downloads/$name/run_pc.py" $work --approved-pc-tests-build-and-upload
if ($LASTEXITCODE -ne 0) { throw 'PC tests/build failed. Preserve the workspace; no upload or deployment performed.' }
$output = Get-Content -LiteralPath "\\wsl.localhost\Ubuntu\home\luke\$name\build-output.json" -Raw | ConvertFrom-Json
if ($output.material -cne '958e4b864a7f6d06b578518e09a11798d00e23df8cb08896e29f08636b41f369' -or
    $output.directory -cnotmatch '^/home/luke/aia-leader-updates-images-[0-9]+$') { throw 'Unexpected build output.' }
$sourceWindows = '\\wsl.localhost\Ubuntu' + ($output.directory -replace '/', '\')
wsl.exe -d Ubuntu --user luke --cd $output.directory --exec /usr/bin/sha256sum -c TRANSFER.sha256
if ($LASTEXITCODE -ne 0) { throw 'Image bundle checksums failed; do not transfer.' }
$remote = '/home/luke/aia-accreditation-production-kit/incoming/leader-updates-20261021-958e4b864a7f'
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "umask 077 && mkdir -- $remote"
if ($LASTEXITCODE -ne 0) { throw 'Incoming folder already exists or could not be created. Preserve it; do not overwrite.' }
foreach ($file in @('images.tar', 'images.json', 'build-review.json', 'TRANSFER.sha256')) {
    & $pscp -sftp -P 22 -i $key (Join-Path $sourceWindows $file) "luke@159.195.252.245:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Keep both copies; do not deploy.' }
}
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "cd $remote && sha256sum -c TRANSFER.sha256"
if ($LASTEXITCODE -ne 0) { throw 'VPS checksum verification failed; do not deploy.' }
Write-Host 'LEADER_UPDATES_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT'
# No force push: Git rejects a changed upstream rather than rewriting its history.
$pushOutput = @(& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' 'python3 -B /home/luke/aia-accreditation-production-kit/release/leader-updates-20261021/push_verified.py')
$pushExit = $LASTEXITCODE
$pushOutput | ForEach-Object { Write-Host $_ }
if ($pushExit -ne 0 -or !($pushOutput | Where-Object { $_ -cmatch '^GITHUB_MASTER_VERIFIED=[a-f0-9]{40}$' })) {
    throw 'Images are verified on the VPS, but remote master was not verified. Preserve everything and paste the Git error.'
}
Write-Host 'SOURCE_COMMITS_PUSHED_TO_GITHUB'
Write-Host 'NEXT_PUTTY_COMMAND:'
Write-Host 'sudo python3 /home/luke/aia-accreditation-production-kit/release/leader-updates-20261021/deploy_approved.py --approve-import-backup-and-application-update'

Write-Host 'Opening VPS SSH: enter sudo password if requested, then review and type DEPLOY-LEADER-UPDATES to deploy.'
& $plink -ssh -t -P 22 -i $key 'luke@159.195.252.245' 'sudo python3 -B /home/luke/aia-accreditation-production-kit/release/leader-updates-20261021/deploy_approved.py --approve-import-backup-and-application-update'
if ($LASTEXITCODE -ne 0) { throw 'VPS deployment did not complete. Preserve the bundle and paste the SSH output; do not rebuild.' }
Write-Host 'LEADER_UPDATES_WORKFLOW_COMPLETED_BROWSER_ACCEPTANCE_PENDING'
