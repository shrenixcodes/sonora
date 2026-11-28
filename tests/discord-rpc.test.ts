import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DiscordRpcService,
  presenceDuration,
  presenceElapsed,
  type DiscordActivityPayload,
} from "../src/lib/discord-rpc";
import type { Track, PlaybackState } from "../src/types/music";

describe("DiscordRpcService", () => {
  let service: DiscordRpcService;
  let sentActivity: DiscordActivityPayload | null = null;
  let cleared = false;

  const mockTrack: Track = {
    id: "track-1",
    title: "Starboy",
    artist: "The Weeknd",
    album: "Starboy",
    duration: 230,
    artworkUrl: "https://example.com/art.jpg",
  };

  beforeEach(() => {
    service = new DiscordRpcService();
    sentActivity = null;
    cleared = false;

    // Spy on sendActivity and clearActivity
    vi.spyOn(service, "sendActivity").mockImplementation((payload) => {
      sentActivity = payload;
    });
    vi.spyOn(service, "clearActivity").mockImplementation(() => {
      cleared = true;
      sentActivity = null;
    });
  });

  it("handles track change by sending active track details", () => {
    service.handleTrackChange(mockTrack);
    expect(sentActivity).not.toBeNull();
    expect(sentActivity?.title).toBe("Starboy");
    expect(sentActivity?.artist).toBe("The Weeknd");
    expect(sentActivity?.album).toBe("Starboy");
    expect(sentActivity?.artworkUrl).toBe("https://example.com/art.jpg");
  });

  it("clears activity when track changes to null", () => {
    service.handleTrackChange(null);
    expect(cleared).toBe(true);
    expect(sentActivity).toBeNull();
  });

  it("formats playing vs paused state correctly", () => {
    const playingState: PlaybackState = {
      currentTrack: mockTrack,
      status: "playing",
      currentTime: 45,
      duration: 230,
      volume: 0.8,
      isMuted: false,
      shuffle: false,
      repeat: "off",
      playbackRate: 1.0,
      isAd: false,
    };

    service.handleStateChange(playingState);
    expect(sentActivity?.isPlaying).toBe(true);
    expect(sentActivity?.elapsedSeconds).toBe(45);

    const pausedState: PlaybackState = {
      ...playingState,
      status: "paused",
    };

    service.handleStateChange(pausedState);
    expect(sentActivity?.isPlaying).toBe(false);
  });

  it("clears activity when state has no track", () => {
    const emptyState: PlaybackState = {
      currentTrack: null,
      status: "idle",
      currentTime: 0,
      duration: 0,
      volume: 0.8,
      isMuted: false,
      shuffle: false,
      repeat: "off",
      playbackRate: 1.0,
      isAd: false,
    };

    service.handleStateChange(emptyState);
    expect(cleared).toBe(true);
  });

  it("uses the engine's guarded duration over a polluted track duration", () => {
    // track.duration picked up a crossfaded stream's length (39:18); the
    // engine's state.duration is the real 2:50 the player bar shows.
    const polluted: Track = { ...mockTrack, duration: 2358 };
    service.handleStateChange({
      currentTrack: polluted,
      status: "playing",
      currentTime: 60,
      duration: 170,
      volume: 0.8,
      isMuted: false,
      shuffle: false,
      repeat: "off",
      playbackRate: 1.0,
      isAd: false,
    });
    expect(sentActivity?.durationSeconds).toBe(170);
    expect(sentActivity?.elapsedSeconds).toBe(60);
  });

  it("falls back to the track duration on a track change", () => {
    service.handleTrackChange({ ...mockTrack, duration: 170 });
    expect(sentActivity?.durationSeconds).toBe(170);
  });
});

it("does not re-send when the clock is held at the end of the track", () => {
  const service = new DiscordRpcService();
  const sent: DiscordActivityPayload[] = [];
  vi.spyOn(service, "sendActivity").mockImplementation((payload) => {
    sent.push(payload);
    (service as unknown as { lastActivity: DiscordActivityPayload }).lastActivity = payload;
    (service as unknown as { lastSendTimestamp: number }).lastSendTimestamp = Date.now() - 30_000;
  });
  const track: Track = { id: "t", title: "Like You Do", artist: "Joji", duration: 247, artworkUrl: "" };
  const state = (currentTime: number) =>
    ({
      currentTrack: track,
      status: "playing",
      currentTime,
      duration: 247,
      volume: 1,
      isMuted: false,
      shuffle: false,
      repeat: "off",
      playbackRate: 1,
      isAd: false,
    }) as PlaybackState;

  service.handleStateChange(state(200));
  expect(sent).toHaveLength(1);
  // 30 s of wall clock later the engine still reports 247: held, not a seek.
  service.handleStateChange(state(247));
  expect(sent).toHaveLength(1);
  expect(sent[0].elapsedSeconds).toBeLessThan(sent[0].durationSeconds!);
});

describe("presence helpers", () => {
  const track: Track = { id: "t", title: "2112", artist: "Reality Club", duration: 175, artworkUrl: "" };
  const state = (duration: number) =>
    ({ currentTrack: track, status: "playing", currentTime: 0, duration }) as PlaybackState;

  it("prefers state.duration and falls back to track.duration", () => {
    expect(presenceDuration(track, state(170.4))).toBe(170);
    expect(presenceDuration(track, state(0))).toBe(175);
    expect(presenceDuration(track)).toBe(175);
    expect(presenceDuration({ ...track, duration: 0 })).toBeUndefined();
  });

  it("never reports elapsed time past the duration", () => {
    expect(presenceElapsed(175.2, 170)).toBe(169);
    expect(presenceElapsed(170, 170)).toBe(169);
    expect(presenceElapsed(42.6, 170)).toBe(43);
    expect(presenceElapsed(-1, undefined)).toBe(0);
  });
});
