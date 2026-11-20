# dsh-connect-deveco — cross-integrity-level fallback stop.
#
# The repo's stop-windows.ps1 uses Stop-Process / taskkill, which fail with
# "Access is denied" when the proxy was started elevated (High integrity) while
# DSH's plugin shell runs at Medium integrity. WMI's Win32_Process.Terminate()
# executes through the WMI service (SYSTEM) and succeeds across integrity
# levels, so this script terminates the port owner and its supervisor parent.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File stop-proxy-wmi.ps1 -Port 17128
param(
  [int]$Port = 17128
)

$ErrorActionPreference = 'Continue'
$myPid = $PID

function Get-ListenerPids([int]$p) {
  $pids = @()
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      foreach ($c in $conns) {
        $owner = [int]$c.OwningProcess
        if ($owner -gt 0 -and $owner -ne $myPid -and $pids -notcontains $owner) { $pids += $owner }
      }
    }
  } catch {}
  return $pids
}

# Collect the whole chain: listeners + their parents (the daemon supervisor).
# Parents are terminated FIRST so a listener cannot be respawned.
$targets = @()
foreach ($lp in (Get-ListenerPids $Port)) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$lp" -ErrorAction SilentlyContinue
  if ($proc -and $proc.ParentProcessId -gt 0) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
    if ($parent -and $parent.Name -eq 'node.exe' -and $parent.ProcessId -ne $myPid -and $targets -notcontains $parent.ProcessId) {
      $targets += [int]$parent.ProcessId
    }
  }
  if ($targets -notcontains $lp) { $targets += [int]$lp }
}

# Also stop the supervisor recorded in the repo's pid file, if any.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir 'proxy-daemon.pid'
if (Test-Path $pidFile) {
  $raw = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($raw -match '^\d+$') {
    $dp = [int]$raw
    if ($dp -ne $myPid -and $targets -notcontains $dp) { $targets += $dp }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$stopped = $false
foreach ($pidToKill in $targets) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToKill" -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  try {
    $r = Invoke-CimMethod -InputObject $p -MethodName Terminate -ErrorAction Stop
    if ($r.ReturnValue -eq 0) {
      Write-Output "WMI-terminated PID $pidToKill ($($p.Name))."
      $stopped = $true
    } else {
      Write-Output "WMI Terminate PID $pidToKill returned $($r.ReturnValue)."
    }
  } catch {
    Write-Output "WMI Terminate PID $pidToKill failed: $($_.Exception.Message)"
  }
}

Start-Sleep -Milliseconds 600
$remaining = Get-ListenerPids $Port
if ($remaining.Count -gt 0) {
  Write-Output "Port $Port still listening (PID(s): $($remaining -join ', '))."
  exit 1
}
if (-not $stopped) {
  Write-Output "Nothing to stop (no listener on port $Port)."
} else {
  Write-Output "Port $Port is now free."
}
exit 0
