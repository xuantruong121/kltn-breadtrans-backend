param(
  [ValidateSet('Init','Run1','Verify1','Run2','Verify2','Cleanup')]
  [string]$Stage,
  [int]$HostPort = 5435
)

$ErrorActionPreference = 'Stop'
$name = 'kltn-full-canonical-rehearsal'; $volume = "$name-data"; $db = 'kltn_full_rehearsal'
$root = Split-Path -Parent $PSScriptRoot
if ($HostPort -in 5432,5433) { throw 'Refusing a live/shadow PostgreSQL port.' }
$url = "postgresql://postgres:rehearsal@localhost:$HostPort/$db`?schema=public"

function Exists { return [bool](docker ps -a --filter "name=^/$name$" --format '{{.Names}}') }
function Require-Rehearsal {
  if (-not (Exists)) { throw 'Rehearsal container is absent. Run -Stage Init first.' }
  $actual = docker exec $name psql -U postgres -d $db -Atc 'SELECT current_database()'
  if ("$actual".Trim() -ne $db) { throw 'Refusing an unexpected database target.' }
}
function Run([string]$label, [scriptblock]$command) {
  Write-Host "== $label =="; & $command
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE). Container retained for forensics." }
}
function Invoke-Canonical([string]$run, [bool]$seed) {
  if ($seed) { Run "$run seed" { npx prisma db seed } }
  Run "$run sequence resync" { npx ts-node scripts/db-resync-sequences.ts }
  Run "$run plans" { npx ts-node scripts/bootstrap-plan-catalog.ts }
  Run "$run premium rollout" { npx ts-node scripts/rollout-premium-content.ts --apply }
  Run "$run foundation courses" { npx ts-node scripts/reconstruct-foundation-courses.ts }
  Run "$run IPA course" { npx ts-node scripts/reconstruct-ipa-course.ts }
  Run "$run course covers" { npx ts-node scripts/relink-course-covers.ts }
  Run "$run TOEIC runtime" { npx ts-node scripts/reconstruct-canonical-toeic.ts }
  Run "$run TOEIC L&R Phase-0 media relink" { npx ts-node scripts/materialize-exam1-listening-phase0.ts --exam=1 --reuse-existing }
  Run "$run sequence check" { npx ts-node scripts/db-resync-sequences.ts --check }
  Run "$run TOEIC validator" { npx ts-node scripts/verify-canonical-baseline.ts }
}
function Snapshot([string]$file) {
  Run "snapshot $file" { npx ts-node scripts/snapshot-canonical-rehearsal.ts "--output=artifacts/$file" }
}

switch ($Stage) {
  'Init' {
    if (Exists) { throw 'Rehearsal already exists; use the next stage or Cleanup explicitly.' }
    docker run -d --name $name -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=$db -p "$HostPort`:5432" -v "$volume`:/var/lib/postgresql/data" postgres:15-alpine | Out-Null
    foreach ($i in 1..40) { Start-Sleep -Seconds 2; docker exec $name pg_isready -U postgres -d $db | Out-Null; if ($LASTEXITCODE -eq 0) { break }; if ($i -eq 40) { throw 'Disposable PostgreSQL did not become ready.' } }
    $env:DATABASE_URL=$url; Push-Location $root; try { Run 'migrations' { npx prisma migrate deploy } } finally { Pop-Location; Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }
    Write-Host 'REHEARSAL_INIT_PASS=true'
  }
  'Run1' { Require-Rehearsal; $env:DATABASE_URL=$url; Push-Location $root; try { Invoke-Canonical 'run-1' $true } finally { Pop-Location; Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }; Write-Host 'RUN1_PASS=true' }
  'Verify1' { Require-Rehearsal; $env:DATABASE_URL=$url; Push-Location $root; try { Snapshot 'full-rehearsal-run1.json' } finally { Pop-Location; Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }; Write-Host 'VERIFY1_PASS=true'; Write-Host 'FRESH_RECONSTRUCTION_FIRST_RUN_PASS=true' }
  'Run2' { Require-Rehearsal; $env:DATABASE_URL=$url; Push-Location $root; try { Invoke-Canonical 'run-2' $false } finally { Pop-Location; Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }; Write-Host 'RUN2_PASS=true' }
  'Verify2' { Require-Rehearsal; $env:DATABASE_URL=$url; Push-Location $root; try { Snapshot 'full-rehearsal-run2.json'; Run 'compare snapshots' { npx ts-node scripts/compare-canonical-rehearsal.ts --before=artifacts/full-rehearsal-run1.json --after=artifacts/full-rehearsal-run2.json --output=artifacts/full-rehearsal-diff.json } } finally { Pop-Location; Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }; Write-Host 'FRESH_RECONSTRUCTION_SECOND_RUN_PASS=true'; Write-Host 'CANONICAL_RECONSTRUCTION_REPEATABLE=true' }
  'Cleanup' { cmd /c "docker rm -f $name >nul 2>nul" | Out-Null; cmd /c "docker volume rm $volume >nul 2>nul" | Out-Null; Write-Host 'REHEARSAL_CLEANUP_DONE=true' }
}
