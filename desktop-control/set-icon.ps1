param([Parameter(Mandatory=$true)][ValidateSet('on','off')][string]$State)
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'AI Workspace T8 검증.lnk'
if (-not (Test-Path -LiteralPath $link)) { return }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.IconLocation = "$(Split-Path -Parent $MyInvocation.MyCommand.Path)\workspace-$State.ico,0"
$shortcut.Save()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WorkspaceIconRefresh {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern void SHChangeNotify(uint eventId, uint flags, string item, IntPtr unused);
}
'@
[WorkspaceIconRefresh]::SHChangeNotify(0x00002000,0x0005,$link,[IntPtr]::Zero)
[WorkspaceIconRefresh]::SHChangeNotify(0x08000000,0,[string]$null,[IntPtr]::Zero)
