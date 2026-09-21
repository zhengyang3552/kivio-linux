# Pack a Windows portable zip that mirrors the NSIS install layout:
# exe + sidecar + all configured resources, unzip-and-run, no Start Menu / uninstaller.
# Output: src-tauri/target/release/bundle/portable/Kivio.Desktop_${Version}_x64-portable.zip
#
# Requires a finished `tauri build --bundles nsis` (kivio.exe in target/release).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$releaseDir = Join-Path $repoRoot 'src-tauri\target\release'
$exe = Join-Path $releaseDir 'kivio.exe'
$tauriRoot = Join-Path $repoRoot 'src-tauri'
$config = Get-Content -LiteralPath (Join-Path $tauriRoot 'tauri.conf.json') -Raw | ConvertFrom-Json
$checker = Join-Path $PSScriptRoot 'check-desktop-package.mjs'
$sidecarSrc = Join-Path $repoRoot 'src-tauri\binaries\kivio-ocr-helper-x86_64-pc-windows-msvc.exe'

& node $checker --version $Version
if ($LASTEXITCODE -ne 0) { throw 'Desktop package configuration check failed.' }
if (-not (Test-Path -LiteralPath $exe)) {
  throw "kivio.exe not found at $exe. Run tauri build first."
}
$binaryVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
if ($binaryVersion -ne $Version) {
  throw "Executable version $binaryVersion does not match portable version $Version. Rebuild first."
}

$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kivio-portable-" + [guid]::NewGuid().ToString('n'))
$appDir = Join-Path $stageRoot 'Kivio Desktop'
New-Item -ItemType Directory -Path $appDir | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $appDir 'Kivio Desktop.exe')
foreach ($resource in $config.bundle.resources.PSObject.Properties) {
  Copy-Item -LiteralPath (Join-Path $tauriRoot $resource.Name) -Destination (Join-Path $appDir $resource.Value) -Recurse
}

if (Test-Path -LiteralPath $sidecarSrc) {
  Copy-Item -LiteralPath $sidecarSrc -Destination (Join-Path $appDir 'kivio-ocr-helper.exe')
}

Get-ChildItem -LiteralPath $releaseDir -File -Filter '*.dll' -ErrorAction SilentlyContinue |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $appDir $_.Name) }

$readme = @"
Kivio Desktop 便携版 / Portable

解压到任意目录，双击「Kivio Desktop.exe」即可。无需安装，不自动创建开始菜单项。
需要已安装 Microsoft Edge WebView2（Windows 10/11 通常已有）。
设置和对话仍保存在本机用户目录，和安装版共用。
保持便携使用时，请下载新版便携 ZIP 后退出应用再替换文件；应用内更新会运行安装版安装程序。
可选的开机启动设置会注册当前程序路径；移动目录后请重新设置。

Unzip anywhere and run Kivio Desktop.exe. No installer, no Start Menu.
Requires the Edge WebView2 runtime (already on most Windows 10/11 PCs).
Settings and chats stay in your user folder and are shared with the installed app.
To stay portable, download the new portable ZIP, quit the app and replace its files.
The in-app updater runs the installed edition's installer, not a portable update.
Optional launch-at-startup registers this executable's path; reconfigure it after moving the folder.
"@
Set-Content -LiteralPath (Join-Path $appDir '使用说明.txt') -Value $readme -Encoding utf8

& node $checker --resources-dir $appDir --version $Version
if ($LASTEXITCODE -ne 0) { throw 'Portable resources do not match the source.' }

$outDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\portable'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$zipName = "Kivio.Desktop_${Version}_x64-portable.zip"
$zipPath = Join-Path $outDir $zipName
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path $appDir -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -LiteralPath $stageRoot -Recurse -Force

if (-not (Test-Path -LiteralPath $zipPath) -or (Get-Item -LiteralPath $zipPath).Length -lt 1MB) {
  throw "Portable zip missing or too small: $zipPath"
}

Write-Host "Wrote $zipPath"
