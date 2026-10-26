# One-command development backend: `npm run dev:backend`.
#
# Starts every backend process the current configuration needs, exactly once:
#   - API (`nest start --watch`, port PORT or 3001). It also hosts the
#     in-process BullMQ consumers: Diagnostic Speaking, Diagnostic Writing,
#     system jobs, TOEIC AI exam generation, and, in SPEAKING_PIPELINE_MODE
#     legacy (the default), the ordinary Speaking DB poller.
#   - Standalone Speaking worker (queue breadtrans-speaking-assessment), only
#     when SPEAKING_PIPELINE_MODE=bullmq. In legacy mode it must stay stopped.
#
# Every child is placed in a Windows Job Object with KILL_ON_JOB_CLOSE, so
# Ctrl+C, closing the terminal, or this script dying for any reason ends the
# whole process tree, including grandchildren whose parent already exited
# (the B2B orphan incident). Nothing outside that job is ever terminated.
#
# The script refuses to start when the API port is taken or a standalone
# Speaking worker already runs; it never starts a second backend. `.env` is
# read once per process start: after editing it, stop and run again (watch
# mode reloads code changes only). The standalone scripts (`start:dev`,
# `start:speaking-worker:dev`) are unchanged.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DevBackendJob {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimit {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimit {
    public BasicLimit Basic; public IoCounters Io;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);

  public static IntPtr Create() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject failed: " + Marshal.GetLastWin32Error());
    var info = new ExtendedLimit();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    int length = Marshal.SizeOf(typeof(ExtendedLimit));
    IntPtr ptr = Marshal.AllocHGlobal(length);
    try {
      Marshal.StructureToPtr(info, ptr, false);
      if (!SetInformationJobObject(job, 9, ptr, (uint)length))
        throw new Exception("SetInformationJobObject failed: " + Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(ptr); }
    return job;
  }
  public static void Assign(IntPtr job, IntPtr process) {
    if (!AssignProcessToJobObject(job, process))
      throw new Exception("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error());
  }
}
'@

function Fail([string]$message) {
  Write-Host "[dev:backend] $message" -ForegroundColor Red
  exit 1
}

function Read-EnvValue([string]$name) {
  $fromProcess = [Environment]::GetEnvironmentVariable($name)
  if ($fromProcess) { return $fromProcess }
  $line = Get-Content (Join-Path $Root '.env') | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$name\s*=\s*", '').Trim().Trim('"').Trim("'")
}

function Test-Tcp([string]$hostName, [int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { return $client.ConnectAsync($hostName, $port).Wait(1500) } catch { return $false } finally { $client.Dispose() }
}

function Get-HostPort([string]$url, [int]$defaultPort) {
  # Only host and port are taken from the URL; credentials are never printed.
  $uri = [Uri]$url
  $port = if ($uri.Port -gt 0) { $uri.Port } else { $defaultPort }
  return @($uri.Host, $port)
}

if (-not (Test-Path (Join-Path $Root '.env'))) { Fail '.env not found in the backend directory.' }

$port = [int](Read-EnvValue 'PORT'); if (-not $port) { $port = 3001 }
$pipeline = Read-EnvValue 'SPEAKING_PIPELINE_MODE'; if (-not $pipeline) { $pipeline = 'legacy' }
if ($pipeline -ne 'legacy' -and $pipeline -ne 'bullmq') { Fail "SPEAKING_PIPELINE_MODE '$pipeline' is invalid (expected legacy or bullmq)." }
$graderMode = Read-EnvValue 'DIAGNOSTIC_GRADER_MODE'; if (-not $graderMode) { $graderMode = '(not set: diagnostic Speaking/Writing grading fails closed)' }

# Refuse to run a second backend.
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  Fail "Port $port is already in use by PID $($listener.OwningProcess) ($($owner.Name)). Stop that backend first; nothing was started."
}
$workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'speaking-worker\.main' })
if ($workers.Count) {
  Fail "A standalone Speaking worker is already running (PID $($workers.ProcessId -join ', ')). Stop it first; nothing was started."
}

# Required services.
$dbUrl = Read-EnvValue 'DATABASE_URL'
if (-not $dbUrl) { Fail 'DATABASE_URL is not set.' }
$db = Get-HostPort $dbUrl 5432
if (-not (Test-Tcp $db[0] $db[1])) { Fail "PostgreSQL is not reachable at $($db[0]):$($db[1]). Start it with: docker-compose up -d" }
$redisUrl = Read-EnvValue 'REDIS_URL'; if (-not $redisUrl) { $redisUrl = 'redis://localhost:6379' }
$redis = Get-HostPort $redisUrl 6379
if (-not (Test-Tcp $redis[0] $redis[1])) { Fail "Redis is not reachable at $($redis[0]):$($redis[1]). Start it with: docker-compose up -d" }

Write-Host "[dev:backend] API port $port | SPEAKING_PIPELINE_MODE=$pipeline | DIAGNOSTIC_GRADER_MODE=$graderMode" -ForegroundColor Cyan
Write-Host "[dev:backend] PostgreSQL $($db[0]):$($db[1]) and Redis $($redis[0]):$($redis[1]) reachable" -ForegroundColor Cyan

$job = [DevBackendJob]::Create()
$children = @()

function Start-Managed([string]$label, [string[]]$arguments) {
  $process = Start-Process -FilePath 'node' -ArgumentList $arguments -WorkingDirectory $Root -NoNewWindow -PassThru
  [DevBackendJob]::Assign($job, $process.Handle)
  Write-Host "[dev:backend] started $label (PID $($process.Id))" -ForegroundColor Cyan
  return [pscustomobject]@{ Label = $label; Process = $process }
}

try {
  $children += Start-Managed 'API (nest watch)' @('node_modules/@nestjs/cli/bin/nest.js', 'start', '--watch')
  if ($pipeline -eq 'bullmq') {
    $children += Start-Managed 'Speaking worker (node watch)' @('--watch', '--require', 'ts-node/register', 'src/worker/speaking-worker.main.ts')
  } else {
    Write-Host '[dev:backend] Speaking worker not started: legacy mode processes ordinary Speaking inside the API.' -ForegroundColor Cyan
  }
  Write-Host '[dev:backend] Press Ctrl+C to stop everything.' -ForegroundColor Cyan

  while ($true) {
    foreach ($child in $children) {
      if ($child.Process.HasExited) {
        Fail "$($child.Label) exited with code $($child.Process.ExitCode). Stopping the remaining processes."
      }
    }
    Start-Sleep -Milliseconds 1000
  }
} finally {
  Write-Host '[dev:backend] stopping managed processes...' -ForegroundColor Cyan
  foreach ($child in $children) {
    if (-not $child.Process.HasExited) { & taskkill.exe /PID $child.Process.Id /T /F 2>$null | Out-Null }
  }
  # Closing the job kills anything left in it, including re-parented descendants.
  [void][DevBackendJob]::CloseHandle($job)
  Write-Host '[dev:backend] stopped.' -ForegroundColor Cyan
}
