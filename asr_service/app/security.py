from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

ALLOWED_AUDIO_DOMAINS = ("bilivideo.com", "hdslb.com")
ALLOWED_SOURCE_DOMAINS = ("bilibili.com", "b23.tv")
CLIENT_HEADER_VALUE = "bilibili-subtitle-edge-v1"


def _is_domain(host: str, domains: tuple[str, ...]) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in domains)


def _validate_https_url(raw_url: str, domains: tuple[str, ...], label: str) -> str:
    value = str(raw_url or "").strip()
    if not value or len(value) > 8192:
        raise ValueError(f"{label}为空或过长")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise ValueError(f"{label}必须是安全的 HTTPS 地址")
    if parsed.port not in (None, 443):
        raise ValueError(f"{label}端口不受支持")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError(f"{label}不能使用 IP 地址")
    if not _is_domain(host, domains):
        raise ValueError(f"{label}不属于允许的 B 站域名")
    return value


def validate_audio_url(raw_url: str) -> str:
    return _validate_https_url(raw_url, ALLOWED_AUDIO_DOMAINS, "音频地址")


def validate_source_url(raw_url: str) -> str:
    return _validate_https_url(raw_url, ALLOWED_SOURCE_DOMAINS, "视频地址")

