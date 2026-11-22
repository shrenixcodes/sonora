import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Track } from "../src/types/music";
import type { YtmCommand, YtmState } from "../src/lib/playback/ytm-bridge";

// Keep tests offline: no lyrics requests, no image decoding.
vi.mock("../src/lib/lyrics/providers", () => ({ lyricsService: { getLyrics: async () => null } }));
vi.mock("../src/lib/visuals/color-extractor", () => ({ extractPalette: () => new Promise(() => {}) }));

const { PlaybackEngine } = await import("../src/lib/playback/engine");

const track = (id: string): Track => ({ id, title: `Song ${id}`, artist: "Artist", duration: 200, artworkUrl: "" });
const list = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map(track);

function report(overrides: Partial<YtmState>): YtmState {
  return {
    reason: "time",
    videoId: null,
    title: null,
    artist: null,
    album: null,
    artworkUrl: null,
    paused: false,
    currentTime: 0,
    duration: 200,
    volume: 1,
    muted: false,
    ad: false,
    signedIn: false,
    ...overrides,
  };
}

function setup(available = true) {
  const sent: YtmCommand[] = [];
  const bridge = {
    available,
    control: vi.fn(async (command: YtmCommand) => {
      sent.push(command);
    }),
    onState: vi.fn(async () => () => {}),
  };
  const engine = new PlaybackEngine(bridge);
  return { engine, sent };
}

describe("PlaybackEngine with the YouTube Music bridge", () => {
  beforeEach(() => localStorage.clear());

  it("asks the page to load the track and follows its reports", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);

    expect(sent).toEqual([{ action: "load", value: "aaaaaaaaaaa" }]);
    expect(engine.currentState.status).toBe("loading");

    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa", currentTime: 1.5 }));
    expect(engine.currentState.status).toBe("playing");
    expect(engine.currentState.currentTime).toBe(1.5);
  });

  it("shows an ad as an ad and refuses to seek through it", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa", ad: true, title: "Some ad" }));

    expect(engine.currentState.isAd).toBe(true);
    expect(engine.currentState.status).toBe("playing");
    expect(engine.currentTrack?.title).toBe("Song aaaaaaaaaaa");

    engine.seekTo(60);
    expect(sent.some((c) => c.action === "seek")).toBe(false);
  });

  it("plays the next track in Sonora's queue when one ends", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa" }));
    engine.handleBridgeState(report({ reason: "ended", videoId: "aaaaaaaaaaa", paused: true }));

    expect(sent.at(-1)).toEqual({ action: "load", value: "bbbbbbbbbbb" });
    expect(engine.currentTrack?.id).toBe("bbbbbbbbbbb");
  });

  it("follows the page when it moves on by itself", () => {
    const { engine } = setup();
    engine.playTrack(list[2], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "ccccccccccc" }));
    engine.handleBridgeState(
      report({ reason: "track", videoId: "zzzzzzzzzzz", title: "Radio pick", artist: "Someone", artworkUrl: "art.jpg" }),
    );

    expect(engine.currentTrack).toMatchObject({ id: "zzzzzzzzzzz", title: "Radio pick", artist: "Someone" });
  });

  it("plays in the shuffled order that Up next shows", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);
    engine.toggleShuffle();
    const shown = engine.upcoming[0].id;

    engine.next();
    expect(sent.at(-1)).toEqual({ action: "load", value: shown });
  });

  it("re-applies the chosen volume after each load, since loading resets the page", () => {
    const { engine, sent } = setup();
    engine.setVolume(0.15);
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "ready", videoId: "aaaaaaaaaaa", paused: true, volume: 1 }));

    expect(sent.at(-1)).toEqual({ action: "volume", value: 0.15 });
  });

  it("ignores sign-in reports, which carry no playback state", () => {
    const { engine } = setup();
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "ready", videoId: "aaaaaaaaaaa", paused: false, currentTime: 42 }));
    engine.handleBridgeState(report({ reason: "account", paused: true, currentTime: 0, signedIn: true }));

    expect(engine.currentState.status).toBe("playing");
    expect(engine.currentState.currentTime).toBe(42);
  });

  it("takes the real title from YouTube Music, but not from an ad's first report", () => {
    const { engine } = setup();
    engine.playTrack(list[0], list);
    // As seen live: an ad's first "play" can arrive before it is flagged as an ad.
    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa", title: "Paint ad", artist: "Brand" }));
    engine.handleBridgeState(report({ reason: "time", videoId: "aaaaaaaaaaa", title: "Paint ad", ad: true }));
    expect(engine.currentTrack?.title).toBe("Song aaaaaaaaaaa");

    engine.handleBridgeState(
      report({ reason: "track", videoId: "aaaaaaaaaaa", title: "Despacito", artist: "Luis Fonsi", duration: 281.5 }),
    );
    expect(engine.currentTrack).toMatchObject({ title: "Despacito", artist: "Luis Fonsi", duration: 282 });
  });

  it("gives up with a clear message when the page never confirms a load", () => {
    vi.useFakeTimers();
    try {
      const { engine } = setup();
      engine.playTrack(list[1], list);
      vi.advanceTimersByTime(14_000);
      expect(engine.currentState.status).toBe("loading");

      vi.advanceTimersByTime(2_000);
      expect(engine.currentState.status).toBe("error");
      expect(engine.currentState.error).toMatch(/couldn't play/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out once the page confirms the track", () => {
    vi.useFakeTimers();
    try {
      const { engine } = setup();
      engine.playTrack(list[1], list);
      engine.handleBridgeState(report({ reason: "ready", videoId: "bbbbbbbbbbb", paused: true }));
      vi.advanceTimersByTime(20_000);
      expect(engine.currentState.status).not.toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains that playback needs the desktop app", () => {
    const { engine } = setup(false);
    engine.playTrack(list[0], list);

    expect(engine.currentState.status).toBe("error");
    expect(engine.currentState.error).toMatch(/desktop app/);
  });
});
