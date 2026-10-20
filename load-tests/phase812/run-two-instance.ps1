$backend = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$databaseUrl = 'postgresql://phase812:phase812@localhost:55432/phase812_load?schema=public&connection_limit=20&pool_timeout=20'
$redisUrl = 'redis://localhost:56379'

$env:DATABASE_URL = $databaseUrl
$env:REDIS_URL = $redisUrl
$env:JWT_SECRET = 'phase8122-isolated-jwt-secret'
$env:THROTTLER_LIMIT = '10000'
$env:PHASE812_RUNTIME_METRICS = 'true'

foreach ($instance in @(@{ Name = 'a'; Port = '3101' }, @{ Name = 'b'; Port = '3102' })) {
  $env:PORT = $instance.Port
  $out = Join-Path $env:TEMP "phase8122-instance-$($instance.Name).out.log"
  $err = Join-Path $env:TEMP "phase8122-instance-$($instance.Name).err.log"
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath 'node.exe' -ArgumentList 'dist/src/main.js' -WorkingDirectory $backend -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  "INSTANCE_$($instance.Name.ToUpper())_PID=$($process.Id) PORT=$($instance.Port)"
}
