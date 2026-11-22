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
    expect(first).toMatchObject({ reason: "ready", videoId: "dQw4w9WgXcQ", ad: false, duration: 200 });
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

  it("does nothing outside music.youtube.com", () => {
    setupPage({ ad: false });
    delete win.__sonoraBridge;
    const source = BRIDGE_SOURCE.replace('"music.youtube.com"', '"other.example"');
    new Function(source)();

    expect(win.__sonoraBridge).toBeUndefined();
  });
});
