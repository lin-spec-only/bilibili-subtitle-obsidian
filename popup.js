import {
  buildExportFilename,
  buildMarkdown,
  buildObsidianNoteFilename,
  buildPlainText,
  buildSrt,
  buildTimestampText,
  hasUsableSubtitleContent,
  selectPreferredSubtitleTrackIndex,
  normalizeVideoInput,
  isSupportedBilibiliVideoInput,
  toUserErrorMessage
} from "./lib/core.js";
import {
  getDirectoryPermission,
  getVaultDestination,
  isObsidianVaultRoot,
  OBSIDIAN_DIRECTORY_PICKER_ID,
  requestDirectoryPermission,
  resolveVaultRelativePath,
  setVaultDestination,
  writeNewMarkdownFile
} from "./lib/vault.js";
import { buildObsidianOpenUri } from "./lib/obsidian-uri.js";
import {
  approveObsidianAutoOpen,
  hasObsidianAutoOpenApproval
} from "./lib/obsidian-handoff.js";
import { buildExtractionScope, doesExtractionStateMatchScope, readPopupState } from "./lib/extract-state.js";
import {
  mergeLocalAsrTrack,
  transcriptionIdentity
} from "./lib/local-asr.js";

const EXTRACT_MESSAGE = "extract-bilibili-subtitle";
const START_ASR_MESSAGE = "start-local-asr";
const GET_ASR_MESSAGE = "get-local-asr";
const CANCEL_ASR_MESSAGE = "cancel-local-asr";
const CONTROL_ASR_SERVICE_MESSAGE = "control-local-asr-service";
const LOCAL_ASR_STATE_KEY = "localAsrState";
let currentResult = null;
let currentTrack = null;
let extracting = false;
let activeVideoTabId = null;
let vaultDirectory = null;
let vaultRootDirectory = null;
let vaultRelativePath = "";
let savingToObsidian = false;
let pendingObsidianUri = "";
let activeAsrJobId = "";
let activeAsrIdentity = "";
let asrPollTimer = null;

const elements = {
  form: document.querySelector("#extract-form"),
  url: document.querySelector("#video-url"),
  extractButton: document.querySelector("#extract-button"),
  status: document.querySelector("#status"),
  result: document.querySelector("#result"),
  videoTitle: document.querySelector("#video-title"),
  videoMeta: document.querySelector("#video-meta"),
  sourceLink: document.querySelector("#source-link"),
  partSelect: document.querySelector("#part-select"),
  languageField: document.querySelector("#language-field"),
  languageSelect: document.querySelector("#language-select"),
  emptyState: document.querySelector("#empty-state"),
  asrPanel: document.querySelector("#asr-panel"),
  asrStatus: document.querySelector("#asr-status"),
  asrProgress: document.querySelector("#asr-progress"),
  startAsr: document.querySelector("#start-asr"),
  startAsrService: document.querySelector("#start-asr-service"),
  cancelAsr: document.querySelector("#cancel-asr"),
  stopAsrService: document.querySelector("#stop-asr-service"),
  transcript: document.querySelector("#transcript"),
  actions: document.querySelector("#actions"),
  actionFeedback: document.querySelector("#action-feedback"),
  saveObsidian: document.querySelector("#save-obsidian"),
  openObsidian: document.querySelector("#open-obsidian"),
  copyMarkdown: document.querySelector("#copy-markdown"),
  copyPlain: document.querySelector("#copy-plain"),
  downloadMarkdown: document.querySelector("#download-markdown"),
  downloadSrt: document.querySelector("#download-srt"),
  vaultStatus: document.querySelector("#vault-status"),
  changeVaultDirectory: document.querySelector("#change-vault-directory")
};

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  startExtraction(null);
});

elements.partSelect.addEventListener("change", () => {
  const selectedPart = Number(elements.partSelect.value);
  if (currentResult && selectedPart !== Number(currentResult.selectedPage?.page)) {
    startExtraction(selectedPart);
  }
});

elements.languageSelect.addEventListener("change", () => {
  renderSelectedTrack(Number(elements.languageSelect.value));
});

elements.copyMarkdown.addEventListener("click", () =>
  copyToClipboard(buildMarkdown(currentResult, currentTrack), "已复制 Obsidian 笔记")
);
elements.copyPlain.addEventListener("click", () =>
  copyToClipboard(buildPlainText(currentTrack), "已复制纯文本字幕")
);
elements.downloadMarkdown.addEventListener("click", () => {
  downloadText(
    buildExportFilename(currentResult, currentTrack, "md"),
    buildMarkdown(currentResult, currentTrack),
    "text/markdown;charset=utf-8"
  );
});
elements.downloadSrt.addEventListener("click", () => {
  downloadText(
    buildExportFilename(currentResult, currentTrack, "srt"),
    buildSrt(currentTrack),
    "application/x-subrip;charset=utf-8"
  );
});
elements.saveObsidian.addEventListener("click", saveToObsidian);
elements.openObsidian.addEventListener("click", openSavedNoteInObsidian);
elements.changeVaultDirectory.addEventListener("click", () => chooseVaultSaveDirectory());
elements.startAsr.addEventListener("click", startLocalTranscription);
elements.startAsrService.addEventListener("click", () => controlAsrService("start"));
elements.cancelAsr.addEventListener("click", cancelLocalTranscription);
elements.stopAsrService.addEventListener("click", () => controlAsrService("stop"));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || !changes.extractState?.newValue) {
    return;
  }
  if (doesExtractionStateMatchScope(changes.extractState.newValue, currentExtractionScope())) {
    applyExtractState(changes.extractState.newValue);
  }
});

initialize().catch((error) => showStatus(toUserErrorMessage(error), "error"));

async function initialize() {
  const stored = await readPopupState(chrome.storage);
  elements.saveObsidian.textContent = "添加到 Obsidian";
  await refreshVaultStatus();

  try {
    const activeVideo = await getActiveVideo();
    elements.url.value = activeVideo.url;
    activeVideoTabId = activeVideo.tabId;
    elements.form.hidden = true;
    await startExtraction(null, { showFallbackForm: true });
    return;
  } catch {
    elements.form.hidden = false;
  }

  if (stored.lastInput) {
    elements.url.value = stored.lastInput;
  }
  if (stored.extractState && doesExtractionStateMatchScope(stored.extractState, currentExtractionScope())) {
    applyExtractState(stored.extractState);
  }
}

async function startExtraction(part, { showFallbackForm = false } = {}) {
  if (extracting) {
    return;
  }
  const url = elements.url.value.trim();
  if (!url) {
    showStatus("请先粘贴 B 站视频链接", "error");
    elements.url.focus();
    return;
  }
  if (!Number.isInteger(activeVideoTabId)) {
    showStatus("请先切换到需要提取字幕的 B 站视频标签页，再打开插件。", "error");
    return;
  }

  setExtracting(true);
  showStatus("正在通过 B 站页面读取视频和字幕，请稍候…", "loading");
  clearActionFeedback();
  try {
    const response = await chrome.runtime.sendMessage({
      type: EXTRACT_MESSAGE,
      url,
      part,
      tabId: activeVideoTabId
    });
    if (!response?.ok) {
      throw new Error(response?.error || "字幕提取失败");
    }
    renderResult(response.result);
  } catch (error) {
    if (showFallbackForm) {
      elements.form.hidden = false;
    }
    showStatus(toUserErrorMessage(error), "error");
  } finally {
    setExtracting(false);
  }
}

async function getActiveVideo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const sourceUrl = tab?.url || "";
  if (!Number.isInteger(tab?.id) || !isSupportedBilibiliVideoInput(sourceUrl)) {
    throw new Error("unsupported-video-page");
  }
  return { tabId: tab.id, url: normalizeVideoInput(sourceUrl) };
}

function currentExtractionScope() {
  return buildExtractionScope(activeVideoTabId, elements.url.value);
}

function applyExtractState(state) {
  if (state?.status === "loading") {
    setExtracting(true);
    showStatus("正在通过 B 站页面读取视频和字幕，请稍候…", "loading");
    return;
  }
  setExtracting(false);
  if (state?.status === "success" && state.result) {
    renderResult(state.result);
    return;
  }
  if (state?.status === "error") {
    showStatus(state.error || "字幕提取失败", "error");
  }
}

function renderResult(result) {
  currentResult = result;
  elements.result.hidden = false;
  elements.videoTitle.textContent = result.video?.title || "B站视频";
  elements.videoMeta.textContent = [
    result.video?.bvid,
    `P${result.selectedPage?.page}`,
    result.video?.ownerName ? `UP主：${result.video.ownerName}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
  elements.sourceLink.href = result.sourceUrl;

  replaceOptions(
    elements.partSelect,
    result.pages.map((page) => ({ value: page.page, label: `P${page.page} · ${page.part}` })),
    result.selectedPage?.page
  );

  const tracks = Array.isArray(result.tracks) ? result.tracks : [];
  configureAsrPanel(result, tracks);
  if (!tracks.length) {
    currentTrack = null;
    elements.languageField.hidden = true;
    elements.emptyState.hidden = false;
    elements.transcript.hidden = true;
    elements.actions.hidden = true;
    if (result.subtitleStatus === "login-required") {
      elements.emptyState.querySelector("strong").textContent =
        "该视频的字幕需要 B站登录态";
      elements.emptyState.querySelector("p").textContent =
        "插件不会打开登录页。请确认它安装在你平时已登录 B站的同一 Edge 配置文件，然后重试。";
      showStatus("视频信息已读取，但当前页面请求没有获得可用的 B站登录态。", "error");
    } else {
      elements.emptyState.querySelector("strong").textContent = "这个分P没有可用字幕";
      elements.emptyState.querySelector("p").textContent =
        "没有发现官方或 AI 字幕，可以使用本机模型转写当前分P音频。";
      showStatus("视频信息已读取，但这个分P没有发现官方或 AI 字幕。", "info");
    }
    return;
  }

  elements.languageField.hidden = false;
  elements.emptyState.hidden = true;
  elements.transcript.hidden = false;
  elements.actions.hidden = false;
  replaceOptions(
    elements.languageSelect,
    tracks.map((track, index) => ({
      value: index,
      label: `${track.languageLabel}${track.isAi ? " · AI" : ""}${track.error ? " · 获取失败" : ""}`
    })),
    selectPreferredSubtitleTrackIndex(tracks)
  );
  renderSelectedTrack(Number(elements.languageSelect.value));
}

function configureAsrPanel(result, tracks) {
  const hasUsableTrack = tracks.some(hasUsableSubtitleContent);
  const eligible = !hasUsableTrack && result.subtitleStatus !== "login-required";
  elements.asrPanel.hidden = !eligible;
  if (!eligible) {
    stopAsrPolling();
    return;
  }
  const hasAudio = Array.isArray(result?.audio?.urls) && result.audio.urls.length > 0;
  elements.startAsr.disabled = !hasAudio;
  elements.asrStatus.textContent = hasAudio
    ? "音频只在本机处理；首次转写会下载 Whisper small 模型到 D 盘。"
    : result.audioError || "没有取得当前分P的音频地址";
  resumeLocalTranscription(result).catch((error) => {
    elements.asrStatus.textContent = error?.message || String(error);
  });
}

async function startLocalTranscription() {
  if (!currentResult || activeAsrJobId) {
    return;
  }
  setAsrBusy(true, "正在连接本地转写服务…", 0);
  try {
    await controlAsrService("start", true);
    const response = await chrome.runtime.sendMessage({
      type: START_ASR_MESSAGE,
      result: currentResult
    });
    if (!response?.ok) {
      throw new Error(response?.error || "无法启动本地转写");
    }
    activeAsrJobId = response.result.id;
    activeAsrIdentity = transcriptionIdentity(currentResult);
    await chrome.storage.session.set({
      [LOCAL_ASR_STATE_KEY]: {
        jobId: activeAsrJobId,
        identity: activeAsrIdentity
      }
    });
    await pollLocalTranscription();
  } catch (error) {
    activeAsrJobId = "";
    setAsrBusy(false, error?.message || String(error), 0);
  }
}

async function resumeLocalTranscription(result) {
  if (activeAsrJobId) {
    return;
  }
  const stored = await chrome.storage.session.get(LOCAL_ASR_STATE_KEY);
  const state = stored?.[LOCAL_ASR_STATE_KEY];
  if (!state?.jobId || state.identity !== transcriptionIdentity(result)) {
    return;
  }
  activeAsrJobId = state.jobId;
  activeAsrIdentity = state.identity;
  setAsrBusy(true, "正在恢复本地转写任务…", 0);
  await pollLocalTranscription();
}

async function pollLocalTranscription() {
  if (!activeAsrJobId) {
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: GET_ASR_MESSAGE,
    jobId: activeAsrJobId
  });
  if (!response?.ok) {
    throw new Error(response?.error || "无法读取本地转写进度");
  }
  const job = response.result;
  const percent = Math.round(Number(job.progress || 0) * 100);
  setAsrBusy(!["completed", "failed", "cancelled"].includes(job.status), job.message || "正在转写", percent);
  if (job.status === "completed") {
    if (activeAsrIdentity !== transcriptionIdentity(currentResult)) {
      activeAsrJobId = "";
      activeAsrIdentity = "";
      await chrome.storage.session.remove(LOCAL_ASR_STATE_KEY);
      setAsrBusy(false, "转写已完成，但当前已切换到其他分P，请切回原分P读取缓存。", percent);
      return;
    }
    const merged = mergeLocalAsrTrack(currentResult, job.result?.track);
    activeAsrJobId = "";
    activeAsrIdentity = "";
    await chrome.storage.session.remove(LOCAL_ASR_STATE_KEY);
    await chrome.storage.session.set({
      extractState: {
        status: "success",
        completedAt: new Date().toISOString(),
        result: merged
      }
    });
    renderResult(merged);
    await controlAsrService("stop", true);
    return;
  }
  if (job.status === "failed" || job.status === "cancelled") {
    activeAsrJobId = "";
    activeAsrIdentity = "";
    await chrome.storage.session.remove(LOCAL_ASR_STATE_KEY);
    setAsrBusy(false, job.error || job.message || "本地转写未完成", percent);
    return;
  }
  stopAsrPolling();
  asrPollTimer = window.setTimeout(() => {
    pollLocalTranscription().catch((error) => {
      activeAsrJobId = "";
      setAsrBusy(false, error?.message || String(error), percent);
    });
  }, 1_500);
}

async function controlAsrService(action, quiet = false) {
  const response = await chrome.runtime.sendMessage({
    type: CONTROL_ASR_SERVICE_MESSAGE,
    action
  });
  if (!response?.ok) {
    throw new Error(response?.error || "本地服务控制失败");
  }
  if (!quiet) {
    elements.asrStatus.textContent = response.result?.message || (action === "start" ? "本地服务已启动" : "本地服务已关闭");
  }
  return response.result;
}

async function cancelLocalTranscription() {
  if (!activeAsrJobId) {
    return;
  }
  const jobId = activeAsrJobId;
  stopAsrPolling();
  const response = await chrome.runtime.sendMessage({ type: CANCEL_ASR_MESSAGE, jobId });
  activeAsrJobId = "";
  activeAsrIdentity = "";
  await chrome.storage.session.remove(LOCAL_ASR_STATE_KEY);
  setAsrBusy(false, response?.ok ? "转写已取消" : response?.error || "取消失败", 0);
}

function setAsrBusy(busy, message, percent) {
  elements.startAsr.disabled = busy || !(currentResult?.audio?.urls?.length > 0);
  elements.partSelect.disabled = busy || extracting;
  elements.cancelAsr.hidden = !busy;
  elements.asrProgress.hidden = !busy;
  elements.asrProgress.value = Math.max(0, Math.min(100, Number(percent) || 0));
  elements.asrStatus.textContent = message;
}

function stopAsrPolling() {
  if (asrPollTimer) {
    clearTimeout(asrPollTimer);
    asrPollTimer = null;
  }
}

function renderSelectedTrack(index) {
  const tracks = currentResult?.tracks || [];
  currentTrack = tracks[index] || tracks[0] || null;
  if (!currentTrack) {
    return;
  }
  const hasUsableContent = hasUsableSubtitleContent(currentTrack);
  elements.actions.hidden = Boolean(currentTrack.error) || !hasUsableContent;
  elements.transcript.textContent = currentTrack.error
    ? `字幕轨获取失败：${currentTrack.error}`
    : buildTimestampText(currentTrack);
  if (!currentTrack.error && !hasUsableContent) {
    showStatus("该字幕轨没有可导出的有效字幕内容，请切换其他字幕轨或重新提取。", "error");
    return;
  }
  const cueCount = hasUsableContent ? buildPlainText(currentTrack).split("\n").length : 0;
  showStatus(
    currentTrack.error
      ? `已找到字幕轨，但下载失败：${currentTrack.error}`
      : `提取完成：${currentTrack.languageLabel}，共 ${cueCount} 条字幕。`,
    currentTrack.error ? "error" : "info"
  );
}

async function saveToObsidian() {
  if (savingToObsidian) {
    return;
  }
  if (!currentResult || !currentTrack || currentTrack.error) {
    showActionFeedback("当前没有可保存的字幕", "error");
    return;
  }
  setSavingToObsidian(true);
  try {
    const destination = await ensureVaultDestination({ quiet: true });
    if (!destination) {
      showActionFeedback("未选择保存文件夹", "error");
      setSavingToObsidian(false);
      return;
    }
    const { directory, vaultRoot, relativePath } = destination;
    const directoryPermission = await requestDirectoryPermission(directory);
    if (directoryPermission !== "granted") {
      throw new Error("没有获得所选目录的写入权限");
    }
    const filename = buildObsidianNoteFilename(currentResult);
    const savedFilename = await writeNewMarkdownFile(
      directory,
      filename,
      buildMarkdown(currentResult, currentTrack)
    );
    const notePath = vaultRoot
      ? [relativePath, savedFilename].filter(Boolean).join("/")
      : `${directory.name}/${savedFilename}`;
    await refreshVaultStatus();
    if (!vaultRoot) {
      pendingObsidianUri = "";
      elements.openObsidian.hidden = true;
      showActionFeedback(`已保存到 ${notePath}`, "success");
      setSavingToObsidian(false);
      elements.saveObsidian.disabled = true;
      elements.changeVaultDirectory.disabled = true;
      elements.saveObsidian.textContent = "已保存";
      return;
    }

    const obsidianUri = buildObsidianOpenUri(vaultRoot.name, notePath);
    if (await hasObsidianAutoOpenApproval(chrome.storage)) {
      showActionFeedback(`已添加到 ${notePath}，正在打开 Obsidian`, "success");
      openObsidianUri(obsidianUri, { closePopup: true });
      return;
    }

    pendingObsidianUri = obsidianUri;
    elements.openObsidian.hidden = false;
    showActionFeedback(
      `已添加到 ${notePath}。请点击“打开 Obsidian”完成首次授权；以后将自动跳转。`,
      "success"
    );
    setSavingToObsidian(false);
    elements.saveObsidian.disabled = true;
    elements.changeVaultDirectory.disabled = true;
    elements.saveObsidian.textContent = "已添加";
  } catch (error) {
    showActionFeedback(`${error?.message || error}；请重新点击“添加到 Obsidian”选择目录`, "error");
    setSavingToObsidian(false);
  }
}

async function openSavedNoteInObsidian() {
  if (!pendingObsidianUri) {
    return;
  }
  elements.openObsidian.disabled = true;
  approveObsidianAutoOpen(chrome.storage).catch(() => {
    // 即使偏好写入失败，本次仍应保留用户刚刚触发的打开操作。
  });
  showActionFeedback("正在打开 Obsidian；请在 Edge 提示中允许打开。首次不会自动关闭此弹窗。", "success");
  openObsidianUri(pendingObsidianUri, { closePopup: false });
}

function openObsidianUri(uri, { closePopup }) {
  window.location.assign(uri);
  if (closePopup) {
    window.setTimeout(() => window.close(), 1_500);
  }
}

function setSavingToObsidian(value) {
  savingToObsidian = value;
  elements.saveObsidian.disabled = value;
  elements.changeVaultDirectory.disabled = value;
  elements.openObsidian.disabled = value;
  elements.saveObsidian.textContent = value ? "正在添加…" : "添加到 Obsidian";
}

async function ensureVaultDestination({ quiet = false } = {}) {
  if (vaultDirectory) {
    return {
      directory: vaultDirectory,
      vaultRoot: vaultRootDirectory,
      relativePath: vaultRelativePath
    };
  }
  return chooseVaultSaveDirectory({ quiet });
}

async function chooseVaultSaveDirectory({ quiet = false } = {}) {
  if (typeof window.showDirectoryPicker !== "function") {
    showActionFeedback("当前 Edge 版本不支持选择保存目录，请更新后重试", "error");
    return null;
  }
  try {
    showActionFeedback("请选择要直接保存笔记的文件夹", "info");
    const directory = await window.showDirectoryPicker({
      id: OBSIDIAN_DIRECTORY_PICKER_ID,
      mode: "readwrite",
      startIn: vaultDirectory || vaultRootDirectory || "documents"
    });
    if (directory.name.toLowerCase() === ".obsidian") {
      throw new Error("不能把笔记保存到 .obsidian 配置目录");
    }
    const permission = await requestDirectoryPermission(directory);
    if (permission !== "granted") {
      throw new Error("没有获得所选保存文件夹的写入权限");
    }

    let vaultRoot = null;
    let relativePath = "";
    if (await isObsidianVaultRoot(directory)) {
      vaultRoot = directory;
    } else if (vaultRootDirectory) {
      try {
        relativePath = await resolveVaultRelativePath(vaultRootDirectory, directory);
        vaultRoot = vaultRootDirectory;
      } catch {
        // File System Access API 不提供父目录；新选的子目录仍可直接写入。
      }
    }
    return saveVaultDestination(directory, vaultRoot, relativePath, quiet);
  } catch (error) {
    if (error?.name === "AbortError") {
      return null;
    }
    if (quiet) {
      throw error;
    }
    showActionFeedback(error?.message || "选择保存文件夹失败", "error");
    return null;
  }
}

async function saveVaultDestination(directory, vaultRoot, relativePath, quiet) {
  await setVaultDestination({ directory, vaultRoot, relativePath });
  vaultDirectory = directory;
  vaultRootDirectory = vaultRoot;
  vaultRelativePath = relativePath;
  await refreshVaultStatus();
  if (!quiet) {
    const location = vaultRoot
      ? (relativePath ? `${vaultRoot.name}/${relativePath}` : vaultRoot.name)
      : directory.name;
    showActionFeedback(`默认保存位置已设为 ${location}`, "success");
  }
  return { directory, vaultRoot, relativePath };
}

async function refreshVaultStatus() {
  try {
    const destination = await getVaultDestination();
    const directory = destination.directory;
    vaultDirectory = directory;
    vaultRootDirectory = destination.vaultRoot;
    vaultRelativePath = destination.relativePath;
    if (!directory) {
      elements.vaultStatus.textContent = "尚未选择保存文件夹";
      elements.changeVaultDirectory.hidden = true;
      elements.changeVaultDirectory.disabled = false;
      return;
    }
    const directoryPermission = await getDirectoryPermission(directory);
    const location = vaultRootDirectory && vaultRelativePath
      ? `${vaultRootDirectory.name}/${vaultRelativePath}`
      : directory.name;
    elements.vaultStatus.textContent =
      directoryPermission === "granted"
        ? location
        : `${location}（保存时授权）`;
    elements.changeVaultDirectory.hidden = false;
    elements.changeVaultDirectory.textContent = "更改保存文件夹";
    elements.changeVaultDirectory.disabled = false;
  } catch {
    vaultDirectory = null;
    vaultRootDirectory = null;
    vaultRelativePath = "";
    elements.vaultStatus.textContent = "保存位置状态不可用";
    elements.changeVaultDirectory.hidden = true;
    elements.changeVaultDirectory.disabled = false;
  }
}

async function copyToClipboard(content, successMessage) {
  if (!content) {
    showActionFeedback("当前没有可复制的内容", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    showActionFeedback(successMessage, "success");
  } catch {
    showActionFeedback("复制失败，请使用下载功能", "error");
  }
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  showActionFeedback(`已下载 ${filename}`, "success");
}

function replaceOptions(select, options, selectedValue) {
  select.replaceChildren(
    ...options.map((item) => {
      const option = document.createElement("option");
      option.value = String(item.value);
      option.textContent = item.label;
      option.selected = String(item.value) === String(selectedValue);
      return option;
    })
  );
}

function setExtracting(value) {
  extracting = value;
  elements.extractButton.disabled = value;
  elements.extractButton.textContent = value ? "提取中" : "提取";
  elements.partSelect.disabled = value || Boolean(activeAsrJobId);
}

function showStatus(message, kind) {
  elements.status.hidden = false;
  elements.status.dataset.kind = kind;
  elements.status.textContent = message;
}

function showActionFeedback(message, kind) {
  elements.actionFeedback.dataset.kind = kind;
  elements.actionFeedback.textContent = message;
}

function clearActionFeedback() {
  elements.actionFeedback.textContent = "";
  delete elements.actionFeedback.dataset.kind;
}
