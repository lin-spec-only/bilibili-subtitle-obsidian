const ALLOWED_AUDIO_DOMAINS = ["bilivideo.com", "hdslb.com"];

function isDomain(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function normalizeBilibiliAudioUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !isDomain(host, ALLOWED_AUDIO_DOMAINS)
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

export function buildLocalAsrPayload(result) {
  const bvid = String(result?.video?.bvid || "").trim();
  const cid = String(result?.selectedPage?.cid || "").trim();
  const part = Number(result?.selectedPage?.page);
  const audioUrls = [...new Set((result?.audio?.urls || []).map(normalizeBilibiliAudioUrl).filter(Boolean))].slice(0, 4);
  if (!/^BV[0-9A-Za-z]+$/.test(bvid) || !/^\d+$/.test(cid) || !Number.isInteger(part) || part < 1) {
    throw new Error("当前视频缺少可转写的分P信息");
  }
  if (!audioUrls.length) {
    throw new Error(result?.audioError || "没有取得当前分P的音频地址");
  }
  return {
    audio_urls: audioUrls,
    source_url: String(result.sourceUrl || ""),
    bvid,
    cid,
    part,
    duration_seconds: Number(result?.selectedPage?.duration) || Number(result?.video?.duration) || 0
  };
}

export function isValidLocalAsrJobId(jobId) {
  return /^[0-9a-f-]{36}$/.test(String(jobId || ""));
}

export function transcriptionIdentity(result) {
  return `${String(result?.video?.bvid || "")}:${String(result?.selectedPage?.cid || "")}`;
}

export function mergeLocalAsrTrack(result, track) {
  if (!track || !Array.isArray(track.body) || !track.body.length) {
    throw new Error("本地服务没有返回有效字幕");
  }
  const tracks = (Array.isArray(result?.tracks) ? result.tracks : []).filter(
    (item) => item?.source !== "local-asr"
  );
  return { ...result, subtitleStatus: "available", tracks: [...tracks, track] };
}

