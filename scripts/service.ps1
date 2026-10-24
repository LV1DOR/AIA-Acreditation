param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "restart", "status", "logs", "stop", "shutdown")]
  [string]$Action = "start",
  [ValidateSet("compiled", "development")]
  [string]$Mode = "compiled"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repositoryRoot "infra\local\compose.yaml"
$ecosystemFile = Join-Path $repositoryRoot "ecosystem.config.cjs"
$managedApps = @("aia-acreditacao-web", "aia-acreditacao-worker")

Set-Location -LiteralPath $repositoryRoot

function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & corepack pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed with exit code $LASTEXITCODE."
  }
}

function Test-DockerEngine {
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Ensure-DockerEngine {
  if (Test-DockerEngine) {
    return
  }

  $dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop is not installed at the expected path: $dockerDesktop"
  }

  if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
  }

  Write-Host "Waiting for the Docker engine..."
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    Start-Sleep -Seconds 2
    if (Test-DockerEngine) {
      return
    }
  }

  throw "Docker Desktop did not become ready within 120 seconds."
}

function Remove-ManagedPm2Apps {
  foreach ($appName in $managedApps) {
    $processId = (& corepack pnpm exec pm2 pid $appName 2>$null | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -eq 0 -and $processId -match '^\d+$' -and [int64]$processId -gt 0) {
      & corepack pnpm exec pm2 delete $appName | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw "PM2 could not remove $appName."
      }
    }
  }
}

function Start-Stack {
  # Reject a wrong deployment/database target before touching any running service.
  Invoke-Pnpm exec tsx scripts/local-release-preflight.ts --target-only
  if ($Mode -eq "development") {
    Invoke-Pnpm exec tsx scripts/local-dev-preflight.ts
  }
  Ensure-DockerEngine

  Write-Host "Starting local PostgreSQL, Redis, Mailpit and MinIO..."
  & docker compose -f $composeFile up -d --wait
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed with exit code $LASTEXITCODE."
  }

  if ($Mode -eq "development") {
    Invoke-Pnpm db:generate
    # Keep the existing backup/compatibility gate for pending migrations.
    Invoke-Pnpm db:migrate
    Remove-ManagedPm2Apps
    $previousRuntime = $env:AIA_LOCAL_RUNTIME
    try {
      $env:AIA_LOCAL_RUNTIME = "development"
      Invoke-Pnpm exec pm2 start $ecosystemFile --update-env
    } finally {
      $env:AIA_LOCAL_RUNTIME = $previousRuntime
    }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try {
        $webHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3100/api/health/ready' -TimeoutSec 5
        $workerHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3102/api/health/ready' -TimeoutSec 3
        if ($webHealth.StatusCode -eq 200 -and $workerHealth.StatusCode -eq 200) { $healthy = $true; break }
      } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $healthy) { throw 'Development readiness failed. Inspect service:logs before testing.' }
    Invoke-Pnpm exec pm2 save --force
    Write-Host "Development web and worker started with source watching at http://localhost:3100."
    return
  }

  $releaseStamp = Get-Date -Format 'yyyyMMddHHmmss'
  $candidateWeb = Join-Path $repositoryRoot "apps\web\.next-stale-release-$releaseStamp"
  $candidateWorker = Join-Path $repositoryRoot "apps\worker\.candidate-release-$releaseStamp"
  $previousDist = $env:NEXT_DIST_DIR
  $previousWorkerDist = $env:WORKER_DIST_DIR
  $previousDebug = $env:DEBUG
  Write-Host "Preparing and validating a candidate while existing processes continue..."
  Invoke-Pnpm db:generate
  try {
    $env:NEXT_DIST_DIR = ".next-stale-release-$releaseStamp"
    $env:WORKER_DIST_DIR = ".candidate-release-$releaseStamp"
    $env:DEBUG = ''
    Invoke-Pnpm typecheck
    Invoke-Pnpm lint
    Invoke-Pnpm build
  } finally {
    $env:NEXT_DIST_DIR = $previousDist
    $env:WORKER_DIST_DIR = $previousWorkerDist
    $env:DEBUG = $previousDebug
  }
  # Guarded migrate.ts requires a verified scoped backup and compatibility review
  # before changing an existing schema. Build/migration failure leaves PM2 untouched.
  Invoke-Pnpm db:migrate
  $knownGood = Join-Path $repositoryRoot ".impeccable\releases\$releaseStamp"
  New-Item -ItemType Directory -Path $knownGood -Force | Out-Null
  $liveWeb = Join-Path $repositoryRoot 'apps\web\.next'
  $liveWorker = Join-Path $repositoryRoot 'apps\worker\dist'
  foreach ($targetPath in @($candidateWeb,$candidateWorker,$knownGood,$liveWeb,$liveWorker)) {
    $resolvedPath = [IO.Path]::GetFullPath($targetPath)
    if (-not $resolvedPath.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escaped this repository.' }
    if ((Test-Path -LiteralPath $resolvedPath) -and ((Get-Item -LiteralPath $resolvedPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Local release paths must not be junctions or symbolic links.' }
  }
  Remove-ManagedPm2Apps
  if (Test-Path -LiteralPath $liveWeb) { Move-Item -LiteralPath $liveWeb -Destination (Join-Path $knownGood 'web') }
  if (Test-Path -LiteralPath $liveWorker) { Move-Item -LiteralPath $liveWorker -Destination (Join-Path $knownGood 'worker') }
  Move-Item -LiteralPath $candidateWeb -Destination $liveWeb
  Move-Item -LiteralPath $candidateWorker -Destination $liveWorker

  Write-Host "Starting the web and worker through PM2..."
  try {
    & corepack pnpm exec pm2 start $ecosystemFile --update-env
    if ($LASTEXITCODE -ne 0) { throw 'PM2 candidate startup failed.' }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      try {
        $webHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3100/api/health/ready' -TimeoutSec 2
        $workerHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3102/api/health/ready' -TimeoutSec 2
        if ($webHealth.StatusCode -eq 200 -and $workerHealth.StatusCode -eq 200) { $healthy = $true; break }
      } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $healthy) { throw 'Candidate readiness failed.' }
  } catch {
    Remove-ManagedPm2Apps
    foreach ($pair in @(@($liveWeb,(Join-Path $knownGood 'web'),".next-stale-failed-$releaseStamp"),@($liveWorker,(Join-Path $knownGood 'worker'),".candidate-failed-$releaseStamp"))) {
      $failedPath = Join-Path (Split-Path -Parent $pair[0]) $pair[2]
      if (-not ([IO.Path]::GetFullPath($failedPath)).StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Rollback path escaped this repository.' }
      if (Test-Path -LiteralPath $pair[0]) { Move-Item -LiteralPath $pair[0] -Destination $failedPath }
      if (Test-Path -LiteralPath $pair[1]) { Move-Item -LiteralPath $pair[1] -Destination $pair[0] }
    }
    if (Test-Path -LiteralPath (Join-Path $liveWeb 'BUILD_ID')) { & corepack pnpm exec pm2 start $ecosystemFile --update-env | Out-Host }
    throw 'Candidate activation failed; previous artifacts restored where present. The schema was not rolled back. Inspect migration compatibility and use the recovery runbook.'
  }
  & corepack pnpm exec pm2 save --force | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "PM2 could not save the process list."
  }
}

switch ($Action) {
  "start" {
    Start-Stack
  }
  "restart" {
    Start-Stack
  }
  "status" {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
      & docker compose -f $composeFile ps
    }
    & corepack pnpm exec pm2 status
  }
  "logs" {
    & corepack pnpm exec pm2 logs @managedApps --lines 100
  }
  "stop" {
    Remove-ManagedPm2Apps
    & corepack pnpm exec pm2 save --force | Out-Host
    Write-Host "Application processes stopped. Local data services remain running."
  }
  "shutdown" {
    Remove-ManagedPm2Apps
    & corepack pnpm exec pm2 save --force | Out-Host
    Ensure-DockerEngine
    & docker compose -f $composeFile stop
    if ($LASTEXITCODE -ne 0) {
      throw "Docker Compose stop failed with exit code $LASTEXITCODE."
    }
    Write-Host "Application and local infrastructure stopped; Docker volumes were preserved."
  }
}
