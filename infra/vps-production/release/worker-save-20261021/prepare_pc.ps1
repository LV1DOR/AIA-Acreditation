$ErrorActionPreference = 'Stop'
$pscp = 'C:\Program Files\PuTTY\pscp.exe'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$key = 'C:\Users\Luke\.ssh\aia-vps-LukePC.ppk'
foreach ($file in @($pscp, $plink, $key)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Required PuTTY executable or key is missing.' }
}
if ((Read-Host 'Type BUILD-UPLOAD-PUSH to approve PC-only offline tests, serial builds, uploading the image bundle and pushing the prepared source commits; no production deployment') -cne 'BUILD-UPLOAD-PUSH') {
    throw 'Operation not approved.'
}
$name = 'aia-worker-save-' + [guid]::NewGuid().ToString('N')
$dir = Join-Path "$env:USERPROFILE\Downloads" $name
New-Item -ItemType Directory -Path $dir | Out-Null
$hashes = @{
    'worker-save-source.tar.gz' = '8e47dda057858b7e21b5350d302c00b000aa6de2f88c7569e1973988279412e4'
    'run_pc.py' = '2517bbc1b73736833cb78760725391548babcde0fc1ae4c909edb12d344e9d58'
    'build_pc.py' = 'ee655e9454381f230c497cf236c75db7d962b4dfb8490d4afa331dbe511d96c0'
}
foreach ($file in $hashes.Keys) {
    $target = Join-Path $dir $file
    & $pscp -sftp -P 22 -i $key "luke@159.195.252.245:/home/luke/aia-accreditation-production-kit/release/worker-save-20261021/$file" $target
    if ($LASTEXITCODE -ne 0) { throw 'Download failed; nothing deployed.' }
    if ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -cne $hashes[$file]) {
        throw 'Downloaded helper or source checksum mismatch; stop here.'
    }
}
$work = "/home/luke/$name"
wsl.exe -d Ubuntu --user luke --exec /usr/bin/python3 -B -u "/mnt/c/Users/Luke/Downloads/$name/run_pc.py" $work --approved-pc-tests-build-and-upload
if ($LASTEXITCODE -ne 0) { throw 'PC tests/build failed. Preserve the workspace; no upload or deployment performed.' }
$output = Get-Content -LiteralPath "\\wsl.localhost\Ubuntu\home\luke\$name\build-output.json" -Raw | ConvertFrom-Json
if ($output.material -cne '3357a0ac5c73d43dfba4df9ecdd043be0d92ea085c6080413dcc6edf2ab13872' -or
    $output.directory -cnotmatch '^/home/luke/aia-worker-save-images-[0-9]+$') { throw 'Unexpected build output.' }
$sourceWindows = '\\wsl.localhost\Ubuntu' + ($output.directory -replace '/', '\')
wsl.exe -d Ubuntu --user luke --cd $output.directory --exec /usr/bin/sha256sum -c TRANSFER.sha256
if ($LASTEXITCODE -ne 0) { throw 'Image bundle checksums failed; do not transfer.' }
$remote = '/home/luke/aia-accreditation-production-kit/incoming/worker-save-20261021-3357a0ac5c73'
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "umask 077 && mkdir -- $remote"
if ($LASTEXITCODE -ne 0) { throw 'Incoming folder already exists or could not be created. Preserve it; do not overwrite.' }
foreach ($file in @('images.tar', 'images.json', 'build-review.json', 'TRANSFER.sha256')) {
    & $pscp -sftp -P 22 -i $key (Join-Path $sourceWindows $file) "luke@159.195.252.245:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Keep both copies; do not deploy.' }
}
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "cd $remote && sha256sum -c TRANSFER.sha256"
if ($LASTEXITCODE -ne 0) { throw 'VPS checksum verification failed; do not deploy.' }
Write-Host 'WORKER_SAVE_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT'
# No force push: Git rejects a changed upstream rather than rewriting its history.
$pushOutput = @(& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' 'python3 -B /home/luke/aia-accreditation-production-kit/release/worker-save-20261021/push_verified.py')
$pushExit = $LASTEXITCODE
$pushOutput | ForEach-Object { Write-Host $_ }
if ($pushExit -ne 0 -or !($pushOutput | Where-Object { $_ -cmatch '^GITHUB_MASTER_VERIFIED=[a-f0-9]{40}$' })) {
    throw 'Images are verified on the VPS, but remote master was not verified. Preserve everything and paste the Git error.'
}
Write-Host 'SOURCE_COMMITS_PUSHED_TO_GITHUB'
Write-Host 'NEXT_PUTTY_COMMAND:'
Write-Host 'sudo python3 /home/luke/aia-accreditation-production-kit/release/worker-save-20261021/deploy_approved.py --approve-import-backup-and-application-update'
