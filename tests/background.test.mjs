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

test("uses the current player data when the video metadata omits a subtitle URL", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;

  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1test123?p=1" },
    __INITIAL_STATE__: {},
    __playinfo__: {
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
      : href.includes("aisubtitle.hdslb.com")
        ? { body: [{ from: 0, to: 1, content: "Fallback subtitle" }] }
        : { code: 0, data: { subtitle: { subtitles: [] } } };
    return { ok: true, async json() { return payload; } };
  };

  try {
    const response = await createIsolatedPageCollector()(null);
    assert.equal(response.ok, true);
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

test("starts both player metadata requests without waiting for the first one", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const playerResolvers = [];

  globalThis.window = {
    location: { href: "https://www.bilibili.com/video/BV1parallel123?p=1" },
    __INITIAL_STATE__: {},
    __playinfo__: {
      data: {
        subtitle: {
          subtitles: [
            {
              id: 1,
              lan: "zh-CN",
              lan_doc: "Chinese",
              subtitle_url: "//aisubtitle.hdslb.com/track.json"
            }
          ]
        }
      }
    }
  };
  globalThis.document = { title: "Parallel video" };
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/x/web-interface/view?")) {
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              bvid: "BV1parallel123",
              aid: 123,
              title: "Parallel video",
              duration: 10,
              owner: { name: "Creator" },
              pages: [{ page: 1, cid: 456, part: "P1", duration: 10 }],
              subtitle: { list: [] }
            }
          };
        }
      };
    }
    if (href.includes("/x/player/")) {
      return new Promise((resolve) => playerResolvers.push(resolve));
    }
    throw new Error(`unexpected request: ${href}`);
  };

  try {
    const pending = collectSubtitleInPage(null);
    for (let tick = 0; tick < 5 && playerResolvers.length < 2; tick += 1) {
      await Promise.resolve();
    }
    assert.equal(playerResolvers.length, 2);
    playerResolvers.forEach((resolve) =>
      resolve({
        ok: true,
        async json() {
          return { code: 0, data: { subtitle: { subtitles: [] } } };
        }
      })
    );
    const response = await pending;
    assert.equal(response.ok, true);
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

globalThis.chrome = previousChrome;
