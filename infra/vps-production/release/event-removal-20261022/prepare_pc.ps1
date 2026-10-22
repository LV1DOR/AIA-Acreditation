$ErrorActionPreference = 'Stop'
$pscp = 'C:\Program Files\PuTTY\pscp.exe'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$key = 'C:\Users\Luke\.ssh\aia-vps-LukePC.ppk'
foreach ($file in @($pscp, $plink, $key)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Required PuTTY executable or key is missing.' }
}
if ((Read-Host 'Type BUILD-UPLOAD-PUSH to approve PC-only offline tests, an isolated synthetic PostgreSQL test, serial builds, uploading the image bundle and pushing source commits, no production deployment; use your existing VPS PuTTY session afterwards') -cne 'BUILD-UPLOAD-PUSH') {
    throw 'Operation not approved.'
}
$name = 'aia-event-removal-' + [guid]::NewGuid().ToString('N')
$dir = Join-Path "$env:USERPROFILE\Downloads" $name
New-Item -ItemType Directory -Path $dir | Out-Null
$hashes = @{
    'event-removal-source.tar.gz' = '95323ec406a71e7c1174dc94fcb4bb49ab3da0e33c38e26381eed0f13374493d'
    'run_pc.py' = '840555bd0747056688ab5b240f529f0cbf77cb166e7a103c5148c307d9118ec0'
    'build_pc.py' = 'e107cafeb2a9f73c99e0665090c3e48f7bb0d15618cf8da5bedafa83b66e017f'
}
foreach ($file in $hashes.Keys) {
    $target = Join-Path $dir $file
    & $pscp -sftp -P 22 -i $key "luke@159.195.252.245:/home/luke/aia-accreditation-production-kit/release/event-removal-20261022/$file" $target
    if ($LASTEXITCODE -ne 0) { throw 'Download failed; nothing deployed.' }
    if ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -cne $hashes[$file]) {
        throw 'Downloaded helper or source checksum mismatch; stop here.'
    }
}
$work = "/home/luke/$name"
wsl.exe -d Ubuntu --user luke --exec /usr/bin/python3 -B -u "/mnt/c/Users/Luke/Downloads/$name/run_pc.py" $work --approved-pc-tests-build-and-upload
if ($LASTEXITCODE -ne 0) { throw 'PC tests/build failed. Preserve the workspace; no upload or deployment performed.' }
$output = Get-Content -LiteralPath "\\wsl.localhost\Ubuntu\home\luke\$name\build-output.json" -Raw | ConvertFrom-Json
if ($output.material -cne 'bdd31b39a3f3a0a7cc6ad644a1eeca7793fdffbbe1a9e4875bfb1965c61c88df' -or
    $output.directory -cnotmatch '^/home/luke/aia-event-removal-images-[0-9]+$') { throw 'Unexpected build output.' }
$sourceWindows = '\\wsl.localhost\Ubuntu' + ($output.directory -replace '/', '\')
wsl.exe -d Ubuntu --user luke --cd $output.directory --exec /usr/bin/sha256sum -c TRANSFER.sha256
if ($LASTEXITCODE -ne 0) { throw 'Image bundle checksums failed; do not transfer.' }
$remote = '/home/luke/aia-accreditation-production-kit/incoming/event-removal-20261022-bdd31b39a3f3'
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "umask 077 && mkdir -- $remote"
if ($LASTEXITCODE -ne 0) { throw 'Incoming folder already exists or could not be created. Preserve it; do not overwrite.' }
foreach ($file in @('images.tar', 'images.json', 'build-review.json', 'TRANSFER.sha256')) {
    & $pscp -sftp -P 22 -i $key (Join-Path $sourceWindows $file) "luke@159.195.252.245:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Keep both copies; do not deploy.' }
}
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "cd $remote && sha256sum -c TRANSFER.sha256"
if ($LASTEXITCODE -ne 0) { throw 'VPS checksum verification failed; do not deploy.' }
Write-Host 'EVENT_REMOVAL_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT'
# No force push: Git rejects a changed upstream rather than rewriting its history.
$pushOutput = @(& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' 'python3 -B /home/luke/aia-accreditation-production-kit/release/event-removal-20261022/push_verified.py')
$pushExit = $LASTEXITCODE
$pushOutput | ForEach-Object { Write-Host $_ }
if ($pushExit -ne 0 -or !($pushOutput | Where-Object { $_ -cmatch '^GITHUB_MASTER_VERIFIED=[a-f0-9]{40}$' })) {
    throw 'Images are verified on the VPS, but remote master was not verified. Preserve everything and paste the Git error.'
}
Write-Host 'SOURCE_COMMITS_PUSHED_TO_GITHUB'
Write-Host 'NEXT_PUTTY_COMMAND:'
Write-Host 'sudo python3 /home/luke/aia-accreditation-production-kit/release/event-removal-20261022/deploy_approved.py --approve-backup-additive-migration-and-application-update'
