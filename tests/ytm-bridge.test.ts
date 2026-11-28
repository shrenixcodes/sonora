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
  request(id: number, request: Record<string, unknown>): void;
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
  const originalJsonParse = JSON.parse;
  const originalResponseJson = typeof Response !== "undefined" ? Response.prototype.json : undefined;

  beforeEach(() => {
    localStorage.clear();
    JSON.parse = originalJsonParse;
    if (typeof Response !== "undefined" && originalResponseJson) {
      Response.prototype.json = originalResponseJson;
    }
    vi.useFakeTimers();
    win.__TAURI_INTERNALS__ = { invoke: vi.fn(() => Promise.resolve()) };
  });

  afterEach(() => {
    vi.useRealTimers();
    JSON.parse = originalJsonParse;
    if (typeof Response !== "undefined" && originalResponseJson) {
      Response.prototype.json = originalResponseJson;
    }
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

  it("forwards search params when given and omits them for unfiltered search", async () => {
    setupPage({ ad: false });
    (window as unknown as { ytcfg: { get: (k: string) => unknown } }).ytcfg = {
      get: (key) => (key === "INNERTUBE_CONTEXT" ? { client: { clientName: "WEB_REMIX" } } : undefined),
    };
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "{}" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const bridge = loadBridge();
      bridge.request(1, { kind: "search", query: "fitrat", params: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D" });
      bridge.request(2, { kind: "search", query: "fitrat" });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(firstBody).toMatchObject({ query: "fitrat", params: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D" });
      expect(secondBody).toMatchObject({ query: "fitrat" });
      expect(secondBody).not.toHaveProperty("params");
    } finally {
      vi.unstubAllGlobals();
      delete (window as unknown as { ytcfg?: unknown }).ytcfg;
    }
  });

  it("handles history and rate catalog requests with expected YouTube Music endpoints", async () => {
    setupPage({ ad: false });
    (window as unknown as { ytcfg: { get: (k: string) => unknown } }).ytcfg = {
      get: (key) => (key === "INNERTUBE_CONTEXT" ? { client: { clientName: "WEB_REMIX" } } : undefined),
    };
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "{}" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const bridge = loadBridge();
      bridge.request(10, { kind: "history" });
      bridge.request(11, { kind: "rate", videoId: "dQw4w9WgXcQ", rating: "LIKE" });
      bridge.request(12, { kind: "rate", videoId: "dQw4w9WgXcQ", rating: "INDIFFERENT" });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(fetchMock.mock.calls[0][0]).toContain("/youtubei/v1/browse?");
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
        browseId: "FEmusic_history",
      });

      expect(fetchMock.mock.calls[1][0]).toContain("/youtubei/v1/like/like?");
      expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
        target: { videoId: "dQw4w9WgXcQ" },
      });

      expect(fetchMock.mock.calls[2][0]).toContain("/youtubei/v1/like/removelike?");
      expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toMatchObject({
        target: { videoId: "dQw4w9WgXcQ" },
      });
    } finally {
      vi.unstubAllGlobals();
      delete (window as unknown as { ytcfg?: unknown }).ytcfg;
    }
  });

  it("does nothing outside music.youtube.com", () => {
    setupPage({ ad: false });
    delete win.__sonoraBridge;
    const source = BRIDGE_SOURCE.replace('"music.youtube.com"', '"other.example"');
    new Function(source)();

    expect(win.__sonoraBridge).toBeUndefined();
  });

  describe("audio quality and Web Audio DSP", () => {
    it("prefers highest quality original audio formats in lossless mode and saves bandwidth in saver mode", () => {
      setupPage({ ad: false });
      const bridge = loadBridge();

      const samplePayload = () =>
        JSON.stringify({
          videoDetails: { videoId: "dQw4w9WgXcQ", title: "Track" },
          playerConfig: { audioConfig: { loudnessDb: -4.5 } },
          streamingData: {
            adaptiveFormats: [
              { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 2000000 },
              {
                itag: 249,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 52000,
                audioQuality: "AUDIO_QUALITY_LOW",
                audioSampleRate: "48000",
              },
              {
                itag: 140,
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: 129000,
                audioQuality: "AUDIO_QUALITY_MEDIUM",
                audioSampleRate: "44100",
              },
              {
                itag: 251,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 160000,
                audioQuality: "AUDIO_QUALITY_MEDIUM",
                audioSampleRate: "48000",
              },
              {
                itag: 774,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 256000,
                audioQuality: "AUDIO_QUALITY_HIGH",
                audioSampleRate: "48000",
              },
              {
                itag: 999,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 256000,
                audioQuality: "AUDIO_QUALITY_HIGH",
                audioTrack: { isAutoDubbed: true, audioIsDefault: false },
              },
            ],
          },
        });

      bridge.exec("audioConfig", { quality: "lossless", profile: "clarity", normalizeVolume: true } as unknown as number);
      const losslessParsed = JSON.parse(samplePayload()) as {
        streamingData: { adaptiveFormats: Array<{ itag: number }> };
      };
      expect(losslessParsed.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([137, 774]);

      bridge.exec("audioConfig", { quality: "high", profile: "off", normalizeVolume: true } as unknown as number);
      const highParsed = JSON.parse(samplePayload()) as {
        streamingData: { adaptiveFormats: Array<{ itag: number }> };
      };
      expect(highParsed.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([137, 774, 251, 140]);

      bridge.exec("audioConfig", { quality: "saver", profile: "off", normalizeVolume: false } as unknown as number);
      const saverParsed = JSON.parse(samplePayload()) as {
        streamingData: { adaptiveFormats: Array<{ itag: number }> };
      };
      expect(saverParsed.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([137, 249, 140]);
    });

    it("keeps only the smallest video stream per codec whatever the audio quality", () => {
      setupPage({ ad: false });
      localStorage.setItem("yt-player-quality", JSON.stringify({ data: "auto" }));
      const bridge = loadBridge();

      const payload = () =>
        JSON.stringify({
          videoDetails: { videoId: "dQw4w9WgXcQ", title: "Track" },
          streamingData: {
            adaptiveFormats: [
              { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', height: 1080, bitrate: 4000000 },
              { itag: 160, mimeType: 'video/mp4; codecs="avc1.4d400c"', height: 144, bitrate: 110000 },
              { itag: 248, mimeType: 'video/webm; codecs="vp9"', height: 1080, bitrate: 2600000 },
              { itag: 278, mimeType: 'video/webm; codecs="vp9"', height: 144, bitrate: 95000 },
              { itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', height: 1080, bitrate: 2000000 },
              {
                itag: 251,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 160000,
                audioQuality: "AUDIO_QUALITY_MEDIUM",
              },
            ],
          },
        });

      for (const quality of ["lossless", "high", "balanced", "saver"]) {
        bridge.exec("audioConfig", { quality, profile: "off", normalizeVolume: false } as unknown as number);
        const parsed = JSON.parse(payload()) as { streamingData: { adaptiveFormats: Array<{ itag: number }> } };
        expect(parsed.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([160, 278, 399, 251]);
        expect(JSON.parse(localStorage.getItem("yt-player-quality")!).data).toBe("auto");
      }
    });

    it("leaves video streams alone when audio only comes muxed with video", () => {
      setupPage({ ad: false });
      const bridge = loadBridge();
      bridge.exec("audioConfig", { quality: "high", profile: "off", normalizeVolume: true } as unknown as number);

      const parsed = JSON.parse(
        JSON.stringify({
          videoDetails: { videoId: "dQw4w9WgXcQ" },
          streamingData: {
            adaptiveFormats: [
              { itag: 22, mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"', height: 720 },
              { itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', height: 360 },
            ],
          },
        }),
      ) as { streamingData: { adaptiveFormats: Array<{ itag: number }> } };
      expect(parsed.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([22, 18]);
    });

    it("avoids forcing tiny quality when only muxed formats exist in high or lossless mode", () => {
      const { video, player } = setupPage({ ad: false });
      const playerWithRange = player as HTMLElement & {
        setPlaybackQualityRange: ReturnType<typeof vi.fn>;
        getPlayerResponse: () => unknown;
      };
      playerWithRange.setPlaybackQualityRange = vi.fn();
      playerWithRange.getPlayerResponse = () => ({
        videoDetails: { videoId: "dQw4w9WgXcQ" },
        streamingData: {
          adaptiveFormats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 500000 }],
        },
      });

      const bridge = loadBridge();
      bridge.exec("audioConfig", { quality: "lossless", profile: "off", normalizeVolume: true } as unknown as number);
      video.dispatchEvent(new Event("loadedmetadata"));

      expect(playerWithRange.setPlaybackQualityRange).toHaveBeenLastCalledWith("medium", "hd720");
    });

    it("wires Web Audio EQ, loudness normalization, and safety limiter for blob media", () => {
      const { video } = setupPage({ ad: false });
      Object.defineProperty(video, "currentSrc", {
        value: "blob:https://music.youtube.com/stream-1",
        configurable: true,
      });

      const createdFilters: Array<{
        type: string;
        frequency: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        Q: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        connect: ReturnType<typeof vi.fn>;
      }> = [];
      const createdGains: Array<{ gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn> }> = [];
      const createdCompressors: Array<{
        threshold: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        knee: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        ratio: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        attack: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        release: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
        connect: ReturnType<typeof vi.fn>;
      }> = [];

      const makeParam = (initial = 0) => ({ value: initial, setTargetAtTime: vi.fn() });
      class FakeAudioContext {
        state = "running";
        currentTime = 1.5;
        sampleRate = 48000;
        destination = { kind: "destination" };
        resume = vi.fn(async () => {});
        createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));
        createBiquadFilter = vi.fn(() => {
          const f = { type: "peaking", frequency: makeParam(), Q: makeParam(), gain: makeParam(), connect: vi.fn() };
          createdFilters.push(f);
          return f;
        });
        createGain = vi.fn(() => {
          const g = { gain: makeParam(1), connect: vi.fn() };
          createdGains.push(g);
          return g;
        });
        createDynamicsCompressor = vi.fn(() => {
          const c = {
            threshold: makeParam(),
            knee: makeParam(),
            ratio: makeParam(1),
            attack: makeParam(),
            release: makeParam(),
            connect: vi.fn(),
          };
          createdCompressors.push(c);
          return c;
        });
      }

      vi.stubGlobal("AudioContext", FakeAudioContext);
      try {
        const bridge = loadBridge();
        JSON.parse(
          JSON.stringify({
            videoDetails: { videoId: "dQw4w9WgXcQ" },
            playerConfig: { audioConfig: { loudnessDb: -4.0 } },
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 774,
                  mimeType: 'audio/webm; codecs="opus"',
                  bitrate: 256000,
                  audioSampleRate: "48000",
                  audioQuality: "AUDIO_QUALITY_HIGH",
                },
              ],
            },
          }),
        );

        bridge.exec("audioConfig", { quality: "lossless", profile: "clarity", normalizeVolume: true } as unknown as number);

        expect(createdFilters).toHaveLength(6); // highpass + 5 EQ bands
        expect(createdFilters[0].type).toBe("highpass");
        expect(createdFilters[2].gain.setTargetAtTime).toHaveBeenCalledWith(-2.8, 1.5, 0.05); // 280 Hz de-mud
        expect(createdFilters[5].gain.setTargetAtTime).toHaveBeenCalledWith(2.5, 1.5, 0.05); // 11.5 kHz air
        expect(createdCompressors[0].ratio.setTargetAtTime).toHaveBeenCalledWith(10, 1.5, 0.04);

        const lastReport = win.__TAURI_INTERNALS__!.invoke.mock.calls.at(-1)![1] as {
          state: { reason: string; audioInfo?: { codec?: string; bitrateKbps?: number; dspActive?: boolean; dspSampleRate?: number } };
        };
        expect(lastReport.state.reason).toBe("audio");
        expect(lastReport.state.audioInfo).toMatchObject({
          codec: "Opus",
          bitrateKbps: 256,
          dspActive: true,
          dspSampleRate: 48000,
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("falls back to best available quality without stopping when lossless stream is unavailable", () => {
      const { video } = setupPage({ ad: false });
      const bridge = loadBridge();

      bridge.exec("audioConfig", { quality: "lossless", profile: "off", normalizeVolume: true } as unknown as number);

      const parsed = JSON.parse(
        JSON.stringify({
          videoDetails: { videoId: "dQw4w9WgXcQ", title: "Standard Track" },
          streamingData: {
            adaptiveFormats: [
              {
                itag: 249,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 52000,
                audioQuality: "AUDIO_QUALITY_LOW",
                audioSampleRate: "48000",
              },
              {
                itag: 140,
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: 129000,
                audioQuality: "AUDIO_QUALITY_MEDIUM",
                audioSampleRate: "44100",
              },
              {
                itag: 251,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 160000,
                audioQuality: "AUDIO_QUALITY_MEDIUM",
                audioSampleRate: "48000",
              },
            ],
          },
        }),
      ) as { streamingData: { adaptiveFormats: Array<{ itag: number }> } };

      // Keeps best available non-lossless streams (Opus 160k + AAC 129k) instead of failing
      expect(parsed.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([251, 140]);

      video.dispatchEvent(new Event("loadedmetadata"));
      const last = win.__TAURI_INTERNALS__!.invoke.mock.calls.at(-1)![1] as {
        state: { audioInfo?: { bitrateKbps?: number; effectiveQuality?: string; fallbackUsed?: boolean; fallbackReason?: string } };
      };
      expect(last.state.audioInfo).toMatchObject({
        bitrateKbps: 160,
        effectiveQuality: "high",
        fallbackUsed: true,
      });
      expect(last.state.audioInfo?.fallbackReason).toContain("best available");
    });

    it("recovers playback from current time without stopping when a lossless stream stalls or errors", () => {
      const { video, player } = setupPage({ ad: false });
      const playerWithLoad = player as HTMLElement & { loadVideoById: ReturnType<typeof vi.fn> };
      playerWithLoad.loadVideoById = vi.fn();

      const bridge = loadBridge();
      bridge.exec("audioConfig", { quality: "lossless", profile: "off", normalizeVolume: true } as unknown as number);

      const twoTierPayload = () =>
        JSON.stringify({
          videoDetails: { videoId: "dQw4w9WgXcQ", title: "Track" },
          streamingData: {
            adaptiveFormats: [
              {
                itag: 251,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 160000,
                audioQuality: "AUDIO_QUALITY_MEDIUM",
                audioSampleRate: "48000",
              },
              {
                itag: 774,
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 256000,
                audioQuality: "AUDIO_QUALITY_HIGH",
                audioSampleRate: "48000",
              },
            ],
          },
        });

      const initial = JSON.parse(twoTierPayload()) as { streamingData: { adaptiveFormats: Array<{ itag: number }> } };
      expect(initial.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([774]);

      // Simulate active playback at 42s, then a stall for >4s
      Object.defineProperty(video, "paused", { value: false, configurable: true });
      video.currentTime = 42;
      video.dispatchEvent(new Event("waiting"));
      vi.advanceTimersByTime(4100);

      expect(playerWithLoad.loadVideoById).toHaveBeenCalledWith("dQw4w9WgXcQ", 42);

      // Reloaded playerResponse now includes the fallback 160k stream
      const recovered = JSON.parse(twoTierPayload()) as { streamingData: { adaptiveFormats: Array<{ itag: number }> } };
      expect(recovered.streamingData.adaptiveFormats.map((f) => f.itag)).toEqual([251]);

      const reportStates = win.__TAURI_INTERNALS__!.invoke.mock.calls.map(
        ([, args]) => (args as { state: { reason: string; audioInfo?: { fallbackUsed?: boolean; effectiveQuality?: string } } }).state,
      );
      expect(reportStates.some((s) => s.reason === "audio" && s.audioInfo?.fallbackUsed && s.audioInfo.effectiveQuality === "high")).toBe(true);
    });
  });
});
