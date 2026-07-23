import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalAsrPayload,
  isValidLocalAsrJobId,
  mergeLocalAsrTrack,
  normalizeBilibiliAudioUrl,
  transcriptionIdentity
} from "../lib/local-asr.js";

const result = {
  sourceUrl: "https://www.bilibili.com/video/BV1test123?p=2",
  video: { bvid: "BV1test123", duration: 120 },
  selectedPage: { page: 2, cid: "456", duration: 60 },
  audio: {
    urls: [
      "https://upos-sz-mirrorali.bilivideo.com/audio.m4s?token=short",
      "https://bilivideo.com.evil.test/audio.m4s"
    ]
  },
  tracks: []
};

test("只把允许的 B 站音频地址交给本地服务", () => {
  const payload = buildLocalAsrPayload(result);
  assert.deepEqual(payload.audio_urls, [
    "https://upos-sz-mirrorali.bilivideo.com/audio.m4s?token=short"
  ]);
  assert.equal(normalizeBilibiliAudioUrl("https://127.0.0.1/audio"), "");
  assert.equal(transcriptionIdentity(result), "BV1test123:456");
});

test("合并本地字幕时替换旧的本地轨并保留官方轨", () => {
  const merged = mergeLocalAsrTrack(
    { ...result, tracks: [{ id: "official", body: [{ from: 0, to: 1, content: "官方" }] }] },
    { id: "local", source: "local-asr", body: [{ from: 1, to: 2, content: "本地" }] }
  );
  assert.equal(merged.subtitleStatus, "available");
  assert.equal(merged.tracks.length, 2);
});

test("校验本地任务编号", () => {
  assert.equal(isValidLocalAsrJobId("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isValidLocalAsrJobId("../health"), false);
});

