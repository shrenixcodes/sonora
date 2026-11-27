import { describe, it, expect, beforeEach } from "vitest";
import { storage, DEFAULT_SETTINGS } from "../src/lib/storage";
import type { Track, Playlist } from "../src/types/music";

describe("StorageService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns default settings when none stored", () => {
    const settings = storage.getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("persists and updates partial settings", () => {
    const updated = storage.saveSettings({ theme: "light", accentColor: "#315E48" });
    expect(updated.theme).toBe("light");
    expect(updated.accentColor).toBe("#315E48");

    const reloaded = storage.getSettings();
    expect(reloaded.theme).toBe("light");
    expect(reloaded.accentColor).toBe("#315E48");
  });

  it("preserves explicit enableDiscordRpc opt-out across reloads without migration override", () => {
    localStorage.setItem("sonora:settings", JSON.stringify({ enableDiscordRpc: false }));
    expect(storage.getSettings().enableDiscordRpc).toBe(false);

    // Omitted field still defaults to true
    localStorage.setItem("sonora:settings", JSON.stringify({ theme: "light" }));
    expect(storage.getSettings().enableDiscordRpc).toBe(true);
  });

  it("toggles liked tracks accurately", () => {
    const sampleTrack: Track = {
      id: "track_test_123",
      title: "Test Track",
      artist: "Test Artist",
      duration: 180,
      artworkUrl: "http://example.com/art.jpg",
    };

    expect(storage.isLiked(sampleTrack.id)).toBe(false);

    const events: Array<{ trackId: string; isLiked: boolean }> = [];
    const unsub = storage.on("likeChange", (e) => events.push(e));

    const isLikedNow = storage.toggleLike(sampleTrack);
    expect(isLikedNow).toBe(true);
    expect(storage.isLiked(sampleTrack.id)).toBe(true);
    expect(storage.getLikedTracks()).toHaveLength(1);

    const isUnliked = storage.toggleLike(sampleTrack);
    expect(isUnliked).toBe(false);
    expect(storage.isLiked(sampleTrack.id)).toBe(false);
    expect(storage.getLikedTracks()).toHaveLength(0);

    expect(events).toEqual([
      { trackId: sampleTrack.id, isLiked: true, track: sampleTrack },
      { trackId: sampleTrack.id, isLiked: false, track: sampleTrack },
    ]);
    unsub();
  });

  it("tracks listening history and deduplicates recent plays", () => {
    const track1: Track = {
      id: "track_1",
      title: "Song 1",
      artist: "Artist 1",
      duration: 200,
      artworkUrl: "",
    };
    const track2: Track = {
      id: "track_2",
      title: "Song 2",
      artist: "Artist 2",
      duration: 240,
      artworkUrl: "",
    };

    storage.addToHistory(track1);
    storage.addToHistory(track2);
    storage.addToHistory(track1); // play track 1 again

    const history = storage.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("track_1"); // moved to most recent
    expect(history[1].id).toBe("track_2");
  });

  it("adds tracks to a local playlist once and updates its count", () => {
    const track1: Track = { id: "track_1", title: "Song", artist: "Artist", duration: 200, artworkUrl: "" };
    storage.savePlaylist({ id: "pl", title: "Mix", trackCount: 0, tracks: [] });
    expect(storage.addTrackToPlaylist("pl", track1)).toBe("added");
    expect(storage.addTrackToPlaylist("pl", track1)).toBe("duplicate");
    expect(storage.addTrackToPlaylist("missing", track1)).toBe("missing");
    expect(storage.getPlaylists()[0]).toMatchObject({ trackCount: 1, tracks: [track1] });
  });

  it("saves and deletes custom playlists", () => {
    const pl: Playlist = {
      id: "pl_sample",
      title: "Favorites 2026",
      trackCount: 0,
      tracks: [],
    };

    storage.savePlaylist(pl);
    expect(storage.getPlaylists()).toHaveLength(1);

    expect(storage.renamePlaylist("pl_sample", "Favorites 2027")).toBe(true);
    expect(storage.getPlaylists()[0].title).toBe("Favorites 2027");
    expect(storage.renamePlaylist("pl_sample", "   ")).toBe(false);

    const t1: Track = { id: "t_rem", title: "Removable", artist: "Artist", duration: 100, artworkUrl: "" };
    storage.addTrackToPlaylist("pl_sample", t1);
    expect(storage.removeTrackFromPlaylist("pl_sample", "t_rem")).toBe(true);
    expect(storage.getPlaylists()[0].tracks).toHaveLength(0);
    expect(storage.removeTrackFromPlaylist("pl_sample", "missing")).toBe(false);

    storage.deletePlaylist("pl_sample");
    expect(storage.getPlaylists()).toHaveLength(0);
  });

  it("saves and restores playback queue and last-played track", () => {
    const t1: Track = { id: "q1", title: "One", artist: "Artist", duration: 100, artworkUrl: "" };
    const t2: Track = { id: "q2", title: "Two", artist: "Artist", duration: 200, artworkUrl: "" };

    expect(storage.getSavedQueue()).toBeNull();
    expect(storage.getLastTrack()).toBeNull();

    storage.saveQueue({ tracks: [t1, t2], order: [1, 0], position: 0 });
    storage.saveLastTrack(t2);

    expect(storage.getSavedQueue()).toEqual({ tracks: [t1, t2], order: [1, 0], position: 0 });
    expect(storage.getLastTrack()).toEqual(t2);

    storage.saveQueue({ tracks: [], order: [], position: -1 });
    storage.saveLastTrack(null);
    expect(storage.getSavedQueue()).toBeNull();
    expect(storage.getLastTrack()).toBeNull();
  });
});
