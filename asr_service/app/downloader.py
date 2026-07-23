from __future__ import annotations

import threading
from pathlib import Path
from urllib.parse import urljoin

import httpx

from .security import validate_audio_url, validate_source_url


class JobCancelledError(RuntimeError):
    pass


def download_audio(
    urls: list[str],
    destination: Path,
    source_url: str,
    max_bytes: int,
    timeout_seconds: int,
    cancel_event: threading.Event,
    progress_callback,
) -> None:
    safe_source = validate_source_url(source_url)
    errors: list[str] = []
    for candidate in urls:
        try:
            _download_one(
                validate_audio_url(candidate),
                destination,
                safe_source,
                max_bytes,
                timeout_seconds,
                cancel_event,
                progress_callback,
            )
            return
        except JobCancelledError:
            raise
        except Exception as error:  # 尝试 B 站提供的备用 CDN 地址。
            errors.append(str(error))
            destination.unlink(missing_ok=True)
    raise RuntimeError(errors[-1] if errors else "没有可下载的音频地址")


def _download_one(
    url: str,
    destination: Path,
    source_url: str,
    max_bytes: int,
    timeout_seconds: int,
    cancel_event: threading.Event,
    progress_callback,
) -> None:
    headers = {
        "Referer": source_url,
        "User-Agent": "BilibiliSubtitleLocalASR/0.4",
        "Accept": "audio/*,application/octet-stream;q=0.9,*/*;q=0.1",
    }
    timeout = httpx.Timeout(timeout_seconds, connect=20.0)
    current_url = url
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        for _ in range(4):
            if cancel_event.is_set():
                raise JobCancelledError("转写已取消")
            with client.stream("GET", current_url, headers=headers) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise RuntimeError("音频 CDN 重定向缺少地址")
                    current_url = validate_audio_url(urljoin(current_url, location))
                    continue
                response.raise_for_status()
                content_length = int(response.headers.get("content-length") or 0)
                if content_length > max_bytes:
                    raise RuntimeError("音频文件超过本地服务大小限制")
                downloaded = 0
                with destination.open("wb") as output:
                    for chunk in response.iter_bytes(1024 * 1024):
                        if cancel_event.is_set():
                            raise JobCancelledError("转写已取消")
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise RuntimeError("音频文件超过本地服务大小限制")
                        output.write(chunk)
                        if content_length:
                            progress_callback(min(0.2, downloaded / content_length * 0.2))
                if downloaded == 0:
                    raise RuntimeError("B 站返回了空音频文件")
                progress_callback(0.2)
                return
    raise RuntimeError("音频 CDN 重定向次数过多")

