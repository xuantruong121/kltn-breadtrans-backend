<#
.SYNOPSIS
  Prove a backup is restorable by restoring it into a throwaway PostgreSQL 15
  container and querying the result. Never touches the development database.

.DESCRIPTION
  A backup is not trusted because pg_dump exited 0. This drill:
    1. starts a disposable postgres:15-alpine container (NO published host port),
    2. restores the chosen .dump archive with pg_restore,
    3. verifies schema, _prisma_migrations and core tables exist,
    4. prints row counts for comparison against the live database,
    5. destroys the container and its volume.

  Written for Windows PowerShell 5.1: $ErrorActionPreference stays 'Continue'
  so native-command stderr cannot raise NativeCommandError; docker results are
  checked explicitly via $LASTEXITCODE.

.PARAMETER DumpFile
  Path to the .dump archive. Defaults to the newest *.dump in the backup dir.

.PARAMETER ExpectCounts
  Optional "Table=Count;Table=Count" assertions, used to compare a restored
  copy against the live database.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-restore-drill.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-restore-drill.ps1 -ExpectCounts "User=2;ToeicExamSet=2"
#>
param(
  [string]$DumpFile = '',
  [string]$BackupDir = '',
  [string]$ExpectCounts = '',
  [switch]$LearnerCatalogAssertions
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$drillId = 'kltn-restore-drill-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$drillVolume = "$drillId-data"
$restoreDb = 'kltn_restore_test'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Cleanup {
  docker rm -f $drillId | Out-Null
  docker volume rm $drillVolume | Out-Null
}

function Fail($message) {
  Write-Host ''
  Write-Host '=================================================='
  Write-Host ' RESTORE DRILL FAILED'
  Write-Host '=================================================='
  Write-Host " $message"
  Write-Host '=================================================='
  Cleanup
  exit 1
}

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

if (-not $DumpFile) {
  $newest = Get-ChildItem -Path $BackupDir -Filter '*.dump' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { Fail "No .dump files found in $BackupDir" }
  $DumpFile = $newest.FullName
}
if (-not (Test-Path $DumpFile)) { Fail "Dump file not found: $DumpFile" }

$dumpItem = Get-Item $DumpFile
$dumpSha = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash.ToLower()
Write-Host "Restore drill for: $($dumpItem.Name) ($($dumpItem.Length) bytes)"
Write-Host "  sha256: $dumpSha"

# 1. Disposable server, same major version, deliberately NO published port.
Write-Host "Starting disposable PostgreSQL 15 container $drillId ..."
docker run -d --name $drillId -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=$restoreDb -v "$drillVolume`:/var/lib/postgresql/data" postgres:15-alpine | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Could not start the disposable container.' }

# 2. Wait for readiness.
$ready = $false
foreach ($i in 1..40) {
  Start-Sleep -Seconds 2
  docker exec $drillId pg_isready -U postgres -d $restoreDb | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) { Fail 'Disposable PostgreSQL never became ready.' }

# 3. Copy archive in and verify its table of contents.
docker cp "$DumpFile" "$drillId`:/tmp/restore.dump" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'docker cp into the drill container failed.' }

$toc = (docker exec $drillId pg_restore -l /tmp/restore.dump) -join "`n"
if ($LASTEXITCODE -ne 0 -or -not $toc.Trim()) { Fail 'pg_restore -l could not read the archive.' }
Write-Host '  archive table of contents: PASS'

# 4. Restore. pg_restore can emit benign notices; correctness is proven by
#    the structural queries below, so only a hard failure aborts here.
$restoreOut = (docker exec $drillId pg_restore -U postgres -d $restoreDb --no-owner --no-privileges /tmp/restore.dump 2>&1) -join "`n"
$restoreExit = $LASTEXITCODE
if ($restoreExit -ne 0) {
  Write-Host "  pg_restore exit code: $restoreExit (checking whether schema still restored)"
  $preview = ($restoreOut -split "`n" | Select-Object -First 5) -join ' | '
  Write-Host "  pg_restore output: $preview"
}

# 5. Structural checks.
$tableCount = ((docker exec $drillId psql -U postgres -d $restoreDb -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") -join '').Trim()
if ($LASTEXITCODE -ne 0) { Fail 'Cannot query the restored database.' }
if ([int]$tableCount -le 0) { Fail 'Restored database has no public tables.' }
Write-Host "  public tables restored: $tableCount"

$hasMigrations = ((docker exec $drillId psql -U postgres -d $restoreDb -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'") -join '').Trim()
if ($hasMigrations -ne '1') { Fail '_prisma_migrations table is missing from the restored database.' }
Write-Host '  _prisma_migrations present: PASS'

# 6. Core table existence + row counts (names verified against schema.prisma).
#    One single-quoted SQL statement: PowerShell 5.1 mangles embedded double
#    quotes when passing args to native commands, so quoted identifiers are
#    built server-side with quote_ident() instead.
$coreTables = @('User', 'Course', 'Lesson', 'Exam', 'ToeicExamSet', 'ToeicQuestionGroup', 'ToeicQuestion', 'ToeicAssessment', 'ToeicAttempt')
$inList = ($coreTables | ForEach-Object { "'$_'" }) -join ','
$countSql = 'SELECT relname || ''='' || (xpath(''/row/c/text()'', query_to_xml(''SELECT count(*) AS c FROM '' || quote_ident(relname), false, true, '''')))[1]::text FROM pg_class WHERE relnamespace = ''public''::regnamespace AND relkind = ''r'' AND relname IN (' + $inList + ') ORDER BY relname'

$countLines = docker exec $drillId psql -U postgres -d $restoreDb -tAc $countSql
if ($LASTEXITCODE -ne 0) { Fail 'Row-count query failed on the restored database.' }

$results = [ordered]@{}
foreach ($line in $countLines) {
  $text = "$line".Trim()
  if (-not $text) { continue }
  $kv = $text.Split('=')
  if ($kv.Count -ne 2) { continue }
  $results[$kv[0].Trim()] = [int]$kv[1].Trim()
}

# Every expected core table must have reported a count — a missing entry means
# the table did not restore, which must fail loudly rather than read as zero.
foreach ($t in $coreTables) {
  if (-not $results.Contains($t)) {
    Fail "Core table '$t' did not restore (no row count returned)."
  }
  Write-Host ("  {0,-20} {1}" -f $t, $results[$t])
}

$migrationRows = ((docker exec $drillId psql -U postgres -d $restoreDb -tAc 'SELECT count(*) FROM "_prisma_migrations"') -join '').Trim()
Write-Host "  _prisma_migrations rows: $migrationRows"

# 7. Optional exact-count assertions (compare restored copy vs live DB).
if ($ExpectCounts) {
  foreach ($pair in $ExpectCounts.Split(';')) {
    if (-not $pair.Trim()) { continue }
    $parts = $pair.Split('=')
    $table = $parts[0].Trim()
    $expected = [int]$parts[1].Trim()
    if ($results[$table] -ne $expected) {
      Fail "Count mismatch for $table : restored=$($results[$table]) expected=$expected"
    }
    Write-Host "  assert $table = $expected : PASS"
  }
}

# Optional application-level assertions for the learner recovery baseline.
# These are deliberately separate from row counts: a database can restore
# structurally while still losing publication or media-reference semantics.
if ($LearnerCatalogAssertions) {
  $assertSql = @'
SELECT 'flashcard_published_topics=' || count(*) FROM "VocabTopic" WHERE "categoryName" <> 'SYSTEM_DICTIONARY' AND "publicationStatus" = 'PUBLISHED';
SELECT 'course_non_beginner=' || count(*) FROM "Course" WHERE "level" <> 'BEGINNER';
SELECT 'general_speaking_visible=' || count(*) FROM "SpeakingExercise" WHERE "practiceSetId" IS NULL AND "publicationStatus" = 'PUBLISHED';
SELECT 'listening_q27_audio_refs=' || count(*) FROM "QuizAudioAsset" WHERE "questionId" = 27 AND "isActive" = true AND "key" = 'catalog/listening/practice/audio/quiz-9/question-27/v1.mp3';
SELECT 'toeic_published_products=' || count(*) FROM "Exam" WHERE "variantCode" IN ('TOEIC_LR', 'TOEIC_SW', 'TOEIC_4_SKILLS') AND "publicationStatus" = 'PUBLISHED';
'@
  $assertFile = Join-Path $env:TEMP 'kltn-restore-learner-assertions.sql'
  $assertSql | Out-File -FilePath $assertFile -Encoding ascii
  docker cp "$assertFile" "$drillId`:/tmp/learner-assertions.sql" | Out-Null
  Remove-Item $assertFile -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0) { Fail 'Could not copy learner assertion SQL into the drill container.' }
  $assertLines = docker exec $drillId psql -U postgres -d $restoreDb -tAf /tmp/learner-assertions.sql
  if ($LASTEXITCODE -ne 0) { Fail 'Learner catalog assertions could not run.' }
  $expectedAssertions = @{ flashcard_published_topics = 8; course_non_beginner = 0; general_speaking_visible = 30; listening_q27_audio_refs = 1; toeic_published_products = 3 }
  foreach ($line in $assertLines) {
    $parts = "$line".Trim().Split('=')
    if ($parts.Count -ne 2) { continue }
    $name = $parts[0]
    $value = [int]$parts[1]
    if (-not $expectedAssertions.ContainsKey($name) -or $value -ne $expectedAssertions[$name]) {
      Fail "Learner catalog assertion failed: $name=$value"
    }
    Write-Host "  assert $name = $value : PASS"
  }
}

Cleanup

Write-Host ''
Write-Host 'RESTORE DRILL PASSED'
Write-Host "  dump           : $($dumpItem.Name)"
Write-Host "  disposable env : destroyed ($drillId / $drillVolume)"
Write-Host ''
Write-Host ('DRILL_COUNTS ' + (($results.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ';'))
exit 0
