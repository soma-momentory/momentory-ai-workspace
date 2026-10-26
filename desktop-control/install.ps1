$ErrorActionPreference = 'Stop'
$control = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $control
$desktop = [Environment]::GetFolderPath('Desktop')
$original = Join-Path $desktop 'AI Workspace 원본.lnk'
$link = Join-Path $desktop 'AI Workspace T8 검증.lnk'
$backup = Join-Path $workspace 'data\desktop-shortcut-before-t8c.lnk'
if ((Test-Path -LiteralPath $original) -and -not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $original -Destination $backup }
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $link) {
  $existing = $shell.CreateShortcut($link)
  if ($existing.Arguments -notlike '*C:\SWM\awt8\desktop-control\toggle.ps1*') { throw '다른 T8 바로가기가 이미 있습니다. 덮어쓰지 않았습니다.' }
}
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $control 'toggle.ps1') + '"'
$shortcut.WorkingDirectory = $workspace
$shortcut.Description = 'T8 검증용 AI Workspace 켜기 또는 정상 종료 (4178)'
$shortcut.IconLocation = "$(Join-Path $control 'workspace-off.ico'),0"
$shortcut.Save()
& (Join-Path $control 'set-icon.ps1') off
