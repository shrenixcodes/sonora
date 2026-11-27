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

  it("skips through Sonora's queue from media keys", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa" }));

    engine.handleBridgeState(report({ reason: "media-next", videoId: "aaaaaaaaaaa" }));

    expect(sent.at(-1)).toEqual({ action: "load", value: "bbbbbbbbbbb" });
    expect(engine.currentTrack?.id).toBe("bbbbbbbbbbb");
  });

  it("goes back a track from media keys near the start of a song", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[1], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "bbbbbbbbbbb", currentTime: 1 }));

    engine.handleBridgeState(report({ reason: "media-previous", videoId: "bbbbbbbbbbb", currentTime: 1 }));

    expect(sent.at(-1)).toEqual({ action: "load", value: "aaaaaaaaaaa" });
    expect(engine.currentTrack?.id).toBe("aaaaaaaaaaa");
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

  it("plays the next track in Sonora's queue when the page moves on while tracks are upcoming", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa" }));

    // Page finishes track and auto-advances to an unqueued radio track
    engine.handleBridgeState(
      report({ reason: "track", videoId: "zzzzzzzzzzz", title: "Radio pick", artist: "Someone", artworkUrl: "art.jpg" }),
    );

    // Instead of adopting the foreign radio pick, Sonora advances to list[1]
    expect(engine.currentTrack?.id).toBe(list[1].id);
    expect(sent.at(-1)).toEqual({ action: "load", value: list[1].id });
  });

  it("follows the page when it plays a different track than the one asked for", () => {
    const { engine } = setup();
    engine.playTrack(list[0], list);
    expect(engine.currentState.status).toBe("loading");

    // Seen live: YouTube Music can put on a song of its own instead of ours.
    engine.handleBridgeState(
      report({
        reason: "track",
        videoId: "zzzzzzzzzzz",
        title: "Something else",
        artist: "Someone",
        currentTime: 12,
      }),
    );

    // Waiting for an id that is never coming would freeze the interface on the
    // wrong song, with the wrong lyrics, while the music played on.
    expect(engine.currentTrack?.id).toBe("zzzzzzzzzzz");
    expect(engine.currentState.status).toBe("playing");
    expect(engine.currentState.currentTime).toBe(12);
  });

  it("confirms playback when the page reports matching title or active playback without videoId", () => {
    const { engine } = setup();
    engine.playTrack(list[0], list);
    expect(engine.currentState.status).toBe("loading");

    engine.handleBridgeState(
      report({
        reason: "play",
        videoId: null,
        title: "Song aaaaaaaaaaa",
        artist: "Artist",
        currentTime: 0.5,
        paused: false,
      }),
    );

    expect(engine.currentState.status).toBe("playing");
    expect(engine.currentState.currentTime).toBe(0.5);
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

  it("syncs audio quality settings with the bridge and stores reported audio telemetry", () => {
    const { engine, sent } = setup();

    engine.handleBridgeState(
      report({
        reason: "ready",
        paused: true,
        audioInfo: { codec: "Opus", bitrateKbps: 160, sampleRate: 48000, dspActive: true },
      }),
    );

    expect(sent[0]).toEqual({
      action: "audioConfig",
      value: { quality: "high", profile: "off", normalizeVolume: true },
    });
    expect(engine.currentState.audioInfo).toMatchObject({ codec: "Opus", bitrateKbps: 160, dspActive: true });

    storage.saveSettings({ audioQuality: "lossless", audioEnhancement: "clarity", normalizeVolume: false });
    expect(sent.at(-1)).toEqual({
      action: "audioConfig",
      value: { quality: "lossless", profile: "clarity", normalizeVolume: false },
    });

    const beforeCount = sent.length;
    storage.saveSettings({ theme: "light" });
    expect(sent).toHaveLength(beforeCount);
  });

  it("respects autoPlayNext=false at queue end on next(), track end, and unexpected page advance", () => {
    storage.saveSettings({ autoPlayNext: false });
    const { engine, sent } = setup();
    engine.playTrack(list[2], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "ccccccccccc" }));

    const beforeNext = sent.length;
    engine.next();
    expect(sent.slice(beforeNext)).toEqual([]);

    engine.handleBridgeState(report({ reason: "ended", videoId: "ccccccccccc", paused: true, currentTime: 200 }));
    expect(sent.some((c) => c.action === "next")).toBe(false);
    expect(engine.currentState.status).toBe("paused");
    expect(engine.currentTrack?.id).toBe("ccccccccccc");

    // If the page tries to play a recommendation on its own while autoPlayNext is off, pause it
    engine.handleBridgeState(
      report({ reason: "track", videoId: "zzzzzzzzzzz", title: "Unwanted radio", artist: "Someone" }),
    );
    expect(engine.currentTrack?.id).toBe("ccccccccccc");
    expect(sent.at(-1)).toEqual({ action: "pause" });
  });

  it("reloads currentTrack instead of seeking to 0 when repeat is set to one", () => {
    const { engine, sent } = setup();
    engine.playTrack(list[0], list);
    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa" }));
    engine.cycleRepeat(); // off -> all
    engine.cycleRepeat(); // all -> one
    expect(engine.currentState.repeat).toBe("one");

    const beforeEnded = sent.length;
    engine.handleBridgeState(report({ reason: "ended", videoId: "aaaaaaaaaaa", paused: true }));
    expect(sent.slice(beforeEnded)).toEqual([{ action: "load", value: "aaaaaaaaaaa" }]);
    expect(engine.currentTrack?.id).toBe("aaaaaaaaaaa");

    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa" }));

    // Embedded player already moved on to another video: reload currentTrack.id and ignore stale track report
    const beforeOther = sent.length;
    engine.handleBridgeState(
      report({ reason: "track", videoId: "zzzzzzzzzzz", title: "Next video", artist: "Other" }),
    );
    expect(sent.slice(beforeOther)).toEqual([{ action: "load", value: "aaaaaaaaaaa" }]);
    expect(engine.currentTrack?.id).toBe("aaaaaaaaaaa");

    // A delayed "track" report for the skipped-past video while reloading must not hijack currentTrack
    engine.handleBridgeState(
      report({ reason: "track", videoId: "zzzzzzzzzzz", title: "Next video", artist: "Other" }),
    );
    expect(engine.currentTrack?.id).toBe("aaaaaaaaaaa");

    engine.handleBridgeState(report({ reason: "play", videoId: "aaaaaaaaaaa" }));
    expect(engine.currentState.status).toBe("playing");
  });

  it("does not time out during pre-roll ads longer than 15 seconds and times out if target stalls afterwards", () => {
    vi.useFakeTimers();
    try {
      const { engine } = setup();
      engine.playTrack(list[1], list);
      expect(engine.currentState.status).toBe("loading");

      // Ad plays with its own videoId and title for 25 seconds
      engine.handleBridgeState(
        report({ reason: "play", videoId: "adVideo1234", title: "Long Pre-roll Ad", ad: true, paused: false, duration: 25 }),
      );
      expect(engine.currentState.isAd).toBe(true);
      expect(engine.currentState.status).toBe("playing");
      expect(engine.currentTrack?.id).toBe("bbbbbbbbbbb");

      vi.advanceTimersByTime(25_000);
      expect(engine.currentState.status).toBe("playing");
      expect(engine.currentState.error).toBeUndefined();

      // Real track confirms after the ad finishes
      engine.handleBridgeState(
        report({ reason: "track", videoId: "bbbbbbbbbbb", title: "Song bbbbbbbbbbb", ad: false, currentTime: 0.2 }),
      );
      expect(engine.currentState.isAd).toBe(false);
      expect(engine.currentState.status).toBe("playing");

      // If ad ends without target confirming, load timeout resumes for the target track
      engine.playTrack(list[2], list);
      engine.handleBridgeState(
        report({ reason: "play", videoId: "adVideo9999", title: "Another Ad", ad: true, paused: false }),
      );
      vi.advanceTimersByTime(20_000);
      expect(engine.currentState.status).toBe("playing");

      engine.handleBridgeState(
        report({ reason: "time", videoId: "adVideo9999", title: "Another Ad", ad: false, currentTime: 0 }),
      );
      expect(engine.currentState.status).toBe("loading");
      vi.advanceTimersByTime(16_000);
      expect(engine.currentState.status).toBe("error");
      expect(engine.currentState.error).toMatch(/couldn't play/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists queue and current track and restores them on startup without auto-playing", () => {
    const first = setup();
    first.engine.playTrack(list[1], list);
    first.engine.handleBridgeState(report({ reason: "play", videoId: "bbbbbbbbbbb" }));
    first.engine.playNext(list[0]);

    const second = setup();
    expect(second.sent).toEqual([]);
    expect(second.engine.currentTrack?.id).toBe("bbbbbbbbbbb");
    expect(second.engine.currentState.status).toBe("paused");
    expect(second.engine.upcoming.map((t) => t.id)).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
    expect(storage.getHistory()).toHaveLength(1); // restoring did not record a duplicate play

    // Pressing Play loads the restored track cleanly into the webview
    second.engine.togglePlay();
    expect(second.sent).toEqual([{ action: "load", value: "bbbbbbbbbbb" }]);
    expect(second.engine.currentState.status).toBe("loading");
  });
});
