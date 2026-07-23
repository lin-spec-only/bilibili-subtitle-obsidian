$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvRoot = "D:\Tech_learn_envs\bilibili-asr"
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"
$PythonSource = "D:\Anaconda\python.exe"

$env:UV_CACHE_DIR = "D:\Tech_learn_envs\uv-cache"
$env:HF_HOME = "D:\AI_Models\huggingface"
$env:BILIBILI_ASR_MODEL_DIR = "D:\AI_Models\faster-whisper"
$env:BILIBILI_ASR_DATA_DIR = "D:\BilibiliASR"

@($env:UV_CACHE_DIR, $env:HF_HOME, $env:BILIBILI_ASR_MODEL_DIR, $env:BILIBILI_ASR_DATA_DIR) |
  ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

if (-not (Test-Path -LiteralPath $VenvPython)) {
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv was not found. Expected C:\Users\Lin\AppData\Local\hermes\bin\uv.exe."
  }
  if (-not (Test-Path -LiteralPath $PythonSource)) {
    throw "D-drive Python was not found: $PythonSource"
  }
  uv venv $VenvRoot --python $PythonSource
}

uv pip install --python $VenvPython -r (Join-Path $RepoRoot "asr_service\requirements.txt")
& $VenvPython -c "import fastapi, faster_whisper, httpx, uvicorn; print('Local ASR environment is ready')"
