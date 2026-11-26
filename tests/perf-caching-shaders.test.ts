import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundedCache } from "../src/lib/cache";
import { lyricsService } from "../src/lib/lyrics/providers";
import { getCachedCollection, openCollection } from "../src/lib/navigation";
import { storage } from "../src/lib/storage";
import { MINIMAL_FRAGMENT_SRC, AmbientVisualRenderer } from "../src/lib/visuals/ambient-renderer";
import { account } from "../src/lib/ytm/account";
import { catalog } from "../src/lib/ytm/catalog";
import * as ytmClient from "../src/lib/ytm/client";
import { renderExplore } from "../src/views/explore";
import type { Track } from "../src/types/music";

const track = (id: string): Track => ({
  id,
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  album: "Album",
  duration: 180,
  artworkUrl: `https://example.com/${id}.jpg`,
});

describe("Caching, Explore throttling, Lyrics fetch hygiene, and Minimal shader", () => {
  beforeEach(() => {
    localStorage.clear();
    account.update(false);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("evicts least recently used keys from BoundedCache and bounds navigation cache", () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);

    for (let i = 0; i < 120; i++) {
      openCollection({
        source: "ytm",
        id: `col-${i}`,
        kind: "playlist",
        title: `Playlist ${i}`,
        subtitle: "",
        artworkUrl: "",
      });
    }
    expect(getCachedCollection("col-0")).toBeUndefined();
    expect(getCachedCollection("col-119")?.title).toBe("Playlist 119");
  });

  it("avoids repeated JSON.parse calls in storage.isLiked while staying coherent across clear/writes", () => {
    localStorage.setItem("sonora:liked_tracks", JSON.stringify([track("trk1"), track("trk2")]));

    const parseSpy = vi.spyOn(JSON, "parse");
    for (let i = 0; i < 50; i++) {
      expect(storage.isLiked("trk1")).toBe(true);
      expect(storage.isLiked("missing")).toBe(false);
    }
    expect(parseSpy).toHaveBeenCalledTimes(1);

    storage.toggleLike(track("trk1"));
    expect(storage.isLiked("trk1")).toBe(false);
    expect(parseSpy).toHaveBeenCalledTimes(1);

    localStorage.clear();
    expect(storage.isLiked("trk2")).toBe(false);
  });

  it("omits forbidden User-Agent header and attaches an AbortSignal timeout on LRCLIB requests", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ syncedLyrics: "[00:01.00] Hello world" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const lyrics = await lyricsService.getLyrics(track("lrclib-1"));
    expect(lyrics?.isSynced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headerKeys = Object.keys((init.headers as Record<string, string>) ?? {}).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain("user-agent");
  });

  it("caps concurrent Explore mood artwork searches instead of firing 8 simultaneously", async () => {
    vi.spyOn(ytmClient, "catalogAvailable").mockReturnValue(true);
    account.update(true);
    vi.spyOn(catalog, "getExplore").mockResolvedValue({ title: "Explore", shelves: [] });

    let inFlight = 0;
    let peak = 0;
    vi.spyOn(catalog, "searchSongs").mockImplementation(async (query) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return [track(query)];
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    renderExplore(host);

    await vi.waitFor(() => {
      expect(catalog.searchSongs).toHaveBeenCalledTimes(8);
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("maps minimal mode to a dedicated lightweight gradient shader", () => {
    expect(MINIMAL_FRAGMENT_SRC).not.toContain("sin(");

    const canvas = document.createElement("canvas");
    const renderer = new AmbientVisualRenderer(canvas);
    const setShader = vi.fn();
    (renderer as unknown as { gl: Record<string, unknown>; setShaderSource: (src: string) => void }).gl = {
      COLOR_BUFFER_BIT: 0x4000,
      clearColor: vi.fn(),
      clear: vi.fn(),
    };
    (renderer as unknown as { setShaderSource: (src: string) => void }).setShaderSource = setShader;
    vi.spyOn(renderer, "resume").mockImplementation(() => {});

    renderer.setMode("minimal");
    expect(setShader).toHaveBeenCalledWith(MINIMAL_FRAGMENT_SRC);
  });
});
