// @vitest-environment-options {"url": "https://music.youtube.com/watch?v=dQw4w9WgXcQ"}
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const BRIDGE_SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "../src-tauri/src/ytm_bridge.js"),
  "utf-8",
);

interface Bridge {
  exec(action: string, value?: number | null): void;
}

type BridgeWindow = Window & {
  __sonoraBridge?: Bridge;
  __TAURI_INTERNALS__?: { invoke: ReturnType<typeof vi.fn> };
};

const win = window as BridgeWindow;

function setupPage({ ad }: { ad: boolean }) {
  document.body.innerHTML = `<div id="movie_player" class="${ad ? "ad-showing" : ""}"><video></video></div>`;
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { value: 200, configurable: true });
  video.pause = vi.fn();
  video.play = vi.fn(() => Promise.resolve());
  const player = document.getElementById("movie_player") as HTMLElement & {
    nextVideo: ReturnType<typeof vi.fn>;
  };
  player.nextVideo = vi.fn();
  return { video, player };
}

function loadBridge() {
  delete win.__sonoraBridge;
  new Function(BRIDGE_SOURCE)();
  // The script looks for the <video> element on an interval.
  vi.advanceTimersByTime(600);
  return win.__sonoraBridge!;
}

const reports = () =>
  win.__TAURI_INTERNALS__!.invoke.mock.calls.map(
    ([, args]) => (args as { state: { reason: string; ad: boolean } }).state,
  );

describe("YouTube Music bridge script", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    win.__TAURI_INTERNALS__ = { invoke: vi.fn(() => Promise.resolve()) };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete win.__TAURI_INTERNALS__;
    delete win.__sonoraBridge;
  });

  it("reports state once the video element appears", () => {
    setupPage({ ad: false });
    loadBridge();

    const [first] = reports();
    expect(first).toMatchObject({ reason: "ready", videoId: "dQw4w9WgXcQ", ad: false, duration: 200, signedIn: false });
  });

  it("reports YouTube Music's own signed-in flag", () => {
    setupPage({ ad: false });
    (window as unknown as { ytcfg: { get: (k: string) => unknown } }).ytcfg = {
      get: (key) => (key === "LOGGED_IN" ? true : undefined),
    };
    try {
      loadBridge();
      expect(reports()[0]).toMatchObject({ signedIn: true });
    } finally {
      delete (window as unknown as { ytcfg?: unknown }).ytcfg;
    }
  });

  it("controls the track when no ad is playing", () => {
    const { video, player } = setupPage({ ad: false });
    const bridge = loadBridge();

    bridge.exec("seek", 42);
    bridge.exec("next");
    bridge.exec("pause");

    expect(video.currentTime).toBe(42);
    expect(player.nextVideo).toHaveBeenCalledTimes(1);
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  it("refuses to seek or skip while an ad is playing", () => {
    const { video, player } = setupPage({ ad: true });
    const bridge = loadBridge();

    bridge.exec("seek", 42);
    bridge.exec("next");

    expect(video.currentTime).toBe(0);
    expect(player.nextVideo).not.toHaveBeenCalled();
    expect(reports().filter((s) => s.reason === "blocked-ad")).toHaveLength(2);
    expect(reports().every((s) => s.ad)).toBe(true);
  });

  it("still allows pausing during an ad", () => {
    const { video } = setupPage({ ad: true });
    const bridge = loadBridge();

    bridge.exec("pause");

    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  describe("media keys", () => {
    type Handler = (() => void) | null;
    let handlers: Map<string, Handler>;

    beforeEach(() => {
      handlers = new Map();
      Object.defineProperty(navigator, "mediaSession", {
        configurable: true,
        value: { setActionHandler: (action: string, handler: Handler) => handlers.set(action, handler) },
      });
    });

    afterEach(() => {
      delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
    });

    it("hands next and previous to Sonora instead of the page", () => {
      setupPage({ ad: false });
      loadBridge();

      handlers.get("nexttrack")!();
      handlers.get("previoustrack")!();

      expect(reports().map((s) => s.reason)).toEqual(expect.arrayContaining(["media-next", "media-previous"]));
    });

    it("keeps the page from taking skips back but passes other actions through", () => {
      setupPage({ ad: false });
      loadBridge();
      const pageNext = vi.fn();
      const pagePlay = vi.fn();

      navigator.mediaSession.setActionHandler("nexttrack", pageNext);
      navigator.mediaSession.setActionHandler("play", pagePlay);
      handlers.get("nexttrack")!();

      expect(pageNext).not.toHaveBeenCalled();
      expect(reports().at(-1)?.reason).toBe("media-next");
      expect(handlers.get("play")).toBe(pagePlay);
    });
  });

  it("does nothing outside music.youtube.com", () => {
    setupPage({ ad: false });
    delete win.__sonoraBridge;
    const source = BRIDGE_SOURCE.replace('"music.youtube.com"', '"other.example"');
    new Function(source)();

    expect(win.__sonoraBridge).toBeUndefined();
  });
});
