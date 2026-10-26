$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$control = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $control
try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $status = & $node --no-warnings (Join-Path $control 'control.mjs') status
  if ($LASTEXITCODE -ne 0 -or $status -ne 'OFF') { throw "Workspace 상태가 $status 입니다. 기존 프로세스를 확인하세요." }
  Start-Process -FilePath $node -ArgumentList @((Join-Path $control 'control.mjs'),'start') -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspace 'data\desktop-manager.stdout.log') -RedirectStandardError (Join-Path $workspace 'data\desktop-manager.stderr.log') | Out-Null
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $status = & $node --no-warnings (Join-Path $control 'control.mjs') status
    if ($LASTEXITCODE -eq 0 -and $status -eq 'ON') { $ready = $true; break }
  }
  if (-not $ready) {
    if ($status -eq 'ON') { & $node --no-warnings (Join-Path $control 'control.mjs') stop | Out-Null }
    throw 'Workspace 시작 확인에 실패했습니다. data\desktop-control.log를 확인하세요.'
  }
  & (Join-Path $control 'set-icon.ps1') on
  [System.Windows.Forms.MessageBox]::Show('AI Workspace가 실행 중입니다. 휴대폰에서는 Tailscale HTTPS 주소로 접속하세요.','AI Workspace') | Out-Null
} catch {
  $actual = & (Get-Command node.exe).Source --no-warnings (Join-Path $control 'control.mjs') status
  if ($actual -eq 'OFF') { & (Join-Path $control 'set-icon.ps1') off }
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'AI Workspace 실행 안 됨') | Out-Null
  exit 1
}
