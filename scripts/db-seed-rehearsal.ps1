<#
.SYNOPSIS
  Rehearse the full reconstruction (migration history + seed) on a disposable
  PostgreSQL 15 database. Never touches the development database.

.DESCRIPTION
  Mandatory gate before reseeding the real development database. It proves:
    1. the entire prisma/migrations chain applies cleanly to an empty database,
    2. `prisma db seed` completes successfully against that schema,
    3. which canonical fixtures the seed actually creates.

  Uses its own container, volume and host port (5434) so neither the
  development database (5432) nor the Prisma shadow database (5433) is touched.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-seed-rehearsal.ps1
#>
param(
  [int]$HostPort = 5434,
  [switch]$KeepContainer
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$rehearsalId = 'kltn-seed-rehearsal'
$rehearsalVolume = "$rehearsalId-data"
$rehearsalDb = 'kltn_rehearsal'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Cleanup {
  if ($KeepContainer) {
    Write-Host "  (container $rehearsalId kept for inspection)"
    return
  }
  docker rm -f $rehearsalId | Out-Null
  docker volume rm $rehearsalVolume | Out-Null
}

function Fail($message) {
  Write-Host ''
  Write-Host '=================================================='
  Write-Host ' SEED REHEARSAL FAILED'
  Write-Host '=================================================='
  Write-Host " $message"
  Write-Host ' The real development database was NOT touched.'
  Write-Host ' DO NOT RESEED.'
  Write-Host '=================================================='
  Cleanup
  exit 1
}

# Start clean even if a previous rehearsal was interrupted.
docker rm -f $rehearsalId | Out-Null
docker volume rm $rehearsalVolume | Out-Null

Write-Host "Starting disposable rehearsal PostgreSQL 15 on port $HostPort ..."
docker run -d --name $rehearsalId -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=$rehearsalDb -p "$HostPort`:5432" -v "$rehearsalVolume`:/var/lib/postgresql/data" postgres:15-alpine | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Could not start the rehearsal container.' }

$ready = $false
foreach ($i in 1..40) {
  Start-Sleep -Seconds 2
  docker exec $rehearsalId pg_isready -U postgres -d $rehearsalDb | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) { Fail 'Rehearsal PostgreSQL never became ready.' }

$rehearsalUrl = "postgresql://postgres:rehearsal@localhost:$HostPort/$rehearsalDb`?schema=public"

Push-Location $repoRoot
try {
  # 1. Full migration history must apply to an empty database.
  Write-Host 'Applying full migration history (prisma migrate deploy) ...'
  $env:DATABASE_URL = $rehearsalUrl
  $deployOut = (npx prisma migrate deploy 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    Write-Host $deployOut
    Fail 'prisma migrate deploy failed against the rehearsal database.'
  }
  $migrationCount = ((docker exec $rehearsalId psql -U postgres -d $rehearsalDb -tAc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL') -join '').Trim()
  Write-Host "  migrations applied: $migrationCount"
  if ([int]$migrationCount -le 0) { Fail 'No migrations recorded as applied.' }

  # 2. Canonical seed must succeed against that schema.
  Write-Host 'Running canonical seed (prisma db seed) ...'
  $seedOut = (npx prisma db seed 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    Write-Host ($seedOut -split "`n" | Select-Object -Last 25)
    Fail 'prisma db seed failed against the rehearsal database.'
  }
  Write-Host '  seed: PASS'
}
finally {
  Pop-Location
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
}

# 3. Report what the seed actually created.
$tables = @('User', 'Course', 'Lesson', 'Quiz', 'Question', 'Exam', 'ToeicExamSet', 'ToeicQuestionGroup', 'ToeicQuestion', 'ToeicAssessment', 'ToeicAttempt', 'SpeakingPracticeSet', 'SpeakingExercise', 'ToeicWritingSet', 'VocabWord', 'GrammarTopic', 'MarketProduct')
$inList = ($tables | ForEach-Object { "'$_'" }) -join ','
$countSql = 'SELECT relname || ''='' || (xpath(''/row/c/text()'', query_to_xml(''SELECT count(*) AS c FROM '' || quote_ident(relname), false, true, '''')))[1]::text FROM pg_class WHERE relnamespace = ''public''::regnamespace AND relkind = ''r'' AND relname IN (' + $inList + ') ORDER BY relname'
$countLines = docker exec $rehearsalId psql -U postgres -d $rehearsalDb -tAc $countSql
if ($LASTEXITCODE -ne 0) { Fail 'Fixture count query failed.' }

Write-Host ''
Write-Host 'SEED FIXTURE COUNTS (rehearsal database)'
$pairs = @()
foreach ($line in $countLines) {
  $text = "$line".Trim()
  if (-not $text) { continue }
  Write-Host "  $text"
  $pairs += $text
}

# 4. Canonical identifiers the project treats as protected/baseline.
$idSql = "SELECT 'ToeicExamSet:1=' || (SELECT count(*) FROM ""ToeicExamSet"" WHERE id = 1) UNION ALL SELECT 'ToeicExamSet:2=' || (SELECT count(*) FROM ""ToeicExamSet"" WHERE id = 2) UNION ALL SELECT 'Exam:1=' || (SELECT count(*) FROM ""Exam"" WHERE id = 1) UNION ALL SELECT 'Exam:22=' || (SELECT count(*) FROM ""Exam"" WHERE id = 22) UNION ALL SELECT 'Exam:23=' || (SELECT count(*) FROM ""Exam"" WHERE id = 23) UNION ALL SELECT 'Exam:69=' || (SELECT count(*) FROM ""Exam"" WHERE id = 69) UNION ALL SELECT 'ToeicAssessment:15=' || (SELECT count(*) FROM ""ToeicAssessment"" WHERE id = 15) UNION ALL SELECT 'ToeicAssessment:16=' || (SELECT count(*) FROM ""ToeicAssessment"" WHERE id = 16)"
# Double quotes are doubled above for PowerShell; write SQL to a file to avoid
# native-argument quote mangling entirely.
$sqlFile = Join-Path $env:TEMP 'kltn-rehearsal-ids.sql'
$idSql | Out-File -FilePath $sqlFile -Encoding ascii
docker cp "$sqlFile" "$rehearsalId`:/tmp/ids.sql" | Out-Null
$idLines = docker exec $rehearsalId psql -U postgres -d $rehearsalDb -tAf /tmp/ids.sql
Write-Host ''
Write-Host 'CANONICAL IDENTIFIERS (1 = present, 0 = absent)'
foreach ($line in $idLines) {
  $text = "$line".Trim()
  if ($text) { Write-Host "  $text" }
}
Remove-Item $sqlFile -ErrorAction SilentlyContinue

Cleanup

Write-Host ''
Write-Host 'SEED REHEARSAL PASSED'
Write-Host "  migrations applied : $migrationCount"
Write-Host '  seed               : PASS'
Write-Host ('REHEARSAL_COUNTS ' + ($pairs -join ';'))
exit 0
