$ErrorActionPreference = 'Stop'
$sourceLinux = '/home/luke/aia-privacy-images-1792586967439122471'
$sourceWindows = '\\wsl.localhost\Ubuntu\home\luke\aia-privacy-images-1792586967439122471'
$remote = '/home/luke/aia-accreditation-production-kit/incoming/shared-privacy-20261021-1d0b0c47b81a'
$pscp = 'C:\Program Files\PuTTY\pscp.exe'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$key = 'C:\Users\Luke\.ssh\aia-vps-LukePC.ppk'
$files = @('images.tar', 'images.json', 'build-review.json', 'TRANSFER.sha256')
foreach ($file in @($pscp, $plink, $key)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Required PuTTY executable or key is missing.' }
}
# Linux verification avoids copying the large archive into another PC directory.
wsl.exe -d Ubuntu --user luke --cd $sourceLinux --exec /usr/bin/sha256sum -c TRANSFER.sha256
if ($LASTEXITCODE -ne 0) { throw 'Local image-bundle checksum verification failed.' }
foreach ($file in $files) {
    if (!(Test-Path -LiteralPath (Join-Path $sourceWindows $file) -PathType Leaf)) {
        throw 'Expected builder output not readable through the Ubuntu WSL share.'
    }
}
$receipt = Get-Content -LiteralPath (Join-Path $sourceWindows 'images.json') -Raw | ConvertFrom-Json
if ($receipt.material -cne '1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343' -or
    $receipt.publicKeyHash -cne '7a2361c32ae4ac4a804ec8324d267a643f95200795611c7c6d695f6a0a515f21' -or
    $receipt.operationsMaterialSha256 -cne 'f046d8cb976b09475d4879560241ada1a76d934662dbc12590372f90fb846103' -or
    $receipt.images.web.id -cne 'sha256:785ccf90deaf5e37a092226ce94a92cce6470fcde2f0f0800d784398fec2ed2d' -or
    $receipt.images.worker.id -cne 'sha256:b8159809713eeec11ab30b74507d58fb140d8c2118edd6faeb106a35526e64d1' -or
    $receipt.images.tools.id -cne 'sha256:f02cfc1df1d917880370d986197961306fc1e6dd72c862d086057b7bb9bac2a1') {
    throw 'The output does not match the verified privacy build.'
}
if ((Read-Host 'Type TRANSFER-PRIVACY to approve uploading only this image bundle into a new VPS incoming folder; no image loading or deployment') -cne 'TRANSFER-PRIVACY') {
    throw 'Transfer not approved.'
}
# mkdir deliberately refuses an existing destination, preserving any partial/prior transfer.
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "umask 077 && mkdir -- $remote"
if ($LASTEXITCODE -ne 0) { throw 'New incoming folder was not created; stop without overwriting existing files.' }
foreach ($file in $files) {
    & $pscp -sftp -P 22 -i $key (Join-Path $sourceWindows $file) "luke@159.195.252.245:$remote/$file"
    if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Preserve both copies; do not load or deploy.' }
}
& $plink -batch -ssh -P 22 -i $key 'luke@159.195.252.245' "cd $remote && sha256sum -c TRANSFER.sha256"
if ($LASTEXITCODE -ne 0) { throw 'VPS transfer checksum verification failed; do not load or deploy.' }
Write-Host 'PRIVACY_IMAGES_TRANSFERRED_AND_VERIFIED_NO_IMAGES_LOADED_NO_DEPLOYMENT'
Write-Host "VPS_INCOMING=$remote"
