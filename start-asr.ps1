$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = "D:\Tech_learn_envs\bilibili-asr\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
  throw "Local ASR is not installed. Run setup-asr.ps1 first: $RepoRoot\setup-asr.ps1"
}

$ExistingListener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue
if ($ExistingListener) {
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/health" -TimeoutSec 2
    if ($Health.ok -eq $true -and $Health.version) {
      Write-Host "Local ASR is already running on http://127.0.0.1:8766 (version $($Health.version))."
      exit 0
    }
  } catch {
    # The occupied port belongs to another application.
  }
  throw "Port 8766 is already occupied by another application (PID $($ExistingListener.OwningProcess))."
}

$env:HF_HOME = "D:\AI_Models\huggingface"
$env:BILIBILI_ASR_MODEL_DIR = "D:\AI_Models\faster-whisper"
$env:BILIBILI_ASR_DATA_DIR = "D:\BilibiliASR"
$env:BILIBILI_ASR_MODEL = if ($env:BILIBILI_ASR_MODEL) { $env:BILIBILI_ASR_MODEL } else { "small" }
$env:BILIBILI_ASR_DEVICE = if ($env:BILIBILI_ASR_DEVICE) { $env:BILIBILI_ASR_DEVICE } else { "cpu" }
$env:BILIBILI_ASR_COMPUTE_TYPE = if ($env:BILIBILI_ASR_COMPUTE_TYPE) { $env:BILIBILI_ASR_COMPUTE_TYPE } else { "int8" }

Set-Location $RepoRoot
& $VenvPython -m uvicorn asr_service.app.main:app --host 127.0.0.1 --port 8766
