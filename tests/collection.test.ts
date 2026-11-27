import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCollectionCard, createSongCard } from "../src/components/shelves";
import { renderCollection } from "../src/views/collection";
import { renderLibrary } from "../src/views/library";
import { catalog } from "../src/lib/ytm/catalog";
import { playerEngine } from "../src/lib/playback/engine";
import { router } from "../src/lib/router";
import { storage } from "../src/lib/storage";
import type { Track } from "../src/types/music";

const track = (id: string, title = `Track ${id}`): Track => ({
  id,
  title,
  artist: "Artist",
  album: "Album",
  duration: 185,
  artworkUrl: "https://example.com/art.jpg",
});

describe("Collection cards and playlist detail view", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "#/";
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("opens playlist track list on card click and plays only when play button is clicked", async () => {
    const tracks = [track("t1", "First Song"), track("t2", "Second Song")];
    const getPlaylistTracks = vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue(tracks);
    const playTrack = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();

    const host = document.createElement("div");
    document.body.appendChild(host);
    router.route("/", () => {});
    router.route("/playlist", renderCollection);
    router.start(host);

    const card = createCollectionCard({
      kind: "playlist",
      title: "Focus Mix",
      subtitle: "Productivity FM",
      artworkUrl: "https://example.com/pl.jpg",
      playlistId: "PL_FOCUS",
    });
    host.appendChild(card);

    // Clicking the card body/title opens the playlist view without playing
    card.querySelector<HTMLElement>(".shelf-card__title")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(window.location.hash).toContain("#/playlist?");
    expect(playTrack).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(host.querySelectorAll(".track-row")).toHaveLength(2);
    });
    expect(host.querySelector(".collection__title")?.textContent).toBe("Focus Mix");

    // Clicking a track inside the playlist detail view plays it with the playlist queue
    host.querySelectorAll<HTMLElement>(".track-row")[1].click();
    expect(playTrack).toHaveBeenCalledWith(tracks[1], tracks);

    // Clicking the hover play button on the card plays immediately without navigating
    playTrack.mockClear();
    getPlaylistTracks.mockClear();
    window.location.hash = "#/";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    const card2 = createCollectionCard({
      kind: "playlist",
      title: "Chill Mix",
      subtitle: "Shai",
      artworkUrl: "https://example.com/chill.jpg",
      playlistId: "PL_CHILL",
    });
    host.appendChild(card2);

    card2.querySelector<HTMLButtonElement>(".shelf-card__play")!.click();
    await vi.waitFor(() => {
      expect(playTrack).toHaveBeenCalledWith(tracks[0], tracks);
    });
    expect(window.location.hash).toBe("#/");
  });

  it("keeps song cards playing directly on click", () => {
    const playTrack = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    const song = track("s1", "Single Song");
    const card = createSongCard(song, [song]);
    card.click();
    expect(playTrack).toHaveBeenCalledWith(song, [song]);
  });

  it("opens local Sonora playlists on card click and plays on corner play button click", async () => {
    const playTrack = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    const songs = [track("loc1", "Local One"), track("loc2", "Local Two")];
    storage.savePlaylist({
      id: "pl_local",
      title: "Late Night",
      trackCount: 2,
      tracks: songs,
      isCustom: true,
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/playlists";
    router.route("/playlists", renderLibrary);
    router.route("/playlist", renderCollection);
    router.start(host);

    const card = host.querySelector<HTMLElement>(".card-grid .card")!;
    expect(card).not.toBeNull();

    // Clicking the corner play button plays without navigating
    card.querySelector<HTMLButtonElement>(".card__play-corner")!.click();
    expect(playTrack).toHaveBeenCalledWith(songs[0], songs);
    expect(window.location.hash).toBe("#/playlists");

    // Clicking elsewhere on the card opens the local playlist track list
    playTrack.mockClear();
    card.querySelector<HTMLElement>(".card__title")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(window.location.hash).toContain("#/playlist?");
    expect(playTrack).not.toHaveBeenCalled();
    expect(host.querySelector(".collection__title")?.textContent).toBe("Late Night");
    expect(host.querySelectorAll(".track-row")).toHaveLength(2);
  });

  it("supports renaming, removing tracks from, and deleting local playlists", () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };

    const songs = [track("loc1", "Local One"), track("loc2", "Local Two")];
    storage.savePlaylist({
      id: "pl_manage",
      title: "Original Name",
      trackCount: 2,
      tracks: songs,
      isCustom: true,
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/playlist?source=local&id=pl_manage";
    router.route("/playlists", renderLibrary);
    router.route("/playlist", renderCollection);
    router.start(host);

    // Remove first song via row remove button
    host.querySelector<HTMLButtonElement>('.track-row[data-track-id="loc1"] .track-row__remove-btn')!.click();
    expect(storage.getPlaylists()[0].tracks.map((t) => t.id)).toEqual(["loc2"]);
    expect(host.querySelectorAll(".track-row")).toHaveLength(1);

    // Rename playlist via Rename button modal
    const renameBtn = Array.from(host.querySelectorAll<HTMLButtonElement>(".page-header__actions button"))
      .find((b) => b.textContent === "Rename")!;
    renameBtn.click();
    const renameDialog = document.querySelector<HTMLDialogElement>("dialog.sonora-dialog")!;
    const input = renameDialog.querySelector<HTMLInputElement>("input")!;
    input.value = "Renamed Mix";
    renameDialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(storage.getPlaylists()[0].title).toBe("Renamed Mix");
    expect(host.querySelector(".collection__title")?.textContent).toBe("Renamed Mix");

    // Delete playlist via Delete button confirmation modal
    const deleteBtn = Array.from(host.querySelectorAll<HTMLButtonElement>(".page-header__actions button"))
      .find((b) => b.textContent === "Delete")!;
    deleteBtn.click();
    const confirmDialog = document.querySelector<HTMLDialogElement>("dialog.sonora-dialog")!;
    const confirmDeleteBtn = Array.from(confirmDialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent === "Delete")!;
    confirmDeleteBtn.click();

    expect(storage.getPlaylists()).toHaveLength(0);
    expect(window.location.hash).toBe("#/playlists");
  });
});
