from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    data_dir: Path
    model_dir: Path
    model_name: str
    device: str
    compute_type: str
    max_audio_bytes: int
    download_timeout_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host="127.0.0.1",
            port=_positive_int("BILIBILI_ASR_PORT", 8766),
            data_dir=Path(os.getenv("BILIBILI_ASR_DATA_DIR", "D:/BilibiliASR")),
            model_dir=Path(os.getenv("BILIBILI_ASR_MODEL_DIR", "D:/AI_Models/faster-whisper")),
            model_name=os.getenv("BILIBILI_ASR_MODEL", "small").strip() or "small",
            device=os.getenv("BILIBILI_ASR_DEVICE", "cpu").strip() or "cpu",
            compute_type=os.getenv("BILIBILI_ASR_COMPUTE_TYPE", "int8").strip() or "int8",
            max_audio_bytes=_positive_int("BILIBILI_ASR_MAX_AUDIO_BYTES", 1024 * 1024 * 1024),
            download_timeout_seconds=_positive_int("BILIBILI_ASR_DOWNLOAD_TIMEOUT", 600),
        )

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def temp_dir(self) -> Path:
        return self.data_dir / "tmp"

    def ensure_directories(self) -> None:
        for path in (self.data_dir, self.cache_dir, self.temp_dir, self.model_dir):
            path.mkdir(parents=True, exist_ok=True)
