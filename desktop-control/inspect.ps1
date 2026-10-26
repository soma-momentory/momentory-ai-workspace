param(
  [Parameter(Mandatory=$true)][ValidateSet('off','on')][string]$Mode,
  [int]$ManagerPid = 0,
  [int]$LauncherPid = 0,
  [int]$RecoveryPid = 0,
  [switch]$Snapshot
)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$expectedController = Join-Path $workspace 'desktop-control\control.mjs'
$nodes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' })
$listeners = @(Get-NetTCPConnection -LocalPort 4178 -State Listen -ErrorAction SilentlyContinue)
if ($Mode -eq 'off') {
  $ownedReservation = $RecoveryPid -gt 0 -and $listeners.Count -eq 1 -and
    $listeners[0].OwningProcess -eq $RecoveryPid -and $listeners[0].LocalAddress -eq '127.0.0.1'
  if ($listeners.Count -gt 0 -and -not $ownedReservation) { 'UNMANAGED'; exit 0 }
  if (@($nodes | Where-Object { $_.ProcessId -ne $ManagerPid -and $_.CommandLine -match 'desktop-control[/\\]control\.mjs\s+start' }).Count -gt 0) { 'UNKNOWN'; exit 0 }
  foreach ($slot in @('claude','codex')) {
    $lock = Join-Path $workspace "data\worker-$slot.lock"
    if (Test-Path -LiteralPath $lock) {
      $id = 0
      if ([int]::TryParse((Get-Content -LiteralPath $lock -Raw).Trim(),[ref]$id) -and @($nodes | Where-Object ProcessId -eq $id).Count -gt 0) { 'UNKNOWN'; exit 0 }
    }
  }
  'OFF'; exit 0
}
$manager = $nodes | Where-Object ProcessId -eq $ManagerPid | Select-Object -First 1
$launcher = $nodes | Where-Object ProcessId -eq $LauncherPid | Select-Object -First 1
$servers = @($nodes | Where-Object { $_.ParentProcessId -eq $LauncherPid -and $_.CommandLine -match 'src[/\\]server\.mjs' })
$workers = @($nodes | Where-Object { $_.ParentProcessId -eq $LauncherPid -and $_.CommandLine -match 'src[/\\]worker\.mjs' })
if (-not $manager -or $manager.CommandLine -notmatch ([regex]::Escape($expectedController) + '\s+start') -or
    -not $launcher -or $launcher.ParentProcessId -ne $ManagerPid -or $launcher.CommandLine -notmatch 'src[/\\]local\.mjs' -or
    $servers.Count -ne 1 -or $workers.Count -ne 2 -or $listeners.Count -ne 1 -or
    $listeners[0].OwningProcess -ne $servers[0].ProcessId -or $listeners[0].LocalAddress -ne '127.0.0.1') {
  'UNKNOWN'; exit 0
}
foreach ($slot in @('claude','codex')) {
  $lock = Join-Path $workspace "data\worker-$slot.lock"
  $id = 0
  if (-not (Test-Path -LiteralPath $lock) -or -not [int]::TryParse((Get-Content -LiteralPath $lock -Raw).Trim(),[ref]$id) -or
      @($workers | Where-Object ProcessId -eq $id).Count -ne 1) { 'UNKNOWN'; exit 0 }
}
if ($Snapshot) {
  function Identity($process) {
    [pscustomobject]@{ pid = [int]$process.ProcessId; started = $process.CreationDate.ToUniversalTime().ToString('o'); executable = $process.ExecutablePath }
  }
  $slots = [ordered]@{}
  foreach ($slot in @('claude','codex')) {
    $lock = Join-Path $workspace "data\worker-$slot.lock"
    $id = [int](Get-Content -LiteralPath $lock -Raw).Trim()
    $slots[$slot] = Identity ($workers | Where-Object ProcessId -eq $id | Select-Object -First 1)
  }
  [pscustomobject]@{
    status = 'ON'
    manager = Identity $manager
    launcher = Identity $launcher
    server = Identity $servers[0]
    workers = $slots
  } | ConvertTo-Json -Depth 5 -Compress
} else { 'ON' }
