param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "restart", "status", "logs", "stop", "shutdown")]
  [string]$Action = "start"
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
  Ensure-DockerEngine

  Write-Host "Starting local PostgreSQL, Redis, Mailpit and MinIO..."
  & docker compose -f $composeFile up -d --wait
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed with exit code $LASTEXITCODE."
  }

  # Stop only this repository's processes before Prisma generation so Windows
  # cannot retain a query-engine DLL lock from a previous run.
  Remove-ManagedPm2Apps

  Write-Host "Preparing the database client and applying local migrations..."
  Invoke-Pnpm db:generate
  Invoke-Pnpm db:migrate

  Write-Host "Building the web and worker runtimes..."
  Invoke-Pnpm build

  Write-Host "Starting the web and worker through PM2..."
  & corepack pnpm exec pm2 start $ecosystemFile --update-env
  if ($LASTEXITCODE -ne 0) {
    throw "PM2 failed to start the application processes."
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
