import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
});

import { createPlayer } from "../src/components/player";
import { createQueuePanel } from "../src/components/queue-panel";
import { createCollectionCard, createSongCard, renderShelves } from "../src/components/shelves";
import { catalog } from "../src/lib/ytm/catalog";
import { playerEngine } from "../src/lib/playback/engine";
import { router } from "../src/lib/router";
import { storage } from "../src/lib/storage";
import { renderArtist } from "../src/views/artist";
import { renderCollection } from "../src/views/collection";
import { renderLibrary } from "../src/views/library";
import { renderNowPlaying } from "../src/views/now-playing";
import { renderSearch } from "../src/views/search";
import { searchQuery } from "../src/lib/search-query";
import type { PlaybackState, Track } from "../src/types/music";

const sampleTrack = (overrides: Partial<Track> = {}): Track => ({
  id: "trk1",
  title: "Yellow",
  artist: "Coldplay",
  artistId: "UC_COLDPLAY",
  album: "Parachutes",
  albumId: "MPREb_PARA",
  duration: 267,
  artworkUrl: "https://example.com/yellow.jpg",
  ...overrides,
});

const playbackState = (track: Track | null, overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  status: track ? "playing" : "idle",
  currentTrack: track,
  currentTime: 0,
  duration: track?.duration ?? 0,
  volume: 1,
  isMuted: false,
  isAd: false,
  error: null,
  repeat: "off",
  shuffle: false,
  ...overrides,
});

describe("Clickable artist and album navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    searchQuery.set("");
    delete document.documentElement.dataset.immersive;
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
    window.location.hash = "#/";
  });

  afterEach(() => {
    delete document.documentElement.dataset.immersive;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens artist page from the bottom player bar and disables when no clickable artist exists", () => {
    const track = sampleTrack();
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(track);
    vi.spyOn(playerEngine, "currentState", "get").mockReturnValue(playbackState(track));
    const getArtist = vi.spyOn(catalog, "getArtist").mockResolvedValue({
      id: "UC_COLDPLAY",
      name: "Coldplay",
      artworkUrl: "https://example.com/coldplay.jpg",
      topSongs: [track],
      shelves: [],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    router.route("/", () => {});
    router.route("/artist", renderArtist);
    router.start(host);

    const bar = createPlayer();
    document.body.appendChild(bar);

    const artistBtn = bar.querySelector<HTMLButtonElement>(".player__artist")!;
    expect(artistBtn.textContent).toBe("Coldplay");
    expect(artistBtn.disabled).toBe(false);

    artistBtn.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(window.location.hash).toContain("#/artist?");
    expect(window.location.hash).toContain("id=UC_COLDPLAY");
    expect(getArtist).toHaveBeenCalledWith("UC_COLDPLAY", "Coldplay");

    // During loading / ad / error status replacement, artist button is disabled
    playerEngine.emit("stateChange", playbackState(track, { status: "loading" }));
    expect(artistBtn.textContent).toBe("Loading…");
    expect(artistBtn.disabled).toBe(true);
  });

  it("opens artist and album from fullscreen Now Playing while exiting immersive mode", async () => {
    const track = sampleTrack();
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(track);
    vi.spyOn(playerEngine, "currentState", "get").mockReturnValue(playbackState(track));
    vi.spyOn(catalog, "getArtist").mockResolvedValue({
      id: "UC_COLDPLAY",
      name: "Coldplay",
      artworkUrl: "https://example.com/coldplay.jpg",
      topSongs: [track],
      shelves: [],
    });
    const getPlaylistTracks = vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue([track]);

    const main = document.createElement("main");
    const container = document.createElement("div");
    main.appendChild(container);
    document.body.appendChild(main);

    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

    window.location.hash = "#/now-playing";
    router.route("/", () => {});
    router.route("/now-playing", renderNowPlaying);
    router.route("/artist", renderArtist);
    router.route("/playlist", renderCollection);
    router.start(container);

    // Enter fullscreen presentation first
    container.querySelector<HTMLButtonElement>(".now-playing__fs-btn")!.click();
    expect(document.documentElement.hasAttribute("data-immersive")).toBe(true);

    // Clicking artist exits fullscreen and navigates to Artist page
    container.querySelector<HTMLButtonElement>(".now-playing__artist")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.documentElement.hasAttribute("data-immersive")).toBe(false);
    expect(window.location.hash).toContain("#/artist?");
    expect(window.location.hash).toContain("id=UC_COLDPLAY");

    // Return to fullscreen Now Playing and click album
    window.location.hash = "#/now-playing";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    container.querySelector<HTMLButtonElement>(".now-playing__fs-btn")!.click();
    expect(document.documentElement.hasAttribute("data-immersive")).toBe(true);

    container.querySelector<HTMLButtonElement>(".now-playing__album")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.documentElement.hasAttribute("data-immersive")).toBe(false);
    expect(window.location.hash).toContain("#/playlist?");
    expect(window.location.hash).toContain("kind=album");
    expect(window.location.hash).toContain("id=MPREb_PARA");
    expect(getPlaylistTracks).toHaveBeenCalledWith("MPREb_PARA", expect.any(Function));

    await vi.waitFor(() => {
      expect(container.querySelectorAll(".track-row")).toHaveLength(1);
    });
  });

  it("renders artist page via name lookup fallback and makes album subtitle artist clickable", async () => {
    const track = sampleTrack({ artistId: undefined, albumId: undefined });
    const searchSpy = vi.spyOn(catalog, "search").mockImplementation(async (_q, filter) => {
      if (filter === "artists") {
        return {
          songs: [],
          collections: [{ kind: "artist", title: "Coldplay", subtitle: "Artist", artworkUrl: "", artistId: "UC_RESOLVED" }],
        };
      }
      return {
        songs: [],
        collections: [{ kind: "album", title: "Parachutes", subtitle: "Coldplay", artworkUrl: "", playlistId: "OLAK_PARA" }],
      };
    });
    const getArtist = vi.spyOn(catalog, "getArtist").mockResolvedValue({
      id: "UC_RESOLVED",
      name: "Coldplay",
      subscribers: "27M subscribers",
      description: "British band.",
      artworkUrl: "https://example.com/cp.jpg",
      topSongs: [track],
      topSongsPlaylistId: "PL_TOP_CP",
      shelves: [],
    });
    const getPlaylistTracks = vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue([sampleTrack()]);

    const host = document.createElement("div");
    document.body.appendChild(host);
    router.route("/", () => {});
    router.route("/artist", renderArtist);
    router.route("/playlist", renderCollection);
    router.start(host);

    // Navigate directly to artist by name without id
    router.navigate("/artist?name=Coldplay");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await vi.waitFor(() => {
      expect(host.querySelector(".artist-page__description")?.textContent).toBe("British band.");
    });
    expect(searchSpy).toHaveBeenCalledWith("Coldplay", "artists");
    expect(getArtist).toHaveBeenCalledWith("UC_RESOLVED", "Coldplay");
    expect(host.querySelector(".collection__subtitle")?.textContent).toBe("27M subscribers · 1 top songs");

    // Clicking album column inside Artist top songs resolves album via search("albums")
    host.querySelector<HTMLButtonElement>(".track-row__album.track-row__link")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(window.location.hash).toContain("#/playlist?");
    await vi.waitFor(() => {
      expect(getPlaylistTracks).toHaveBeenCalledWith("OLAK_PARA", expect.any(Function));
      expect(host.querySelector(".collection__subtitle-link")?.textContent).toBe("Coldplay");
    });

    // Clicking artist name in the Album hero header returns to the Artist page
    host.querySelector<HTMLButtonElement>(".collection__subtitle-link")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(window.location.hash).toContain("#/artist?");
    expect(window.location.hash).toContain("id=UC_COLDPLAY");
  });

  it("opens artist or album across shelves, quick tiles, library, search, and queue without playing", async () => {
    const track = sampleTrack();
    const playTrack = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    vi.spyOn(catalog, "getArtist").mockResolvedValue({
      id: "UC_COLDPLAY",
      name: "Coldplay",
      artworkUrl: "",
      topSongs: [track],
      shelves: [],
    });
    vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue([track]);

    const host = document.createElement("div");
    document.body.appendChild(host);
    router.route("/", () => {});
    router.route("/search", renderSearch);
    router.route("/playlists", renderLibrary);
    router.route("/liked", renderLibrary);
    router.route("/artist", renderArtist);
    router.route("/playlist", renderCollection);
    router.start(host);

    // 1. Quick tile artist link (role=link inside .quick-tile__main, not nested button)
    const [shelfEl] = renderShelves(
      [{ title: "Quick picks", layout: "list", items: [{ kind: "song", track }], tracks: [track] }],
      "",
    );
    host.appendChild(shelfEl);
    expect(shelfEl.querySelector(".quick-tile__main button")).toBeNull();
    shelfEl.querySelector<HTMLElement>(".quick-tile__subtitle")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(playTrack).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("#/artist?");

    // 2. Song card artist link & Artist shelf card
    window.location.hash = "#/";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const songCard = createSongCard(track, [track]);
    host.appendChild(songCard);
    songCard.querySelector<HTMLElement>(".shelf-card__artist-link")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(playTrack).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("#/artist?");

    window.location.hash = "#/";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const artistCard = createCollectionCard({
      kind: "artist",
      title: "Coldplay",
      subtitle: "Artist",
      artworkUrl: "",
      artistId: "UC_COLDPLAY",
    });
    host.appendChild(artistCard);
    artistCard.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(playTrack).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("#/artist?");
    expect(window.location.hash).toContain("id=UC_COLDPLAY");

    // 3. Liked library track row artist & album clicks
    storage.toggleLike(track);
    window.location.hash = "#/liked";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    host.querySelector<HTMLButtonElement>(".track-row__album.track-row__link")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(playTrack).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("#/playlist?");
    expect(window.location.hash).toContain("id=MPREb_PARA");

    // 4. Queue panel row artist click
    const upcoming = sampleTrack({ id: "trk2", title: "Clocks", artist: "Coldplay", artistId: "UC_COLDPLAY" });
    playerEngine.setQueue([track, upcoming]);
    const queue = createQueuePanel();
    document.body.appendChild(queue);
    window.location.hash = "#/";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    queue.querySelector<HTMLButtonElement>(".queue-row__artist-btn")!.click();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(playTrack).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("#/artist?");
  });
});
