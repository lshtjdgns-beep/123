# 워치독(scripts/supervisor.mjs)을 창 없이 띄운다.
#   powershell -ExecutionPolicy Bypass -File scripts\start-supervisor-hidden.ps1            # 지금 실행
#   powershell -ExecutionPolicy Bypass -File scripts\start-supervisor-hidden.ps1 -Install   # 로그인 시 자동 시작 등록
param([switch]$Install, [switch]$Uninstall)

$root = Split-Path -Parent $PSScriptRoot
$startupDir = [Environment]::GetFolderPath('Startup')
$startupCmd = Join-Path $startupDir 'naver-blog-supervisor.cmd'

if ($Uninstall) {
  if (Test-Path $startupCmd) { Remove-Item $startupCmd; Write-Host "자동 시작 해제: $startupCmd" }
  exit 0
}

if ($Install) {
  # ⚠ 시작프로그램 .cmd는 [System.Text.Encoding]::Default(ANSI/CP949) + CRLF로 저장한다.
  #   UTF-8이나 LF로 저장하면 한글 경로/주석이 있을 때 cmd.exe가 파싱을 깨서 명령 자체가 깨진다.
  $lines = @(
    '@echo off',
    "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  )
  [System.IO.File]::WriteAllText($startupCmd, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::Default)
  Write-Host "자동 시작 등록: $startupCmd"
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
Start-Process -FilePath $node -ArgumentList "`"$root\scripts\supervisor.mjs`"" -WorkingDirectory $root -WindowStyle Hidden
