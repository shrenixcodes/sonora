import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Track } from "../src/types/music";
import type { YtmCommand, YtmState } from "../src/lib/playback/ytm-bridge";
import { storage } from "../src/lib/storage";

// Keep tests offline: no lyrics requests, no image decoding.
vi.mock("../src/lib/lyrics/providers", () => ({
  lyricsService: {
    getLyrics: async (t: Track) => ({
      trackId: t.id,
      isSynced: true,
      lines: [{ timeMs: 0, text: "first line" }],
      plainLyrics: "first line",
    }),
  },
}));
vi.mock("../src/lib/visuals/color-extractor", () => ({ extractPalette: () => new Promise(() => {}) }));

const { PlaybackEngine } = await import("../src/lib/playback/engine");

const track = (id: string): Track => ({ id, title: `Song ${id}`, artist: "Artist", duration: 200, artworkUrl: "" });
const list = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map(track);
/** Mirrors SKIP_SETTLE_MS in the engine. */
const SKIP_SETTLE_MS = 400;

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

  it("loads once for a run of skips, for the track they land on", () => {
    vi.useFakeTimers();
    try {
      const long = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map(track);
      const { engine, sent } = setup();
      const loads = () => sent.filter((c) => c.action === "load");
      engine.playTrack(long[0], long);

      engine.next();
      expect(loads().at(-1)).toEqual({ action: "load", value: "bbbbbbbbbbb" });

      // Taps that land while the page is still loading are held back.
      engine.next();
      vi.advanceTimersByTime(100);
      engine.next();
      expect(loads()).toHaveLength(2);
      // The queue and the interface still moved with every tap.
      expect(engine.currentTrack?.id).toBe("ddddddddddd");

      vi.advanceTimersByTime(SKIP_SETTLE_MS);
      expect(loads()).toHaveLength(3);
      expect(loads().at(-1)).toEqual({ action: "load", value: "ddddddddddd" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps songs a run of skips passed through out of the history", () => {
    vi.useFakeTimers();
    try {
      const long = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map(track);
      const { engine } = setup();
      engine.playTrack(long[0], long);
      engine.next();
      engine.next();
      engine.next();
      vi.advanceTimersByTime(SKIP_SETTLE_MS);

      // "ccccccccccc" was passed through in a burst and never played.
      expect(storage.getHistory().map((t) => t.id)).toEqual([
        "ddddddddddd",
        "bbbbbbbbbbb",
        "aaaaaaaaaaa",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-applies the chosen volume after each load, since loading resets the page", () => {
    const { engine, sent } = setup();
    engine.setVolume(0.15);
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "ready", videoId: "aaaaaaaaaaa", paused: true, volume: 1 }));

    expect(sent.at(-1)).toEqual({ action: "volume", value: 0.15 });
  });

  it("restores audible volume when unmuting from zero volume", () => {
    const { engine, sent } = setup();
    engine.setVolume(0);
    expect(engine.currentState.isMuted).toBe(true);

    engine.toggleMute();
    expect(engine.currentState.isMuted).toBe(false);
    expect(engine.currentState.volume).toBe(0.8);
    expect(sent.at(-1)).toEqual({ action: "volume", value: 0.8 });
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

  it("holds the current track's lyrics for a view opened mid-song", async () => {
    const { engine } = setup();
    engine.playTrack(list[0], list);
    // Now Playing can be opened long after the lyrics event went out.
    await vi.waitFor(() => expect(engine.currentLyrics?.trackId).toBe("aaaaaaaaaaa"));
  });

  it("drops a lyrics reply for a track the user has already skipped past", async () => {
    const { engine } = setup();
    engine.playTrack(list[0], list);
    await vi.waitFor(() => expect(engine.currentLyrics?.trackId).toBe("aaaaaaaaaaa"));

    engine.playTrack(list[1], list);
    expect(engine.currentLyrics).toBeNull();
    await vi.waitFor(() => expect(engine.currentLyrics?.trackId).toBe("bbbbbbbbbbb"));
  });

  it("explains that playback needs the desktop app", () => {
    const { engine } = setup(false);
    engine.playTrack(list[0], list);

    expect(engine.currentState.status).toBe("error");
    expect(engine.currentState.error).toMatch(/desktop app/);
  });
});
