$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostSource = Join-Path $RepoRoot "native_host\BilibiliAsrHost.cs"
$HostManifest = Join-Path $RepoRoot "native_host\com.bilibili_subtitle_edge.asr.json"
$InstallDir = "D:\BilibiliASR\native-host"
$Compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$ExtensionId = "bihhhefhgkfgbfecinaibjhkbjdaopcd"

if (-not (Test-Path -LiteralPath $Compiler)) {
  throw "Windows .NET compiler was not found: $Compiler"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$OutputExe = Join-Path $InstallDir "BilibiliAsrHost.exe"
& $Compiler "/nologo" "/target:exe" "/out:$OutputExe" $HostSource
if ($LASTEXITCODE -ne 0) { throw "Native host compilation failed." }

$InstalledManifest = Join-Path $InstallDir "com.bilibili_subtitle_edge.asr.json"
Copy-Item -LiteralPath $HostManifest -Destination $InstalledManifest -Force
$RegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bilibili_subtitle_edge.asr"
New-Item -Path $RegistryPath -Force | Out-Null
New-ItemProperty -Path $RegistryPath -Name "(Default)" -Value $InstalledManifest -PropertyType String -Force | Out-Null

Write-Host "Native host installed. Reload the extension in edge://extensions."
Write-Host "Bound extension ID: $ExtensionId"
