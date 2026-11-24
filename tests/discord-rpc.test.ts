import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordRpcService, type DiscordActivityPayload } from "../src/lib/discord-rpc";
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
      canSkipAd: false,
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
      canSkipAd: false,
    };

    service.handleStateChange(emptyState);
    expect(cleared).toBe(true);
  });
});
