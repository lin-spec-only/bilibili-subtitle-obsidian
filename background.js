import {
  isAllowedBilibiliHost,
  normalizeVideoInput,
  toUserErrorMessage
} from "./lib/core.js";
import {
  persistExtractionState,
  startExtractionState,
  buildExtractionScope
} from "./lib/extract-state.js";
import { buildLocalAsrPayload, isValidLocalAsrJobId } from "./lib/local-asr.js";

const EXTRACT_MESSAGE = "extract-bilibili-subtitle";
const START_ASR_MESSAGE = "start-local-asr";
const GET_ASR_MESSAGE = "get-local-asr";
const CANCEL_ASR_MESSAGE = "cancel-local-asr";
const CONTROL_ASR_SERVICE_MESSAGE = "control-local-asr-service";
const LOCAL_ASR_BASE_URL = "http://127.0.0.1:8766";
const NATIVE_HOST_NAME = "com.bilibili_subtitle_edge.asr";
const LOCAL_ASR_CLIENT = "bilibili-subtitle-edge-v1";
const HELPER_TIMEOUT_MS = 35_000;
const SUBTITLE_FETCH_TIMEOUT_MS = 15_000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let task;
  if (message?.type === EXTRACT_MESSAGE) {
    task = extractAndPersist(message);
  } else if (message?.type === START_ASR_MESSAGE) {
    task = startLocalAsr(message?.result);
  } else if (message?.type === GET_ASR_MESSAGE) {
    task = getLocalAsr(message?.jobId);
  } else if (message?.type === CANCEL_ASR_MESSAGE) {
    task = cancelLocalAsr(message?.jobId);
  } else if (message?.type === CONTROL_ASR_SERVICE_MESSAGE) {
    task = controlLocalAsrService(message?.action);
  } else {
    return false;
  }

  task
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: toUserError(error) }));
  return true;
});

export async function controlLocalAsrService(action) {
  if (action !== "start" && action !== "stop") {
    throw new Error("本地服务操作无效");
  }
  const response = await sendNativeMessage({ action });
  if (!response?.ok) {
    throw new Error(response?.error || "本地服务控制失败");
  }
  return response;
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (error) {
      reject(new Error(`本机控制组件不可用，请先运行 install-native-host.ps1：${error?.message || error}`));
      return;
    }
    const finish = (callback) => (value) => {
      if (!settled) {
        settled = true;
        try { port.disconnect(); } catch { /* Native host already closed. */ }
        callback(value);
      }
    };
    port.onMessage.addListener(finish(resolve));
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || "本机控制组件已断开";
      finish(reject)(new Error(error));
    });
    port.postMessage(message);
  });
}

export async function startLocalAsr(result) {
  return requestLocalAsr("/v1/jobs", {
    method: "POST",
    body: JSON.stringify(buildLocalAsrPayload(result))
  });
}

export async function getLocalAsr(jobId) {
  if (!isValidLocalAsrJobId(jobId)) {
    throw new Error("本地转写任务编号无效");
  }
  return requestLocalAsr(`/v1/jobs/${jobId}`);
}

export async function cancelLocalAsr(jobId) {
  if (!isValidLocalAsrJobId(jobId)) {
    throw new Error("本地转写任务编号无效");
  }
  return requestLocalAsr(`/v1/jobs/${jobId}`, { method: "DELETE" });
}

async function requestLocalAsr(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${LOCAL_ASR_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Bilibili-ASR-Client": LOCAL_ASR_CLIENT,
        ...(options.headers || {})
      },
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || `本地转写服务请求失败（HTTP ${response.status}）`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("本地转写服务响应超时");
    }
    if (/Failed to fetch|NetworkError/i.test(String(error?.message || error))) {
      throw new Error("未连接到本地转写服务，请先运行 start-asr.ps1");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractAndPersist(message) {
  const sourceInput = String(message?.url ?? "");
  const normalizedUrl = normalizeVideoInput(sourceInput);
  const tabId = normalizeTabId(message?.tabId);
  const requestedPart = normalizePartNumber(message?.part);
  const scope = buildExtractionScope(tabId, normalizedUrl, requestedPart);
  const startedAt = new Date().toISOString();

  await startExtractionState(chrome.storage, sourceInput, startedAt, scope);

  try {
    const result = await extractThroughCurrentTab(tabId, normalizedUrl, requestedPart);
    const state = {
      status: "success",
      completedAt: new Date().toISOString(),
      scope: { ...scope, bvid: String(result?.video?.bvid || scope.bvid).toUpperCase(), part: result?.selectedPage?.page || scope.part },
      result
    };
    await persistExtractionState(chrome.storage, state);
    return result;
  } catch (error) {
    const userError = toUserError(error);
    await persistExtractionState(chrome.storage, {
      status: "error",
      completedAt: new Date().toISOString(),
      scope,
      error: userError
    });
    throw error;
  }
}

async function extractThroughCurrentTab(tabId, url, requestedPart) {
  if (tabId === null) {
    throw new Error("请从需要提取字幕的 B 站视频页打开扩展");
  }

  const readyTab = await waitForTabReady(tabId, HELPER_TIMEOUT_MS);
  const finalUrl = new URL(readyTab.url || url);
  if (!isAllowedBilibiliHost(finalUrl.hostname) || finalUrl.hostname.endsWith("b23.tv")) {
    throw new Error("当前标签页不是有效的 B 站视频页");
  }

  const execution = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: collectSubtitleInPage,
    args: [requestedPart]
  });
  const payload = execution?.[0]?.result;
  if (!payload?.ok) {
    throw new Error(payload?.error || "B 站页面没有返回字幕数据");
  }
  return hydrateSubtitleTracks(payload.result);
}

export async function hydrateSubtitleTracks(result) {
  const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
  const hydratedTracks = await Promise.all(
    tracks.map(async (track) => {
      const hasBody = Array.isArray(track?.body) && track.body.length > 0;
      const subtitleUrl = toExtensionSubtitleUrl(track?.subtitleUrl);
      if (hasBody || !subtitleUrl) {
        return track;
      }
      try {
        const body = await downloadSubtitleBody(subtitleUrl);
        const { error: _error, ...trackWithoutError } = track;
        return { ...trackWithoutError, body };
      } catch (error) {
        return {
          ...track,
          body: [],
          error:
            error?.name === "AbortError"
              ? "字幕文件下载超时，请稍后重试"
              : error?.message || "字幕文件下载失败"
        };
      }
    })
  );
  const hasUsableSubtitle = hydratedTracks.some(
    (track) => Array.isArray(track?.body) && track.body.length > 0
  );
  return {
    ...result,
    tracks: hydratedTracks,
    subtitleStatus: hasUsableSubtitle
      ? "available"
      : hydratedTracks.length
        ? "download-failed"
        : result?.subtitleStatus || "none"
  };
}

async function downloadSubtitleBody(subtitleUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBTITLE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(subtitleUrl, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`字幕文件下载失败（HTTP ${response.status}）`);
    }
    const subtitle = await response.json();
    const body = Array.isArray(subtitle?.body) ? subtitle.body : [];
    if (!body.length) {
      throw new Error("字幕文件内容为空");
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function toExtensionSubtitleUrl(rawUrl) {
  const source = String(rawUrl || "").trim();
  if (!source) {
    return "";
  }
  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      (host !== "hdslb.com" && !host.endsWith(".hdslb.com"))
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

async function waitForTabReady(tabId, timeoutMs) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete" && current.url) {
    return current;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("视频页加载超时，请检查网络后重试"));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete" && tab.url) {
        cleanup();
        resolve(tab);
      }
    };

    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error("用于读取字幕的临时标签页被提前关闭"));
      }
    };

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

function normalizePartNumber(value) {
  const part = Number(value);
  return Number.isInteger(part) && part > 0 ? part : null;
}

function normalizeTabId(value) {
  const tabId = Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function toUserError(error) {
  return toUserErrorMessage(error);
}

export async function collectSubtitleInPage(requestedPart) {
  try {
    const fetchJson = async (url, timeoutMs = 15_000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`请求失败（HTTP ${response.status}）`);
        }
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    const href = window.location.href;
    const currentUrl = new URL(href);
    const initialState = window.__INITIAL_STATE__ || {};
    const pageFromUrl = Number(currentUrl.searchParams.get("p"));
    const loadedPage = Number.isInteger(pageFromUrl) && pageFromUrl > 0 ? pageFromUrl : 1;
    const getPlayerSubtitleEntries = (payload) => {
      let parsedPayload = payload;
      if (typeof parsedPayload === "string") {
        try {
          parsedPayload = JSON.parse(parsedPayload);
        } catch {
          return [];
        }
      }
      const candidates = [
        parsedPayload?.data,
        parsedPayload?.result,
        parsedPayload
      ];
      return candidates.flatMap((candidate) =>
        Array.isArray(candidate?.subtitle?.subtitles) ? candidate.subtitle.subtitles : []
      );
    };
    const getPlayerAudioEntries = (payload) => {
      let parsedPayload = payload;
      if (typeof parsedPayload === "string") {
        try {
          parsedPayload = JSON.parse(parsedPayload);
        } catch {
          return [];
        }
      }
      const candidates = [parsedPayload?.data, parsedPayload?.result, parsedPayload];
      return candidates.flatMap((candidate) =>
        Array.isArray(candidate?.dash?.audio) ? candidate.dash.audio : []
      );
    };
    const mergeSubtitleEntries = (entries) => {
      const merged = new Map();
      entries.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const key = String(
          entry.id_str || entry.id || entry.lan || entry.subtitle_url || `track-${index}`
        );
        const existing = merged.get(key);
        const hasUrl = Boolean(String(entry.subtitle_url || "").trim());
        const existingHasUrl = Boolean(String(existing?.subtitle_url || "").trim());
        if (!existing || (hasUrl && !existingHasUrl)) {
          merged.set(key, entry);
        }
      });
      return [...merged.values()];
    };
    const pathBvid = currentUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || "";
    const queryBvid = String(currentUrl.searchParams.get("bvid") || "").trim();
    const urlBvid =
      pathBvid || (/^BV[0-9A-Za-z]+$/i.test(queryBvid) ? queryBvid : "");
    const urlAid = currentUrl.pathname.match(/\/video\/av(\d+)/i)?.[1] || "";
    const bvid =
      urlBvid ||
      (!urlAid ? initialState.bvid || initialState.videoData?.bvid || "" : "");
    const aid =
      urlAid ||
      (!urlBvid ? initialState.aid || initialState.videoData?.aid || "" : "");

    if (!bvid && !aid) {
      throw new Error("没有从该页面识别到视频编号，请确认链接指向普通 B 站视频");
    }

    const query = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${encodeURIComponent(aid)}`;
    const viewResponse = await fetchJson(
      `https://api.bilibili.com/x/web-interface/view?${query}`
    );
    if (viewResponse?.code !== 0 || !viewResponse?.data) {
      throw new Error(viewResponse?.message || "无法读取视频信息，视频可能不可访问");
    }

    const video = viewResponse.data;
    if (
      urlBvid &&
      String(video.bvid || "").toUpperCase() !== String(urlBvid).toUpperCase()
    ) {
      throw new Error("视频页面与 B 站接口返回的 BV 号不一致，请刷新页面后重试");
    }
    if (urlAid && String(video.aid || "") !== String(urlAid)) {
      throw new Error("视频页面与 B 站接口返回的 AV 号不一致，请刷新页面后重试");
    }
    const pages = Array.isArray(video.pages) ? video.pages : [];
    if (!pages.length) {
      throw new Error("视频没有可读取的分P信息");
    }

    const desiredPart =
      Number.isInteger(requestedPart) && requestedPart > 0
        ? requestedPart
        : Number.isInteger(pageFromUrl) && pageFromUrl > 0
          ? pageFromUrl
          : 1;
    const selectedPage = pages.find((page) => Number(page.page) === desiredPart);
    if (!selectedPage) {
      throw new Error(`该视频没有第 ${desiredPart} 个分P`);
    }

    const effectiveBvid = video.bvid || bvid;
    const playerQuery = new URLSearchParams({
      bvid: effectiveBvid,
      cid: String(selectedPage.cid),
      aid: String(video.aid || aid)
    }).toString();
    const playerEndpoints = [
      `https://api.bilibili.com/x/player/wbi/v2?${playerQuery}`,
      `https://api.bilibili.com/x/player/v2?${playerQuery}`
    ];

    let playerData = null;
    let lastPlayerError = "";
    for (const endpoint of playerEndpoints) {
      try {
        const response = await fetchJson(endpoint);
        if (response?.code !== 0 || !response?.data) {
          lastPlayerError = response?.message || `接口返回代码 ${response?.code}`;
          continue;
        }
        playerData = response.data;
        break;
      } catch (error) {
        lastPlayerError = error?.message || String(error);
      }
    }

    if (!playerData) {
      throw new Error(lastPlayerError || "无法读取播放器字幕信息");
    }

    // B 站是单页应用，window.__playinfo__ 和 __INITIAL_STATE__.playinfo 可能在
    // 切换视频后残留旧数据。只接受显式携带当前 bvid/cid 请求得到的字幕。
    // wbi 主接口成功时，其空字幕结果就是当前播放器的最终结论；只有请求失败
    // 或返回错误码时才会进入上面的下一接口，不能合并次接口的内部占位轨。
    const needLoginSubtitle = playerData?.need_login_subtitle === true;
    const subtitleEntries = mergeSubtitleEntries(
      Array.isArray(playerData?.subtitle?.subtitles)
        ? playerData.subtitle.subtitles
        : []
    );

    const tracks = subtitleEntries.map((entry, index) => {
        const language = String(entry.lan || `track-${index + 1}`);
        const languageLabel = String(entry.lan_doc || entry.lan || `字幕 ${index + 1}`);
        const rawUrl = String(entry.subtitle_url || "");
        const subtitleUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
        const baseTrack = {
          id: String(entry.id ?? index),
          language,
          languageLabel,
          isAi:
            /AI|自动生成/i.test(languageLabel) ||
            Number(entry.ai_type) > 0 ||
            Number(entry.type) === 1,
          body: []
        };

        if (!subtitleUrl) {
          return { ...baseTrack, error: "字幕轨没有下载地址" };
        }
        return { ...baseTrack, subtitleUrl };
      });

    let audio = null;
    let audioError = "";
    if (!tracks.some((track) => track.subtitleUrl) && !needLoginSubtitle) {
      try {
        const playQuery = new URLSearchParams({
          bvid: effectiveBvid,
          cid: String(selectedPage.cid),
          qn: "16",
          fnver: "0",
          fnval: "16",
          fourk: "0"
        }).toString();
        const playResponse = await fetchJson(
          `https://api.bilibili.com/x/player/playurl?${playQuery}`,
          20_000
        );
        if (playResponse?.code !== 0) {
          throw new Error(playResponse?.message || "B 站没有返回音频信息");
        }
        const entries = getPlayerAudioEntries(playResponse).sort(
          (left, right) => Number(left?.bandwidth || 0) - Number(right?.bandwidth || 0)
        );
        const selectedAudio = entries[0];
        const urls = [
          selectedAudio?.baseUrl,
          selectedAudio?.base_url,
          ...(selectedAudio?.backupUrl || []),
          ...(selectedAudio?.backup_url || [])
        ]
          .map((value) => String(value || "").trim())
          .filter((value, index, all) => value.startsWith("https://") && all.indexOf(value) === index);
        if (!urls.length) {
          throw new Error("当前分P没有可用的 DASH 音频地址");
        }
        audio = {
          urls,
          bandwidth: Number(selectedAudio?.bandwidth) || 0,
          codecs: String(selectedAudio?.codecs || "")
        };
      } catch (error) {
        audioError = error?.message || "无法读取当前分P音频";
      }
    }

    const hasUsableSubtitle = tracks.some(
      (track) => Array.isArray(track.body) && track.body.length > 0
    );
    const subtitleStatus = hasUsableSubtitle
      ? "available"
      : subtitleEntries.length
        ? "download-failed"
        : needLoginSubtitle
          ? "login-required"
          : "none";

    return {
      ok: true,
      result: {
        sourceUrl: href,
        extractedAt: new Date().toISOString(),
        video: {
          bvid: String(video.bvid || bvid),
          aid: String(video.aid || aid),
          title: String(video.title || document.title || "B站视频"),
          duration: Number(video.duration) || 0,
          ownerName: String(video.owner?.name || ""),
          publishedAt: Number(video.pubdate)
            ? new Date(Number(video.pubdate) * 1000).toISOString()
            : "",
          coverUrl: String(video.pic || ""),
          description: String(video.desc || "")
        },
        pages: pages.map((page, index) => ({
          page: Number(page.page) || index + 1,
          cid: String(page.cid),
          part: String(page.part || `P${index + 1}`),
          duration: Number(page.duration) || 0
        })),
        selectedPage: {
          page: Number(selectedPage.page) || desiredPart,
          cid: String(selectedPage.cid),
          part: String(selectedPage.part || `P${desiredPart}`),
          duration: Number(selectedPage.duration) || 0
        },
        audio,
        audioError,
        subtitleStatus,
        tracks
      }
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.name === "AbortError"
          ? "B 站接口请求超时，请稍后重试"
          : error?.message || String(error)
    };
  }
}
