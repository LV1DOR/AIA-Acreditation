param()
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
& corepack pnpm exec tsx scripts/local-dev-preflight.ts
if($LASTEXITCODE -ne 0){throw 'Local development validation failed.'}
$taskDirectory=Join-Path $taskRoot '.impeccable/releases/resend-one-test'
if(Test-Path -LiteralPath (Join-Path $taskDirectory 'receipt.json')){Write-Host 'The authorised test was already sent. No new authorisation was created.';exit 0}
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskKey=Read-Host 'Paste a Resend Sending access key scoped to notify.joinaia.pt (authorises ONE test to lukevidor@gmail.com)' -AsSecureString
$taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskKey)
try{
  $taskPlain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  if($taskPlain -notmatch '^re_[A-Za-z0-9_-]+$'){throw 'Expected a Resend API key beginning re_.'}
  $taskKeyFile=Join-Path $taskDirectory 'send.key'
  [IO.File]::WriteAllText($taskKeyFile,$taskPlain,[Text.UTF8Encoding]::new($false))
  $taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls $taskKeyFile /inheritance:r /grant:r "${taskIdentity}:(F)" | Out-Null
  if($LASTEXITCODE -ne 0){Remove-Item -LiteralPath $taskKeyFile;throw 'Unable to restrict the temporary key file.'}
  $taskAuthorizationPath=Join-Path $taskDirectory 'authorization.json'
  if(-not(Test-Path -LiteralPath $taskAuthorizationPath)){
    @{to='lukevidor@gmail.com';from='notificacoes@notify.joinaia.pt';authorizedAt=[DateTime]::UtcNow.ToString('o');idempotencyKey=('aia-monitor-test/'+[guid]::NewGuid().ToString())}|ConvertTo-Json|Set-Content -LiteralPath $taskAuthorizationPath -Encoding UTF8
  }
}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer);$taskPlain=$null}
Write-Host 'Authorised: one test email to lukevidor@gmail.com only. The sending key was saved privately, not in .env.'
