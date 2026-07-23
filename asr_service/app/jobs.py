from __future__ import annotations

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from .config import Settings
from .downloader import JobCancelledError, download_audio
from .security import validate_audio_url, validate_source_url
from .transcriber import WhisperTranscriber


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Job:
    id: str
    cache_key: str
    audio_urls: list[str] = field(repr=False)
    source_url: str = field(repr=False)
    bvid: str = ""
    cid: str = ""
    part: int = 1
    duration_seconds: float = 0
    language: str | None = None
    status: str = "queued"
    progress: float = 0
    message: str = "等待转写"
    result: dict | None = None
    error: str | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 3),
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class JobManager:
    def __init__(self, settings: Settings, downloader=download_audio, transcriber=None):
        settings.ensure_directories()
        self.settings = settings
        self.downloader = downloader
        self.transcriber = transcriber or WhisperTranscriber(settings)
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bili-asr")

    def create(self, payload: dict) -> dict:
        audio_urls = [validate_audio_url(url) for url in payload.get("audio_urls", [])][:4]
        if not audio_urls:
            raise ValueError("没有可用的 B 站音频地址")
        source_url = validate_source_url(payload.get("source_url", ""))
        bvid = str(payload.get("bvid", "")).strip()
        cid = str(payload.get("cid", "")).strip()
        part = int(payload.get("part") or 1)
        duration = max(0.0, float(payload.get("duration_seconds") or 0))
        language = str(payload.get("language") or "").strip() or None
        if not bvid.startswith("BV") or not bvid[2:].isalnum() or not cid.isdigit() or part < 1:
            raise ValueError("视频或分 P 标识无效")
        cache_key = hashlib.sha256(
            f"{bvid}:{cid}:{self.settings.model_name}:{language or 'auto'}".encode()
        ).hexdigest()
        with self.lock:
            for job in self.jobs.values():
                if job.cache_key == cache_key and job.status in {"queued", "downloading", "transcribing"}:
                    return job.public()
            job = Job(
                id=str(uuid4()), cache_key=cache_key, audio_urls=audio_urls,
                source_url=source_url, bvid=bvid, cid=cid, part=part,
                duration_seconds=duration, language=language,
            )
            cached = self._load_cache(cache_key)
            if cached:
                job.status, job.progress, job.message, job.result = "completed", 1.0, "已读取本地缓存", cached
            self.jobs[job.id] = job
        if job.status != "completed":
            self.executor.submit(self._run, job)
        return job.public()

    def get(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            return job.public()

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            if job.status not in {"completed", "failed", "cancelled"}:
                job.cancel_event.set()
                self._update(job, status="cancelled", message="转写已取消")
            return job.public()

    def _update(self, job: Job, **values) -> None:
        for key, value in values.items():
            setattr(job, key, value)
        job.updated_at = _now()

    def _run(self, job: Job) -> None:
        try:
            with TemporaryDirectory(dir=self.settings.temp_dir) as temp:
                audio_path = Path(temp) / "source.audio"
                with self.lock:
                    self._update(job, status="downloading", message="正在下载当前分P音频", progress=0.01)
                self.downloader(
                    job.audio_urls, audio_path, job.source_url,
                    self.settings.max_audio_bytes, self.settings.download_timeout_seconds,
                    job.cancel_event, lambda p: self._set_progress(job, p),
                )
                with self.lock:
                    self._update(job, status="transcribing", message="正在本地识别语音", progress=0.2)
                result = self.transcriber.transcribe(
                    audio_path, job.duration_seconds, job.language,
                    job.cancel_event, lambda p: self._set_progress(job, p),
                )
                if job.cancel_event.is_set():
                    raise JobCancelledError("转写已取消")
                track = {
                    "id": f"local-asr-{self.settings.model_name}",
                    "language": result["language"],
                    "languageLabel": f"本地 AI 转写 · Whisper {self.settings.model_name}",
                    "isAi": True,
                    "source": "local-asr",
                    "body": result["body"],
                }
                self._save_cache(job.cache_key, track)
                with self.lock:
                    self._update(job, status="completed", message="本地转写完成", progress=1.0, result={"track": track})
        except JobCancelledError:
            with self.lock:
                self._update(job, status="cancelled", message="转写已取消")
        except Exception as error:
            with self.lock:
                self._update(job, status="failed", message="本地转写失败", error=str(error))

    def _set_progress(self, job: Job, progress: float) -> None:
        with self.lock:
            if job.status != "cancelled":
                self._update(job, progress=max(job.progress, min(0.99, float(progress))))

    def _cache_path(self, key: str) -> Path:
        return self.settings.cache_dir / f"{key}.json"

    def _load_cache(self, key: str) -> dict | None:
        path = self._cache_path(key)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return payload if isinstance(payload.get("track", {}).get("body"), list) else None
        except (OSError, ValueError, AttributeError):
            return None

    def _save_cache(self, key: str, track: dict) -> None:
        path = self._cache_path(key)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"track": track}, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)
