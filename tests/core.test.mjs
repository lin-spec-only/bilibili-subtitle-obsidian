import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExportFilename,
  buildBilibiliEmbedUrl,
  buildObsidianNoteFilename,
  buildMarkdown,
  buildPlainText,
  buildSrt,
  buildTimestampText,
  formatTimestamp,
  hasUsableSubtitleContent,
  isAllowedBilibiliHost,
  isSupportedBilibiliVideoInput,
  normalizeCues,
  normalizeVideoInput,
  sanitizeFilename,
  selectPreferredSubtitleTrackIndex,
  toUserErrorMessage
} from "../lib/core.js";

test("detects whether a subtitle track has exportable cues", () => {
  assert.equal(
    hasUsableSubtitleContent({ body: [{ from: 0, to: 1.5, content: "hello" }] }),
    true
  );
  assert.equal(
    hasUsableSubtitleContent({ body: [{ from: "invalid", to: 1, content: "hello" }] }),
    false
  );
  assert.equal(hasUsableSubtitleContent({ body: [] }), false);
});

test("defaults to an exportable Chinese subtitle track", () => {
  const tracks = [
    { language: "en-US", languageLabel: "English", body: [{ from: 0, to: 1, content: "Hello" }] },
    { language: "zh-CN", languageLabel: "中文（自动生成）", body: [{ from: 0, to: 1, content: "你好" }] },
    { language: "ja-JP", languageLabel: "日本語", body: [{ from: 0, to: 1, content: "こんにちは" }] }
  ];
  assert.equal(selectPreferredSubtitleTrackIndex(tracks), 1);
  assert.equal(selectPreferredSubtitleTrackIndex([tracks[0]]), 0);
});

test("accepts only video pages for the current-tab shortcut", () => {
  assert.equal(isSupportedBilibiliVideoInput("BV1xx411c7mD"), true);
  assert.equal(
    isSupportedBilibiliVideoInput("https://www.bilibili.com/video/BV1xx411c7mD?p=2"),
    true
  );
  assert.equal(
    isSupportedBilibiliVideoInput(
      "https://www.bilibili.com/list/watchlater?oid=116465890106830&bvid=BV17xo9BsEnx"
    ),
    true
  );
  assert.equal(isSupportedBilibiliVideoInput("https://b23.tv/AbCd12"), true);
  assert.equal(isSupportedBilibiliVideoInput("https://www.bilibili.com/"), false);
  assert.equal(isSupportedBilibiliVideoInput("https://www.bilibili.com/list/watchlater"), false);
  assert.equal(isSupportedBilibiliVideoInput("https://space.bilibili.com/1"), false);
});

const track = {
  language: "zh-CN",
  languageLabel: "中文（自动生成）",
  body: [
    { from: 3.2, to: 5.4, content: "第一句" },
    { from: 0, to: 2.04, content: "开场\n字幕" },
    { from: "bad", to: 8, content: "无效" },
    { from: 6, to: 6, content: "结尾" }
  ]
};

const result = {
  sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
  extractedAt: "2026-07-14T12:00:00.000Z",
  video: {
    bvid: "BV1xx411c7mD",
    title: "测试：视频/标题",
    ownerName: "测试UP主",
    publishedAt: "2026-07-01T00:00:00.000Z",
    duration: 120,
    coverUrl: "https://i0.hdslb.com/test.jpg",
    description: "视频简介"
  },
  selectedPage: {
    page: 2,
    part: "第二部分",
    duration: 60
  }
};

test("embeds the Bilibili player instead of a cover image", () => {
  const markdown = buildMarkdown(result, track);
  assert.match(markdown, /<iframe src="https:\/\/player\.bilibili\.com\/player\.html\?bvid=BV1xx411c7mD&page=2&high_quality=1&danmaku=0"/);
  assert.doesNotMatch(markdown, /!\[/);
  assert.equal(
    buildBilibiliEmbedUrl(result),
    "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=2&high_quality=1&danmaku=0"
  );
  assert.equal(buildBilibiliEmbedUrl({ video: { bvid: "invalid" } }), "");
});

test("识别分享文本、短链和裸 BV 号", () => {
  assert.equal(
    normalizeVideoInput("BV1xx411c7mD"),
    "https://www.bilibili.com/video/BV1xx411c7mD"
  );
  assert.equal(
    normalizeVideoInput("分享一下 https://b23.tv/AbCd12，真的不错"),
    "https://b23.tv/AbCd12"
  );
  assert.equal(
    normalizeVideoInput("https://www.bilibili.com/video/BV1xx411c7mD?p=2"),
    "https://www.bilibili.com/video/BV1xx411c7mD?p=2"
  );
  assert.equal(
    normalizeVideoInput(
      "https://www.bilibili.com/list/watchlater?oid=116465890106830&bvid=BV17xo9BsEnx&spm_id_from=333.1007"
    ),
    "https://www.bilibili.com/video/BV17xo9BsEnx"
  );
});

test("拒绝伪造的 B 站域名", () => {
  assert.equal(isAllowedBilibiliHost("www.bilibili.com"), true);
  assert.equal(isAllowedBilibiliHost("evilbilibili.com"), false);
  assert.throws(
    () => normalizeVideoInput("https://evilbilibili.com/video/BV1xx411c7mD"),
    /只支持/
  );
});

test("清洗并按开始时间排序字幕", () => {
  assert.deepEqual(normalizeCues(track.body), [
    { from: 0, to: 2.04, content: "开场 字幕" },
    { from: 3.2, to: 5.4, content: "第一句" },
    { from: 6, to: 6, content: "结尾" }
  ]);
  assert.equal(buildPlainText(track), "开场 字幕\n第一句\n结尾");
  assert.equal(
    buildTimestampText(track),
    "[00:00:00] 开场 字幕\n[00:00:03] 第一句\n[00:00:06] 结尾"
  );
});

test("生成标准时间戳和 SRT", () => {
  assert.equal(formatTimestamp(3661.234, true), "01:01:01,234");
  assert.match(buildSrt(track), /00:00:06,000 --> 00:00:08,000/);
  assert.match(buildSrt(track), /^1\n00:00:00,000 --> 00:00:02,040/m);
});

test("生成带 Obsidian Properties 的 Markdown 笔记", () => {
  const markdown = buildMarkdown(result, track);
  assert.match(markdown, /^---\ntitle: "测试：视频\/标题"/);
  assert.match(markdown, /source: "https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD\?p=2"/);
  assert.match(markdown, /author:\n  - "测试UP主"/);
  assert.match(markdown, /published: 2026-07-01/);
  assert.match(markdown, /created: 2026-07-14/);
  assert.match(markdown, /description: "视频简介"/);
  assert.match(markdown, /tags:\n  - clippings/);
  assert.match(markdown, /> \[!abstract\] 摘要/);
  assert.match(markdown, /## 我的笔记/);
  assert.match(markdown, /## 原始字幕/);
  assert.match(markdown, /- \[00:00:00\] 开场 字幕/);
});

test("生成 Windows 安全的导出文件名", () => {
  assert.equal(sanitizeFilename('a<b>c:"d"'), "a-b-c--d-");
  const filename = buildExportFilename(result, track, ".md");
  assert.equal(filename, "测试：视频-标题-P2-第二部分-中文（自动生成）.md");
});

test("Obsidian 笔记文件名只使用视频标题", () => {
  assert.equal(buildObsidianNoteFilename(result), "测试：视频-标题.md");
});

test("把浏览器底层页面错误转换为可操作的中文提示", () => {
  assert.match(
    toUserErrorMessage(new Error("Frame with ID 0 is showing error page")),
    /B站视频页加载失败/
  );
  assert.match(
    toUserErrorMessage("Could not establish connection. Receiving end does not exist."),
    /重新加载本插件/
  );
  assert.equal(toUserErrorMessage(new Error("视频没有可读取的分P信息")), "视频没有可读取的分P信息");
});
