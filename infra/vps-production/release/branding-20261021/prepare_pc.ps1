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
$name = 'aia-branding-' + [guid]::NewGuid().ToString('N')
$dir = Join-Path "$env:USERPROFILE\Downloads" $name
New-Item -ItemType Directory -Path $dir | Out-Null
$hashes = @{
    'branding-source.tar.gz' = 'd1093fc075775e37e5b5babfc8de5ac52bd59b11113df0ba59871ec6226b7148'
    'run_pc.py' = 'e02a083d1721f77f8134f63b10905008afec8a5e5b0fe88de6441dbc8d712e94'
    'build_pc.py' = '05cfd6b1612ed44935b8992a525838a07d89de20eb50bf16ec461f29da106cd1'
}
foreach ($file in $hashes.Keys) {
    $target = Join-Path $dir $file
    & $pscp -sftp -P 22 -i $key "luke@159.195.252.245:/home/luke/aia-accreditation-production-kit/release/branding-20261021/$file" $target
    if ($LASTEXITCODE -ne 0) { throw 'Download failed; nothing deployed.' }
    if ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -cne $hashes[$file]) {
        throw 'Downloaded helper or source checksum mismatch; stop here.'
    }
}
$work = "/home/luke/$name"
wsl.exe -d Ubuntu --user luke --exec /usr/bin/python3 -B -u "/mnt/c/Users/Luke/Downloads/$name/run_pc.py" $work --approved-pc-tests-build-and-upload
if ($LASTEXITCODE -ne 0) { throw 'PC tests/build failed. Preserve the workspace; no upload or deployment performed.' }
$output = Get-Content -LiteralPath "\\wsl.localhost\Ubuntu\home\luke\$name\build-output.json" -Raw | ConvertFrom-Json
if ($output.material -cne '55c686172608c2c7b20ee2361773e0901f9a0654b33268264644d123bd109977' -or
    $output.directory -cnotmatch '^/home/luke/aia-branding-images-[0-9]+$') { throw 'Unexpected build output.' }
$sourceWindows = '\\wsl.localhost\Ubuntu' + ($output.directory -replace '/', '\')
wsl.exe -d Ubuntu --user luke --cd $output.directory --exec /usr/bin/sha256sum -c TRANSFER.sha256
if ($LASTEXITCODE -ne 0) { throw 'Image bundle checksums failed; do not transfer.' }
$remote = '/home/luke/aia-accreditation-production-kit/incoming/branding-20261021-55c686172608'
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "umask 077 && mkdir -- $remote"
if ($LASTEXITCODE -ne 0) { throw 'Incoming folder already exists or could not be created. Preserve it; do not overwrite.' }
foreach ($file in @('images.tar', 'images.json', 'build-review.json', 'TRANSFER.sha256')) {
    & $pscp -sftp -P 22 -i $key (Join-Path $sourceWindows $file) "luke@159.195.252.245:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Keep both copies; do not deploy.' }
}
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "cd $remote && sha256sum -c TRANSFER.sha256"
if ($LASTEXITCODE -ne 0) { throw 'VPS checksum verification failed; do not deploy.' }
Write-Host 'BRANDING_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT'
# No force push: Git rejects a changed upstream rather than rewriting its history.
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "GIT_SSH_COMMAND='ssh -F /dev/null -i /home/luke/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes' git -C /home/luke/aia-accreditation-publish push origin master"
if ($LASTEXITCODE -ne 0) { throw 'Images are verified on the VPS, but GitHub push failed. Preserve everything and paste the Git error.' }
Write-Host 'SOURCE_COMMITS_PUSHED_TO_GITHUB'
Write-Host 'NEXT_PUTTY_COMMAND:'
Write-Host 'sudo python3 /home/luke/aia-accreditation-production-kit/release/branding-20261021/deploy_approved.py --approve-import-backup-and-application-update'
