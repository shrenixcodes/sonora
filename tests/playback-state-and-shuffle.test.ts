import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackEngine, playerEngine, type PlaybackBridge } from "../src/lib/playback/engine";
import { DEFAULT_SETTINGS, storage } from "../src/lib/storage";
import { account } from "../src/lib/ytm/account";
import { catalog } from "../src/lib/ytm/catalog";
import * as ytmClient from "../src/lib/ytm/client";
import { renderArtist } from "../src/views/artist";
import { renderCollection } from "../src/views/collection";
import { renderLibrary } from "../src/views/library";
import type { Track } from "../src/types/music";

const tracks: Track[] = [
  { id: "t1", title: "Track One", artist: "Artist A", album: "Album A", duration: 180, artworkUrl: "" },
  { id: "t2", title: "Track Two", artist: "Artist B", album: "Album B", duration: 190, artworkUrl: "" },
  { id: "t3", title: "Track Three", artist: "Artist C", album: "Album C", duration: 200, artworkUrl: "" },
  { id: "t4", title: "Track Four", artist: "Artist D", album: "Album D", duration: 210, artworkUrl: "" },
];

function fakeBridge(): PlaybackBridge {
  return {
    available: true,
    control: vi.fn(async () => {}),
    onState: vi.fn(async () => {}),
  };
}

describe("Playback startup state, shuffle randomization, and account likes", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("sonora:discord_rpc_migrated", "true");
    account.update(false);
    window.location.hash = "#/";
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("restores isMuted from zero startup volume and persists shuffle and repeat", () => {
    storage.saveSettings({ volume: 0, shuffle: true, repeat: "one" });

    const restored = new PlaybackEngine(fakeBridge());
    expect(restored.currentState).toMatchObject({
      volume: 0,
      isMuted: true,
      shuffle: true,
      repeat: "one",
    });

    restored.toggleShuffle();
    restored.cycleRepeat();

    expect(storage.getSettings()).toMatchObject({
      ...DEFAULT_SETTINGS,
      volume: 0,
      shuffle: false,
      repeat: "off",
    });

    const reopened = new PlaybackEngine(fakeBridge());
    expect(reopened.currentState).toMatchObject({
      volume: 0,
      isMuted: true,
      shuffle: false,
      repeat: "off",
    });
  });

  it("starts shuffled playback on a random track rather than track index 0", async () => {
    const engine = new PlaybackEngine(fakeBridge());
    const playSpy = vi.spyOn(engine, "playTrack");

    await engine.playShuffled(tracks, () => 0.75);

    expect(engine.currentState.shuffle).toBe(true);
    expect(storage.getSettings().shuffle).toBe(true);
    expect(playSpy).toHaveBeenCalledWith(tracks[3], tracks);
    expect(engine.currentTrack?.id).toBe("t4");
  });

  it("routes view Shuffle buttons through playShuffled", async () => {
    vi.spyOn(ytmClient, "catalogAvailable").mockReturnValue(true);
    const playShuffled = vi.spyOn(playerEngine, "playShuffled").mockResolvedValue();
    storage.toggleLike(tracks[0]);
    storage.toggleLike(tracks[1]);

    const libHost = document.createElement("div");
    window.location.hash = "#/liked";
    renderLibrary(libHost);
    const libButtons = Array.from(libHost.querySelectorAll("button"));
    libButtons.find((btn) => btn.textContent?.includes("Shuffle"))!.click();
    expect(playShuffled).toHaveBeenCalledTimes(1);

    playShuffled.mockClear();
    storage.savePlaylist({
      id: "pl_mix",
      title: "Mix",
      tracks,
      trackCount: tracks.length,
      isCustom: true,
    });
    const colHost = document.createElement("div");
    document.body.appendChild(colHost);
    window.location.hash = "#/playlist?source=local&id=pl_mix";
    renderCollection(colHost);
    Array.from(colHost.querySelectorAll("button")).find((btn) => btn.textContent?.includes("Shuffle"))!.click();
    expect(playShuffled).toHaveBeenCalledWith(tracks);

    playShuffled.mockClear();
    vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue(tracks);
    const ytmColHost = document.createElement("div");
    document.body.appendChild(ytmColHost);
    window.location.hash = "#/playlist?source=ytm&id=PL_YTM&kind=playlist&title=Cloud";
    renderCollection(ytmColHost);
    await vi.waitFor(() => {
      const shuffle = Array.from(ytmColHost.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        b.textContent?.includes("Shuffle"),
      );
      expect(shuffle?.disabled).toBe(false);
    });
    Array.from(ytmColHost.querySelectorAll("button")).find((btn) => btn.textContent?.includes("Shuffle"))!.click();
    expect(playShuffled).toHaveBeenCalledWith(tracks);

    playShuffled.mockClear();
    vi.spyOn(catalog, "getArtist").mockResolvedValue({
      id: "UC_ART",
      name: "Artist A",
      artworkUrl: "",
      topSongs: tracks,
      shelves: [],
    });
    const artHost = document.createElement("div");
    document.body.appendChild(artHost);
    window.location.hash = "#/artist?id=UC_ART&name=Artist%20A";
    renderArtist(artHost);
    await vi.waitFor(() => {
      const shuffle = Array.from(artHost.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        b.textContent?.includes("Shuffle"),
      );
      expect(shuffle?.disabled).toBe(false);
    });
    Array.from(artHost.querySelectorAll("button")).find((b) => b.textContent?.includes("Shuffle"))!.click();
    expect(playShuffled).toHaveBeenCalledWith(tracks);
  });

  it("enables unliking account-synced tracks in Liked Music", async () => {
    vi.spyOn(ytmClient, "catalogAvailable").mockReturnValue(true);
    account.update(true);
    vi.spyOn(catalog, "getLikedSongs").mockResolvedValue([tracks[0], tracks[1]]);
    const rateTrack = vi.spyOn(catalog, "rateTrack").mockResolvedValue();

    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/liked";
    renderLibrary(host);

    await vi.waitFor(() => {
      expect(host.querySelectorAll(".track-row")).toHaveLength(2);
    });

    const firstLikeBtn = host.querySelector<HTMLButtonElement>('.track-row[data-track-id="t1"] .track-row__like-btn')!;
    expect(firstLikeBtn.disabled).toBe(false);

    firstLikeBtn.click();

    expect(rateTrack).toHaveBeenCalledWith("t1", false);
    expect(storage.isLiked("t1")).toBe(false);
    expect(host.querySelectorAll(".track-row")).toHaveLength(1);
    expect(host.querySelector('.track-row[data-track-id="t2"]')).not.toBeNull();
  });
});
