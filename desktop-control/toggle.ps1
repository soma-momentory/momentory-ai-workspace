$ErrorActionPreference = 'Stop'
$control = Split-Path -Parent $MyInvocation.MyCommand.Path
$status = & (Get-Command node.exe -ErrorAction Stop).Source --no-warnings (Join-Path $control 'control.mjs') status
if ($LASTEXITCODE -ne 0) { throw 'Workspace 상태 조회에 실패했습니다.' }
if ($status -eq 'ON') {
  & (Join-Path $control 'stop.ps1')
} elseif ($status -eq 'OFF') {
  & (Join-Path $control 'start.ps1')
} else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Workspace 소유권 상태가 $status 입니다. 기존 서버와 상태 파일을 확인하세요.",'AI Workspace 상태 확인 필요') | Out-Null
  exit 1
}
