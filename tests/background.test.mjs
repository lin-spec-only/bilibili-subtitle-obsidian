import test from "node:test";
import assert from "node:assert/strict";

const previousChrome = globalThis.chrome;
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener() {}
    }
  }
};

const { collectSubtitleInPage, extractAndPersist, hydrateSubtitleTracks } = await import("../background.js");

function createIsolatedPageCollector() {
  return Function(`"use strict"; return (${collectSubtitleInPage.toString()});`)();
}

test("uses the current cid player endpoint when video metadata omits a subtitle URL", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;

  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1test123?p=1" },
    __INITIAL_STATE__: {},
    __playinfo__: { data: { subtitle: { subtitles: [] } } }
  };
  globalThis.document = { title: "Fallback video" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    const payload = href.includes("/x/web-interface/view?")
      ? {
          code: 0,
          data: {
            bvid: "BV1test123",
            aid: 123,
            title: "Fallback video",
            duration: 10,
            owner: { name: "Creator" },
            pages: [{ page: 1, cid: 456, part: "P1", duration: 10 }],
            subtitle: { list: [{ id: 1, lan: "zh-CN", lan_doc: "Chinese AI" }] }
          }
        }
      : href.includes("/x/player/")
        ? {
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    id: 1,
                    lan: "zh-CN",
                    lan_doc: "Chinese AI",
                    subtitle_url: "//aisubtitle.hdslb.com/track.json"
                  }
                ]
              }
            }
          }
      : href.includes("aisubtitle.hdslb.com")
        ? { body: [{ from: 0, to: 1, content: "Fallback subtitle" }] }
        : { code: 0, data: {} };
    return { ok: true, async json() { return payload; } };
  };

  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.tracks.length, 1);
    assert.equal(response.result.tracks[0].subtitleUrl, "https://aisubtitle.hdslb.com/track.json");
    assert.deepEqual(response.result.tracks[0].body, []);

    const hydrated = await hydrateSubtitleTracks(response.result);
    assert.equal(hydrated.subtitleStatus, "available");
    assert.equal(hydrated.tracks[0].error, undefined);
    assert.deepEqual(hydrated.tracks[0].body, [
      { from: 0, to: 1, content: "Fallback subtitle" }
    ]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("reads the current video from a watch-later URL instead of stale page state", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;

  globalThis.window = {
    location: {
      href: "https://www.bilibili.com/list/watchlater?oid=116465890106830&bvid=BV17xo9BsEnx"
    },
    __INITIAL_STATE__: {
      bvid: "BV1C2Ny67E93",
      videoData: { bvid: "BV1C2Ny67E93", aid: 999 }
    }
  };
  globalThis.document = { title: "【城】开源 Agent 之王 Hermes，到底厉害在哪？" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    let payload;
    if (href.includes("/x/web-interface/view?")) {
      assert.match(href, /bvid=BV17xo9BsEnx/);
      assert.doesNotMatch(href, /BV1C2Ny67E93/);
      payload = {
        code: 0,
        data: {
          bvid: "BV17xo9BsEnx",
          aid: 116465890106830,
          title: "【城】开源 Agent 之王 Hermes，到底厉害在哪？",
          duration: 792,
          owner: { name: "Creator" },
          pages: [{ page: 1, cid: 37822597056, part: "P1", duration: 792 }]
        }
      };
    } else if (href.includes("/x/player/")) {
      assert.match(href, /bvid=BV17xo9BsEnx/);
      assert.match(href, /cid=37822597056/);
      payload = {
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              {
                id: 1,
                lan: "zh-CN",
                lan_doc: "中文",
                subtitle_url: "//aisubtitle.hdslb.com/hermes.json"
              }
            ]
          }
        }
      };
    } else {
      throw new Error(`unexpected request: ${href}`);
    }
    return { ok: true, async json() { return payload; } };
  };

  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.video.bvid, "BV17xo9BsEnx");
    assert.equal(response.result.selectedPage.cid, "37822597056");
    assert.equal(response.result.tracks.length, 1);
    assert.equal(
      response.result.tracks[0].subtitleUrl,
      "https://aisubtitle.hdslb.com/hermes.json"
    );
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("falls back to player-v2 only when the primary wbi request fails", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const requestedSources = [];

  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1fallback123?p=1" },
    __INITIAL_STATE__: {},
    __playinfo__: { data: { subtitle: { subtitles: [] } } }
  };
  globalThis.document = { title: "Fallback video" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/x/web-interface/view?")) {
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              bvid: "BV1fallback123",
              aid: 123,
              title: "Fallback video",
              duration: 10,
              owner: { name: "Creator" },
              pages: [{ page: 1, cid: 456, part: "P1", duration: 10 }],
              subtitle: { list: [] }
            }
          };
        }
      };
    }
    if (href.includes("/x/player/wbi/v2?")) {
      requestedSources.push("wbi");
      return {
        ok: true,
        async json() {
          return { code: -403, message: "primary unavailable" };
        }
      };
    }
    if (href.includes("/x/player/v2?")) {
      requestedSources.push("v2");
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    id: 1,
                    lan: "zh-CN",
                    lan_doc: "Chinese",
                    subtitle_url: "//aisubtitle.hdslb.com/current.json"
                  }
                ]
              }
            }
          };
        }
      };
    }
    throw new Error(`unexpected request: ${href}`);
  };

  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true);
    assert.deepEqual(requestedSources, ["wbi", "v2"]);
    assert.equal(response.result.tracks.length, 1);
    assert.equal(response.result.tracks[0].subtitleUrl, "https://aisubtitle.hdslb.com/current.json");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("treats an empty successful wbi response as no subtitles without merging player-v2", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const requestedSources = [];

  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1empty123?p=1" },
    __INITIAL_STATE__: {},
    __playinfo__: { data: { subtitle: { subtitles: [] } } }
  };
  globalThis.document = { title: "No subtitles" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    let payload;
    if (href.includes("/x/web-interface/view?")) {
      payload = {
        code: 0,
        data: {
          bvid: "BV1empty123",
          aid: 123,
          title: "No subtitles",
          duration: 60,
          owner: { name: "Creator" },
          pages: [{ page: 1, cid: 456, part: "P1", duration: 60 }],
          subtitle: { list: [] }
        }
      };
    } else if (href.includes("/x/player/wbi/v2?")) {
      requestedSources.push("wbi");
      payload = {
        code: 0,
        data: {
          need_login_subtitle: false,
          subtitle: { subtitles: [] }
        }
      };
    } else if (href.includes("/x/player/v2?")) {
      requestedSources.push("v2");
      throw new Error("player-v2 must not run after a successful empty primary response");
    } else if (href.includes("/x/player/playurl?")) {
      payload = {
        code: 0,
        data: {
          dash: {
            audio: [{ bandwidth: 64000, baseUrl: "https://a.bilivideo.com/current.m4s" }]
          }
        }
      };
    } else {
      throw new Error(`unexpected request: ${href}`);
    }
    return { ok: true, async json() { return payload; } };
  };

  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true);
    assert.deepEqual(requestedSources, ["wbi"]);
    assert.deepEqual(response.result.tracks, []);
    assert.equal(response.result.subtitleStatus, "none");
    assert.equal(response.result.audio.urls[0], "https://a.bilivideo.com/current.m4s");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("injects into the supplied current tab without opening a helper tab", async () => {
  const previousRuntimeChrome = globalThis.chrome;
  const localState = {};
  const sessionState = {};
  const executions = [];
  globalThis.chrome = {
    storage: {
      local: { async set(values) { Object.assign(localState, values); } },
      session: { async set(values) { Object.assign(sessionState, values); } }
    },
    tabs: {
      async get(tabId) {
        assert.equal(tabId, 42);
        return {
          id: 42,
          status: "complete",
          url: "https://www.bilibili.com/video/BV1test123?p=1"
        };
      }
    },
    scripting: {
      async executeScript(options) {
        executions.push(options);
        return [{ result: { ok: true, result: { sourceUrl: "https://www.bilibili.com/video/BV1test123" } } }];
      }
    }
  };

  try {
    const result = await extractAndPersist({
      url: "https://www.bilibili.com/video/BV1test123?p=1",
      tabId: 42
    });
    assert.equal(result.sourceUrl, "https://www.bilibili.com/video/BV1test123");
    assert.equal(executions.length, 1);
    assert.equal(executions[0].target.tabId, 42);
    assert.equal(Object.hasOwn(globalThis.chrome.tabs, "create"), false);
    assert.equal(sessionState.extractState.status, "success");
    assert.equal(localState.lastInput, "https://www.bilibili.com/video/BV1test123?p=1");
  } finally {
    globalThis.chrome = previousRuntimeChrome;
  }
});

test("discovers the lowest-bandwidth DASH audio when subtitles are absent", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1audio123?p=1" },
    __INITIAL_STATE__: {},
    __playinfo__: { data: { subtitle: { subtitles: [] } } }
  };
  globalThis.document = { title: "Audio only" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    let payload;
    if (href.includes("/x/web-interface/view?")) {
      payload = {
        code: 0,
        data: {
          bvid: "BV1audio123", aid: 123, title: "Audio only", duration: 60,
          owner: { name: "Creator" },
          pages: [{ page: 1, cid: 456, part: "P1", duration: 60 }],
          subtitle: { list: [] }
        }
      };
    } else if (href.includes("/x/player/playurl?")) {
      payload = {
        code: 0,
        data: {
          dash: {
            audio: [
              { bandwidth: 128000, baseUrl: "https://a.bilivideo.com/high.m4s" },
              { bandwidth: 64000, baseUrl: "https://a.bilivideo.com/low.m4s", backupUrl: ["https://b.hdslb.com/low.m4s"] }
            ]
          }
        }
      };
    } else {
      payload = { code: 0, data: { subtitle: { subtitles: [] } } };
    }
    return { ok: true, async json() { return payload; } };
  };
  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true);
    assert.equal(response.result.subtitleStatus, "none");
    assert.equal(response.result.audio.bandwidth, 64000);
    assert.deepEqual(response.result.audio.urls, [
      "https://a.bilivideo.com/low.m4s",
      "https://b.hdslb.com/low.m4s"
    ]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("does not use a video-level subtitle from another part", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1parts123?p=2" },
    __INITIAL_STATE__: {},
    __playinfo__: { data: { subtitle: { subtitles: [] } } }
  };
  globalThis.document = { title: "Multi-part video" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    let payload;
    if (href.includes("/x/web-interface/view?")) {
      payload = {
        code: 0,
        data: {
          bvid: "BV1parts123", aid: 123, title: "Multi-part video", duration: 60,
          owner: { name: "Creator" },
          pages: [{ page: 1, cid: 111, part: "P1", duration: 30 }, { page: 2, cid: 222, part: "P2", duration: 30 }],
          subtitle: { list: [{ lan: "zh-CN", lan_doc: "Chinese", subtitle_url: "//aisubtitle.hdslb.com/p1.json" }] }
        }
      };
    } else if (href.includes("/x/player/playurl?")) {
      payload = { code: 0, data: { dash: { audio: [{ bandwidth: 64000, baseUrl: "https://a.bilivideo.com/p2.m4s" }] } } };
    } else {
      assert.match(href, /cid=222/);
      payload = { code: 0, data: { subtitle: { subtitles: [] } } };
    }
    return { ok: true, async json() { return payload; } };
  };
  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true);
    assert.equal(response.result.selectedPage.page, 2);
    assert.deepEqual(response.result.tracks, []);
    assert.equal(response.result.subtitleStatus, "none");
    assert.equal(response.result.audio.urls[0], "https://a.bilivideo.com/p2.m4s");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("ignores stale page playinfo subtitles after Bilibili SPA navigation", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1current123?p=1" },
    __INITIAL_STATE__: {
      bvid: "BV1stale999",
      playinfo: {
        data: {
          subtitle: {
            subtitles: [
              {
                id: 9,
                lan: "zh-CN",
                lan_doc: "Chinese AI",
                subtitle_url: "//aisubtitle.hdslb.com/stale.json"
              }
            ]
          }
        }
      }
    },
    __playinfo__: {
      data: {
        subtitle: {
          subtitles: [
            {
              id: 9,
              lan: "zh-CN",
              lan_doc: "Chinese AI",
              subtitle_url: "//aisubtitle.hdslb.com/stale.json"
            }
          ]
        }
      }
    }
  };
  globalThis.document = { title: "Current video" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    let payload;
    if (href.includes("/x/web-interface/view?")) {
      assert.match(href, /bvid=BV1current123/);
      payload = {
        code: 0,
        data: {
          bvid: "BV1current123",
          aid: 123,
          title: "Current video",
          duration: 60,
          owner: { name: "Creator" },
          pages: [{ page: 1, cid: 456, part: "P1", duration: 60 }],
          subtitle: { list: [] }
        }
      };
    } else if (href.includes("/x/player/playurl?")) {
      assert.match(href, /cid=456/);
      payload = {
        code: 0,
        data: {
          dash: {
            audio: [{ bandwidth: 64000, baseUrl: "https://a.bilivideo.com/current.m4s" }]
          }
        }
      };
    } else if (href.includes("/x/player/")) {
      assert.match(href, /bvid=BV1current123/);
      assert.match(href, /cid=456/);
      payload = { code: 0, data: { subtitle: { subtitles: [] } } };
    } else if (href.includes("stale.json")) {
      throw new Error("must not download a stale subtitle URL");
    } else {
      throw new Error(`unexpected request: ${href}`);
    }
    return { ok: true, async json() { return payload; } };
  };

  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true);
    assert.equal(response.result.video.bvid, "BV1current123");
    assert.equal(response.result.selectedPage.cid, "456");
    assert.deepEqual(response.result.tracks, []);
    assert.equal(response.result.subtitleStatus, "none");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

globalThis.chrome = previousChrome;
