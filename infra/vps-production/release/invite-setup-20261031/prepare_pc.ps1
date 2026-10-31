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
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' 'python3 -B /home/luke/aia-accreditation-production-kit/release/invite-setup-20261031/preflight.py'
if ($LASTEXITCODE -ne 0) { throw 'Read-only live baseline/TLS check failed; no build or deployment performed.' }
$name = 'aia-invite-setup-' + [guid]::NewGuid().ToString('N')
$dir = Join-Path "$env:USERPROFILE\Downloads" $name
New-Item -ItemType Directory -Path $dir | Out-Null
$hashes = @{
    'invite-setup-source.tar.gz' = '9df89c5356b242d2acfae3c7347290bbcfa36bcd826ed2c25a586cc8716129a6'
    'run_pc.py' = '589c8653fc359e292941d6288d2cb4a29ac6c457e49f855fb44586272f9c45b1'
    'build_pc.py' = '7ef731f0059f89bd259dabe8684db3145ac1e231372e66e4cd89df83226bc915'
}
foreach ($file in $hashes.Keys) {
    $target = Join-Path $dir $file
    & $pscp -sftp -P 22 -i $key "luke@159.195.252.245:/home/luke/aia-accreditation-production-kit/release/invite-setup-20261031/$file" $target
    if ($LASTEXITCODE -ne 0) { throw 'Download failed; nothing deployed.' }
    if ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -cne $hashes[$file]) {
        throw 'Downloaded helper or source checksum mismatch; stop here.'
    }
}
$work = "/home/luke/$name"
wsl.exe -d Ubuntu --user luke --exec /usr/bin/python3 -B -u "/mnt/c/Users/Luke/Downloads/$name/run_pc.py" $work --approved-pc-tests-build-and-upload
if ($LASTEXITCODE -ne 0) { throw 'PC tests/build failed. Preserve the workspace; no upload or deployment performed.' }
$output = Get-Content -LiteralPath "\\wsl.localhost\Ubuntu\home\luke\$name\build-output.json" -Raw | ConvertFrom-Json
if ($output.material -cne '4382f2cc3acd52f29459e830a3abcbab96b1463c51a73fb7b687720d4d562e79' -or
    $output.directory -cnotmatch '^/home/luke/aia-invite-setup-images-[0-9]+$') { throw 'Unexpected build output.' }
$sourceWindows = '\\wsl.localhost\Ubuntu' + ($output.directory -replace '/', '\')
wsl.exe -d Ubuntu --user luke --cd $output.directory --exec /usr/bin/sha256sum -c TRANSFER.sha256
if ($LASTEXITCODE -ne 0) { throw 'Image bundle checksums failed; do not transfer.' }
$remote = '/home/luke/aia-accreditation-production-kit/incoming/invite-setup-20261031-4382f2cc3acd'
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "umask 077 && mkdir -- $remote"
if ($LASTEXITCODE -ne 0) { throw 'Incoming folder already exists or could not be created. Preserve it; do not overwrite.' }
foreach ($file in @('images.tar', 'images.json', 'build-review.json', 'TRANSFER.sha256')) {
    & $pscp -sftp -P 22 -i $key (Join-Path $sourceWindows $file) "luke@159.195.252.245:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Keep both copies; do not deploy.' }
}
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "cd $remote && sha256sum -c TRANSFER.sha256"
if ($LASTEXITCODE -ne 0) { throw 'VPS checksum verification failed; do not deploy.' }
Write-Host 'INVITE_SETUP_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT'
# No force push: Git rejects a changed upstream rather than rewriting its history.
$pushOutput = @(& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' 'python3 -B /home/luke/aia-accreditation-production-kit/release/invite-setup-20261031/push_verified.py')
$pushExit = $LASTEXITCODE
$pushOutput | ForEach-Object { Write-Host $_ }
if ($pushExit -ne 0 -or !($pushOutput | Where-Object { $_ -cmatch '^GITHUB_MASTER_VERIFIED=[a-f0-9]{40}$' })) {
    throw 'Images are verified on the VPS, but remote master was not verified. Preserve everything and paste the Git error.'
}
Write-Host 'SOURCE_COMMITS_PUSHED_TO_GITHUB'
Write-Host 'NEXT_PUTTY_COMMAND:'
Write-Host 'sudo python3 /home/luke/aia-accreditation-production-kit/release/invite-setup-20261031/deploy_approved.py --approve-import-backup-and-application-update'
