$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$control = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $message = & $node --no-warnings (Join-Path $control 'control.mjs') stop 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($message | Out-String) }
  $status = & $node --no-warnings (Join-Path $control 'control.mjs') status
  if ($status -ne 'OFF') { throw "종료 후 상태가 $status 입니다. 아이콘을 변경하지 않았습니다." }
  & (Join-Path $control 'set-icon.ps1') off
  [System.Windows.Forms.MessageBox]::Show('AI Workspace가 정상 종료되었습니다.','AI Workspace 꺼짐') | Out-Null
} catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'AI Workspace 종료 실패') | Out-Null
  exit 1
}
