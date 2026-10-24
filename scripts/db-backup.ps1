<#
.SYNOPSIS
  Create a verified logical backup (pg_dump -Fc) of the BreadTrans development database.

.DESCRIPTION
  Binary-safe by design: pg_dump writes the archive inside the container, then
  `docker cp` moves it to the host. PowerShell never pipes the binary archive,
  so custom-format data cannot be corrupted by text-stream translation.

  A dump is only accepted once `pg_restore -l` can read its table of contents.
  A failed backup never deletes or overwrites a previous good backup.

  Written for Windows PowerShell 5.1: $ErrorActionPreference stays 'Continue'
  so native-command stderr cannot raise NativeCommandError, and every docker
  invocation is checked explicitly through $LASTEXITCODE.

.PARAMETER Label
  Optional label embedded in the filename, e.g. PRE_RESEED_PROTECTED.
  Any label containing PROTECTED is exempt from automatic retention pruning.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-backup.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-backup.ps1 -Label PRE_RESEED_PROTECTED
#>
param(
  [string]$Container = 'kltn-postgres',
  [string]$Database = 'kltn_db',
  [string]$User = 'postgres',
  [string]$Label = '',
  [string]$BackupDir = '',
  [switch]$SkipOffsite = $false
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Fail($message) {
  Write-Host ''
  Write-Host '=================================================='
  Write-Host ' BACKUP FAILED'
  Write-Host '=================================================='
  Write-Host " $message"
  Write-Host ' Previous backups were left untouched.'
  Write-Host '=================================================='
  exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot

# Destination: -BackupDir, else POSTGRES_BACKUP_DIR from env/.env, else ./db-backups
if (-not $BackupDir) { $BackupDir = $env:POSTGRES_BACKUP_DIR }
if (-not $BackupDir) {
  $envFile = Join-Path $repoRoot '.env'
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^\s*POSTGRES_BACKUP_DIR\s*=' |
      Select-Object -First 1
    if ($line) {
      $BackupDir = ($line.Line -replace '^\s*POSTGRES_BACKUP_DIR\s*=', '').Trim().Trim('"').Trim("'")
    }
  }
}
if (-not $BackupDir) { $BackupDir = Join-Path $repoRoot 'db-backups' }
if (-not (Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
}

# 1. Container must be running.
$running = (docker ps --filter "name=^/$Container$" --format '{{.Names}}') -join ''
if ($running.Trim() -ne $Container) { Fail "Container '$Container' is not running." }

# 2. Database must be reachable and must be the expected one.
$dbName = (docker exec $Container psql -U $User -d $Database -tAc 'SELECT current_database()') -join ''
if ($LASTEXITCODE -ne 0) { Fail "Cannot connect to database '$Database' in container '$Container'." }
if ($dbName.Trim() -ne $Database) { Fail "Connected to '$($dbName.Trim())' but expected '$Database'." }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss')
$suffix = ''
if ($Label) { $suffix = "_$Label" }
$dumpName = "$Database$suffix`_$stamp.dump"
$globalsName = "globals$suffix`_$stamp.sql"
$inContainer = "/tmp/$dumpName"
$inContainerGlobals = "/tmp/$globalsName"
$hostDump = Join-Path $BackupDir $dumpName
$hostGlobals = Join-Path $BackupDir $globalsName

Write-Host "Backing up '$Database' from '$Container' ..."

# 3. Dump inside the container (custom format -> supports pg_restore -l).
docker exec $Container pg_dump -U $User -Fc -f $inContainer $Database | Out-Null
if ($LASTEXITCODE -ne 0) {
  docker exec $Container rm -f $inContainer | Out-Null
  Fail 'pg_dump failed inside the container.'
}

# 4. Verify the archive is readable BEFORE copying it out.
$toc = (docker exec $Container pg_restore -l $inContainer) -join "`n"
if ($LASTEXITCODE -ne 0 -or -not $toc.Trim()) {
  docker exec $Container rm -f $inContainer | Out-Null
  Fail 'pg_restore -l could not read the archive; dump discarded.'
}

# 5. Cluster-global roles (not included in a single-database pg_dump).
$globalsOk = $true
docker exec $Container pg_dumpall -U $User --globals-only -f $inContainerGlobals | Out-Null
if ($LASTEXITCODE -ne 0) { $globalsOk = $false }

# 6. Binary-safe transfer to the host.
docker cp "$Container`:$inContainer" "$hostDump" | Out-Null
if ($LASTEXITCODE -ne 0) {
  docker exec $Container rm -f $inContainer | Out-Null
  Fail 'docker cp of the dump failed.'
}
if ($globalsOk) {
  docker cp "$Container`:$inContainerGlobals" "$hostGlobals" | Out-Null
  if ($LASTEXITCODE -ne 0) { $globalsOk = $false }
}

# 7. Remove container-side temporary files.
docker exec $Container rm -f $inContainer | Out-Null
docker exec $Container rm -f $inContainerGlobals | Out-Null

# 8. Host-side verification.
if (-not (Test-Path $hostDump)) { Fail 'Dump file is missing on the host after copy.' }
$file = Get-Item $hostDump
if ($file.Length -le 0) {
  Remove-Item $hostDump -Force
  Fail 'Copied dump is zero bytes; discarded.'
}
$sha = (Get-FileHash -Path $hostDump -Algorithm SHA256).Hash.ToLower()

$pgVersion = ((docker exec $Container psql -U $User -d $Database -tAc 'SHOW server_version') -join '').Trim()
$gitCommit = ((git -C $repoRoot rev-parse --short HEAD) -join '').Trim()
if (-not $gitCommit) { $gitCommit = 'unknown' }
$migration = ((docker exec $Container psql -U $User -d $Database -tAc 'SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 1') -join '').Trim()
if (-not $migration) { $migration = 'unknown' }

$globalsValue = $null
if ($globalsOk) { $globalsValue = $globalsName }

$meta = [ordered]@{
  timestamp       = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  database        = $Database
  label           = $Label
  postgresVersion = $pgVersion
  format          = 'custom (pg_dump -Fc)'
  dumpFile        = $dumpName
  globalsFile     = $globalsValue
  bytes           = $file.Length
  sha256          = $sha
  archiveVerified = $true
  gitCommit       = $gitCommit
  latestMigration = $migration
  source          = 'manual'
}
$metaPath = Join-Path $BackupDir ([IO.Path]::GetFileNameWithoutExtension($dumpName) + '.meta.json')
($meta | ConvertTo-Json) | Out-File -FilePath $metaPath -Encoding utf8

Write-Host ''
Write-Host 'BACKUP OK'
Write-Host "  file    : $hostDump"
Write-Host "  bytes   : $($file.Length)"
Write-Host "  sha256  : $sha"
Write-Host '  archive : pg_restore -l PASS'
Write-Host "  meta    : $metaPath"
if (-not $globalsOk) { Write-Host '  note    : globals dump unavailable (not required for application restore)' }

if (-not $SkipOffsite) {
  $backupBucket = $env:R2_BACKUP_BUCKET_NAME
  if (-not $backupBucket -and (Test-Path $envFile)) {
    $bucketLine = Select-String -Path $envFile -Pattern '^\s*R2_BACKUP_BUCKET_NAME\s*=' | Select-Object -First 1
    if ($bucketLine) {
      $backupBucket = ($bucketLine.Line -replace '^\s*R2_BACKUP_BUCKET_NAME\s*=', '').Trim().Trim('"').Trim("'")
    }
  }

  if ($backupBucket) {
    Write-Host ''
    Write-Host '=================================================='
    Write-Host ' AUTOMATED R2 OFFSITE SYNC'
    Write-Host '=================================================='
    $backupClass = if ($Label -match 'PROTECTED') { 'PROTECTED_BASELINE' } else { 'AUTOMATIC' }
    $checkpointLabel = if ($Label) { $Label } else { 'manual' }
    try {
      npx ts-node "$repoRoot/scripts/db-backup-offsite.ts" --file "$hostDump" --checkpoint "$checkpointLabel" --class "$backupClass" --no-restore-drill
    } catch {
      Write-Host "Warning: Automated R2 sync failed: $_"
      Write-Host 'Local backup is intact.'
    }
  } else {
    Write-Host '  note    : R2 offsite sync skipped (R2_BACKUP_BUCKET_NAME not set)'
  }
}

exit 0
