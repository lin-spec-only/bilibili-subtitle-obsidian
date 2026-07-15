const BILIBILI_HOSTS = new Set(["bilibili.com", "b23.tv"]);

export function normalizeVideoInput(rawInput) {
  const input = String(rawInput ?? "").trim();
  if (!input) {
    throw new Error("请粘贴 B 站视频链接");
  }

  const bareId = input.match(/^(BV[0-9A-Za-z]+|av\d+)$/i)?.[1];
  if (bareId) {
    return `https://www.bilibili.com/video/${bareId}`;
  }

  const matchedUrl = input.match(/https?:\/\/[^\s<>"'，。；;、！!？】＞>\])}]+/iu)?.[0];
  if (!matchedUrl) {
    throw new Error("没有识别到有效的视频链接");
  }

  const cleanedUrl = matchedUrl.replace(/[\])}】＞>，。；;、！!？?]+$/u, "");
  let url;
  try {
    url = new URL(cleanedUrl);
  } catch {
    throw new Error("视频链接格式不正确");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只支持 http 或 https 链接");
  }
  if (!isAllowedBilibiliHost(url.hostname)) {
    throw new Error("只支持 bilibili.com 或 b23.tv 链接");
  }

  return url.href;
}

export function isAllowedBilibiliHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (BILIBILI_HOSTS.has(host)) {
    return true;
  }
  return [...BILIBILI_HOSTS].some((root) => host.endsWith(`.${root}`));
}

export function isSupportedBilibiliVideoInput(rawInput) {
  try {
    const url = new URL(normalizeVideoInput(rawInput));
    if (url.hostname.toLowerCase().replace(/\.$/, "") === "b23.tv") {
      return true;
    }
    return /^\/video\/(?:BV[0-9A-Za-z]+|av\d+)\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function toUserErrorMessage(error) {
  const message = String(error?.message || error || "未知错误")
    .replace(/^Error:\s*/i, "")
    .trim();

  if (
    /Frame with ID .* is showing error page|net::ERR_|chrome-error:\/\/|Cannot access contents of url/i.test(
      message
    )
  ) {
    return "B站视频页加载失败，可能是网络连接被重置、视频失效或当前地区不可访问，请稍后重试";
  }
  if (/Could not establish connection|Receiving end does not exist/i.test(message)) {
    return "插件后台没有响应，请在 Edge 扩展页重新加载本插件后重试";
  }
  return message || "字幕提取失败";
}

export function normalizeCues(body) {
  if (!Array.isArray(body)) {
    return [];
  }

  return body
    .map((cue) => ({
      from: Number(cue?.from),
      to: Number(cue?.to),
      content: String(cue?.content ?? "").replace(/\r?\n/g, " ").trim()
    }))
    .filter(
      (cue) =>
        Number.isFinite(cue.from) &&
        Number.isFinite(cue.to) &&
        cue.from >= 0 &&
        cue.content.length > 0
    )
    .sort((left, right) => left.from - right.from);
}

export function hasUsableSubtitleContent(track) {
  return normalizeCues(track?.body).length > 0;
}

export function formatTimestamp(seconds, includeMilliseconds = false) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  let totalMilliseconds = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  totalMilliseconds -= hours * 3_600_000;
  const minutes = Math.floor(totalMilliseconds / 60_000);
  totalMilliseconds -= minutes * 60_000;
  const wholeSeconds = Math.floor(totalMilliseconds / 1000);
  const milliseconds = totalMilliseconds - wholeSeconds * 1000;

  const base = [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return includeMilliseconds
    ? `${base},${String(milliseconds).padStart(3, "0")}`
    : base;
}

export function buildPlainText(track) {
  return normalizeCues(track?.body)
    .map((cue) => cue.content)
    .join("\n");
}

export function buildTimestampText(track) {
  return normalizeCues(track?.body)
    .map((cue) => `[${formatTimestamp(cue.from)}] ${cue.content}`)
    .join("\n");
}

export function buildSrt(track) {
  return normalizeCues(track?.body)
    .map((cue, index) => {
      const safeEnd = cue.to > cue.from ? cue.to : cue.from + 2;
      return `${index + 1}\n${formatTimestamp(cue.from, true)} --> ${formatTimestamp(
        safeEnd,
        true
      )}\n${cue.content}`;
    })
    .join("\n\n");
}

export function buildMarkdown(result, track) {
  const title = cleanMetadata(result?.video?.title || "B站视频字幕");
  const part = cleanMetadata(result?.selectedPage?.part || `P${result?.selectedPage?.page || 1}`);
  const language = cleanMetadata(track?.languageLabel || track?.language || "未知");
  const sourceUrl = String(result?.sourceUrl || "").replace(/[\r\n]/g, "");
  const author = cleanMetadata(result?.video?.ownerName || "");
  const publishedAt = cleanMetadata(result?.video?.publishedAt || "");
  const extractedAt = cleanMetadata(result?.extractedAt || new Date().toISOString());
  const description = cleanMetadata(result?.video?.description || "");
  const playerUrl = buildBilibiliEmbedUrl(result);
  const lines = normalizeCues(track?.body).map(
    (cue) => `- [${formatTimestamp(cue.from)}] ${escapeMarkdownLine(cue.content)}`
  );

  return [
    "---",
    `title: ${toYamlString(title)}`,
    `source: ${toYamlString(sourceUrl)}`,
    "author:",
    ...(author ? [`  - ${toYamlString(author)}`] : []),
    `published: ${toYamlDate(publishedAt)}`,
    `created: ${toYamlDate(extractedAt)}`,
    `description: ${toYamlString(description)}`,
    "tags:",
    "  - clippings",
    "---",
    "",
    `# ${title}`,
    "",
    ...(playerUrl
      ? [
          `<iframe src="${playerUrl}" width="100%" height="360" scrolling="no" frameborder="0" allowfullscreen="true"></iframe>`,
          ""
        ]
      : []),
    "> [!abstract] 摘要",
    "> 待总结。",
    "",
    "## 视频信息",
    "",
    `- 来源：[${escapeMarkdownLine(title)}](${sourceUrl})`,
    ...(author ? [`- UP主：${escapeMarkdownLine(author)}`] : []),
    ...(publishedAt ? [`- 发布日期：${publishedAt.slice(0, 10)}`] : []),
    `- 分P：${escapeMarkdownLine(part)}`,
    `- 字幕：${escapeMarkdownLine(language)}`,
    ...(description ? [`- 简介：${escapeMarkdownLine(description)}`] : []),
    "",
    "## 我的笔记",
    "",
    "- ",
    "",
    "## 原始字幕",
    "",
    ...lines,
    ""
  ].join("\n");
}

export function buildExportFilename(result, track, extension) {
  const title = result?.video?.title || "B站字幕";
  const pageNumber = result?.selectedPage?.page || 1;
  const part = result?.selectedPage?.part || `P${pageNumber}`;
  const language = track?.languageLabel || track?.language || "字幕";
  const suffix = String(extension || "txt").replace(/^\./, "");
  return `${sanitizeFilename(`${title}-P${pageNumber}-${part}-${language}`)}.${suffix}`;
}

export function buildObsidianNoteFilename(result) {
  return `${sanitizeFilename(result?.video?.title || "B站字幕笔记")}.md`;
}

export function buildBilibiliEmbedUrl(result) {
  const bvid = String(result?.video?.bvid || "").trim();
  const page = Math.max(1, Number(result?.selectedPage?.page) || 1);
  if (!/^BV[0-9A-Za-z]+$/i.test(bvid)) {
    return "";
  }
  return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&page=${page}&high_quality=1&danmaku=0`;
}

export function sanitizeFilename(value) {
  const normalized = String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return normalized || "B站字幕";
}

function cleanMetadata(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function escapeMarkdownLine(value) {
  return String(value ?? "").replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

function toYamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function toYamlDate(value) {
  const date = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date || '""';
}
