import {
  isAllowedBilibiliHost,
  normalizeVideoInput,
  toUserErrorMessage
} from "./lib/core.js";
import {
  persistExtractionState,
  startExtractionState
} from "./lib/extract-state.js";

const EXTRACT_MESSAGE = "extract-bilibili-subtitle";
const HELPER_TIMEOUT_MS = 35_000;
const SUBTITLE_FETCH_TIMEOUT_MS = 15_000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== EXTRACT_MESSAGE) {
    return false;
  }

  extractAndPersist(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: toUserError(error) }));
  return true;
});

export async function extractAndPersist(message) {
  const sourceInput = String(message?.url ?? "");
  const normalizedUrl = normalizeVideoInput(sourceInput);
  const tabId = normalizeTabId(message?.tabId);
  const requestedPart = normalizePartNumber(message?.part);
  const startedAt = new Date().toISOString();

  await startExtractionState(chrome.storage, sourceInput, startedAt);

  try {
    const result = await extractThroughCurrentTab(tabId, normalizedUrl, requestedPart);
    const state = {
      status: "success",
      completedAt: new Date().toISOString(),
      result
    };
    await persistExtractionState(chrome.storage, state);
    return result;
  } catch (error) {
    const userError = toUserError(error);
    await persistExtractionState(chrome.storage, {
      status: "error",
      completedAt: new Date().toISOString(),
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
    // 此函数会序列化后注入页面，不能引用后台脚本作用域中的常量。
    const pageSubtitlePollAttempts = 4;
    const pageSubtitlePollIntervalMs = 100;
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
    const initialState = window.__INITIAL_STATE__ || {};
    const pageFromUrl = Number(new URL(href).searchParams.get("p"));
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
    const readPageSubtitleEntries = async () => {
      if (requestedPart && requestedPart !== loadedPage) {
        return [];
      }
      let entries = [];
      for (let attempt = 0; attempt < pageSubtitlePollAttempts; attempt += 1) {
        entries = [
          ...getPlayerSubtitleEntries(window.__playinfo__),
          ...getPlayerSubtitleEntries(initialState?.playinfo),
          ...getPlayerSubtitleEntries(initialState?.playInfo)
        ];
        if (entries.some((entry) => String(entry?.subtitle_url || "").trim())) {
          break;
        }
        if (attempt < pageSubtitlePollAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, pageSubtitlePollIntervalMs));
        }
      }
      return entries;
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
    const bvid =
      href.match(/\b(BV[0-9A-Za-z]+)\b/i)?.[1] ||
      initialState.bvid ||
      initialState.videoData?.bvid ||
      "";
    const aid =
      href.match(/\/video\/av(\d+)/i)?.[1] ||
      initialState.aid ||
      initialState.videoData?.aid ||
      "";

    if (!bvid && !aid) {
      throw new Error("没有从该页面识别到视频编号，请确认链接指向普通 B 站视频");
    }

    // 页面播放器和视频信息接口互不依赖，必须并发读取，避免轮询拖慢首屏结果。
    const pageSubtitleEntriesPromise = readPageSubtitleEntries();
    const query = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${encodeURIComponent(aid)}`;
    const viewResponse = await fetchJson(
      `https://api.bilibili.com/x/web-interface/view?${query}`
    );
    if (viewResponse?.code !== 0 || !viewResponse?.data) {
      throw new Error(viewResponse?.message || "无法读取视频信息，视频可能不可访问");
    }

    const video = viewResponse.data;
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
    const viewSubtitleEntries = Array.isArray(video.subtitle?.list)
      ? video.subtitle.list
      : [];
    const playerQuery = new URLSearchParams({
      bvid: effectiveBvid,
      cid: String(selectedPage.cid),
      aid: String(video.aid || aid)
    }).toString();
    const playerEndpoints = [
      `https://api.bilibili.com/x/player/wbi/v2?${playerQuery}`,
      `https://api.bilibili.com/x/player/v2?${playerQuery}`
    ];

    const [pageSubtitleEntries, playerResponses] = await Promise.all([
      pageSubtitleEntriesPromise,
      Promise.all(
        playerEndpoints.map(async (endpoint) => {
          try {
            return { response: await fetchJson(endpoint) };
          } catch (error) {
            return { error };
          }
        })
      )
    ]);

    let firstSuccessfulPlayer = null;
    const subtitleCandidates = [...viewSubtitleEntries, ...pageSubtitleEntries];
    let needLoginSubtitle = false;
    let lastPlayerError = "";
    for (const result of playerResponses) {
      if (result.error) {
        lastPlayerError = result.error?.message || String(result.error);
        continue;
      }
      const response = result.response;
      if (response?.code !== 0 || !response?.data) {
        lastPlayerError = response?.message || `接口返回代码 ${response?.code}`;
        continue;
      }
      firstSuccessfulPlayer ||= response.data;
      needLoginSubtitle ||= response.data?.need_login_subtitle === true;
      const entries = response.data?.subtitle?.subtitles;
      if (Array.isArray(entries) && entries.length) {
        subtitleCandidates.push(...entries);
      }
    }

    const subtitleEntries = mergeSubtitleEntries(subtitleCandidates);

    if (!firstSuccessfulPlayer && !subtitleEntries.length) {
      throw new Error(lastPlayerError || "无法读取播放器字幕信息");
    }

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
