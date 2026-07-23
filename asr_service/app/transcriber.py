from __future__ import annotations

import threading
from pathlib import Path

from .config import Settings
from .downloader import JobCancelledError


class WhisperTranscriber:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._model = None
        self._lock = threading.Lock()

    def _get_model(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                self._model = WhisperModel(
                    self.settings.model_name,
                    device=self.settings.device,
                    compute_type=self.settings.compute_type,
                    download_root=str(self.settings.model_dir),
                    cpu_threads=max(1, min(8, __import__("os").cpu_count() or 4)),
                    num_workers=1,
                )
            return self._model

    def transcribe(
        self,
        audio_path: Path,
        duration_hint: float,
        language: str | None,
        cancel_event: threading.Event,
        progress_callback,
    ) -> dict:
        model = self._get_model()
        segments, info = model.transcribe(
            str(audio_path),
            language=language or None,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        duration = max(float(duration_hint or 0), float(getattr(info, "duration", 0) or 0), 1.0)
        body = []
        for segment in segments:
            if cancel_event.is_set():
                raise JobCancelledError("转写已取消")
            content = " ".join(str(segment.text or "").split())
            if content:
                body.append(
                    {
                        "from": round(max(0.0, float(segment.start)), 3),
                        "to": round(max(float(segment.start), float(segment.end)), 3),
                        "content": content,
                    }
                )
            progress_callback(0.2 + min(0.79, float(segment.end) / duration * 0.79))
        if not body:
            raise RuntimeError("语音识别没有生成有效文字")
        return {
            "body": body,
            "language": str(getattr(info, "language", "") or language or "auto"),
            "language_probability": float(getattr(info, "language_probability", 0) or 0),
        }

