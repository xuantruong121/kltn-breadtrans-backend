param(
  [int]$Port = 3101,
  [string]$LogPrefix = 'phase8121-be'
)

$env:DATABASE_URL = 'postgresql://phase812:phase812@localhost:55432/phase812_load?schema=public&connection_limit=30&pool_timeout=20'
$env:REDIS_URL = 'redis://localhost:56379'
$env:JWT_SECRET = 'phase812-isolated-jwt-secret'
$env:PORT = [string]$Port
$env:THROTTLER_LIMIT = '10000'
$env:PHASE812_RUNTIME_METRICS = 'true'

$out = Join-Path $env:TEMP "$LogPrefix.out.log"
$err = Join-Path $env:TEMP "$LogPrefix.err.log"
Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath 'node.exe' `
  -ArgumentList 'dist/src/main.js' `
  -WorkingDirectory (Join-Path $PSScriptRoot '..\..') `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -WindowStyle Hidden `
  -PassThru

$process.Id
