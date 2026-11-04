param([string]$FromDomain = 'notify.joinaia.pt')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
& corepack pnpm exec tsx scripts/local-dev-preflight.ts
if ($LASTEXITCODE -ne 0) { throw 'This setup command requires the existing isolated local development configuration.' }
if ($FromDomain -notmatch '^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$') { throw 'Invalid sender domain.' }
$taskEnvPath = Join-Path $taskRoot '.env'
if (-not (Test-Path -LiteralPath $taskEnvPath)) { throw 'Existing local .env is required.' }
$taskSecret = Read-Host 'Paste the signing secret from the NEW Resend webhook (whsec_...)' -AsSecureString
$taskSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
  $taskPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskSecretPointer)
  if ($taskPlain -notmatch '^whsec_[A-Za-z0-9+/=_-]+$') { throw 'Expected a Resend webhook signing secret beginning whsec_.' }
  $taskLines = [IO.File]::ReadAllLines($taskEnvPath) | Where-Object { $_ -notmatch '^\s*(RESEND_WEBHOOK_SECRET|RESEND_MONITOR_FROM_DOMAINS)\s*=' }
  $taskUpdated = @($taskLines) + @("RESEND_WEBHOOK_SECRET=$taskPlain", "RESEND_MONITOR_FROM_DOMAINS=$($FromDomain.ToLowerInvariant())")
  [IO.File]::WriteAllLines($taskEnvPath, $taskUpdated, [Text.UTF8Encoding]::new($false))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSecretPointer)
  $taskPlain = $null
  $taskUpdated = $null
}
Write-Host "Saved private webhook verification and sender-domain settings. No sending credentials or domains were changed."
& corepack pnpm exec pm2 restart aia-acreditacao-web --update-env
if ($LASTEXITCODE -ne 0) { throw 'Web restart failed; run corepack pnpm service:dev.' }
Write-Host 'Ready. In Resend, replay a webhook event or wait for the next outgoing email.'
