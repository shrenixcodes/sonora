import { describe, it, expect, vi } from "vitest";
import { Catalog } from "../src/lib/ytm/catalog";
import { CatalogError, type CatalogRequest } from "../src/lib/ytm/client";

const emptyHome = { contents: {} };

describe("Catalog", () => {
  it("serves Home from its short cache and refetches on request", async () => {
    let time = 0;
    const fetcher = vi.fn(async () => emptyHome);
    const catalog = new Catalog(fetcher, () => time);

    await catalog.getHome();
    time = 60_000;
    await catalog.getHome();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await catalog.getHome({ refresh: true });
    time = 10 * 60_000;
    await catalog.getHome();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("shares one call between identical requests in flight", async () => {
    let release!: (v: unknown) => void;
    const fetcher = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const catalog = new Catalog(fetcher);

    const a = catalog.searchSongs("lofi");
    const b = catalog.searchSongs("  lofi ");
    release({});
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("waits for the YouTube Music page to finish loading", async () => {
    const fetcher = vi
      .fn<(r: CatalogRequest, timeoutMs: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new CatalogError("starting", "not-ready"))
      .mockRejectedValueOnce(new CatalogError("starting", "not-ready"))
      .mockResolvedValue({});
    const sleep = vi.fn(async () => {});
    const catalog = new Catalog(fetcher, Date.now, sleep);

    await expect(catalog.searchSongs("jazz")).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries a request lost while the page reloads", async () => {
    const fetcher = vi
      .fn<(r: CatalogRequest, timeoutMs: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new CatalogError("slow", "timeout"))
      .mockResolvedValue({});
    const catalog = new Catalog(fetcher, Date.now, async () => {});

    await expect(catalog.getHome()).resolves.toEqual({ chips: [], shelves: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toBeLessThan(15_000);
  });

  it("gives up after a bounded number of attempts", async () => {
    const fetcher = vi.fn(async () => {
      throw new CatalogError("slow", "timeout");
    });
    const catalog = new Catalog(fetcher, Date.now, async () => {});

    await expect(catalog.getHome()).rejects.toMatchObject({ reason: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("passes other failures straight through", async () => {
    const fetcher = vi.fn(async () => {
      throw new CatalogError("refused", "http-403");
    });
    const catalog = new Catalog(fetcher, Date.now, async () => {});

    await expect(catalog.getHome()).rejects.toMatchObject({ reason: "http-403" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not search for blank text", async () => {
    const fetcher = vi.fn();
    await expect(new Catalog(fetcher).searchSongs("   ")).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("follows continuation pages for long liked-song lists", async () => {
    const row = (videoId: string) => ({
      musicResponsiveListItemRenderer: {
        flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: videoId }] } } }],
        playlistItemData: { videoId },
      },
    });
    const next = (token: string) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
    const pages: Record<string, unknown> = {
      likedSongs: { contents: [row("a"), row("b"), next("P2")] },
      P2: { contents: [row("b"), row("c")] },
    };
    const fetcher = vi.fn(async (r: CatalogRequest) => pages[r.kind === "continuation" ? r.token : r.kind]);
    const catalog = new Catalog(fetcher);

    const tracks = await catalog.getLikedSongs();
    expect(tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("loads more Home shelves and falls back to the watch queue for mixes", async () => {
    const shelf = (title: string) => ({
      musicCarouselShelfRenderer: {
        header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] } } },
        contents: [{ musicResponsiveListItemRenderer: { flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } }], playlistItemData: { videoId: title } } }],
      },
    });
    const fetcher = vi.fn(async (r: CatalogRequest): Promise<unknown> => {
      if (r.kind === "home") return { contents: [shelf("one")], continuations: [{ nextContinuationData: { continuation: "MORE" } }] };
      if (r.kind === "continuation") return { contents: [shelf("two")] };
      if (r.kind === "playlist") return { contents: [] };
      return { contents: [{ playlistPanelVideoRenderer: { videoId: "mixsong", title: { runs: [{ text: "Mix song" }] } } }] };
    });
    const catalog = new Catalog(fetcher, Date.now, undefined, null);

    const home = await catalog.getHome();
    expect(home.shelves.map((s) => s.title)).toEqual(["one"]);
    expect(home.more).toBe("MORE");
    const more = await catalog.getMoreHome(home);
    expect(more.map((s) => s.title)).toEqual(["two"]);
    expect(home.shelves.map((s) => s.title)).toEqual(["one", "two"]);
    expect(home.more).toBeUndefined();
    expect(await catalog.getMoreHome(home)).toEqual([]);

    const mix = await catalog.getPlaylistTracks("RDTMAK5uy_mix");
    expect(mix.map((t) => t.id)).toEqual(["mixsong"]);
    expect(fetcher).toHaveBeenLastCalledWith({ kind: "watchPlaylist", id: "RDTMAK5uy_mix" }, expect.any(Number));
  });

  it("remembers Home between sessions so it can show before the network answers", async () => {
    const saved = new Map<string, string>();
    const store = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    const fetcher = vi.fn(async () => ({
      contents: [
        {
          musicCarouselShelfRenderer: {
            header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: "Listen again" }] } } },
            contents: [{ musicResponsiveListItemRenderer: { flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "x" }] } } }], playlistItemData: { videoId: "x" } } }],
          },
        },
      ],
    }));

    expect(new Catalog(fetcher, Date.now, undefined, store).peekHome()).toBeNull();
    await new Catalog(fetcher, Date.now, undefined, store).getHome();

    const nextSession = new Catalog(fetcher, Date.now, undefined, store);
    expect(nextSession.peekHome()?.shelves.map((s) => s.title)).toEqual(["Listen again"]);
  });

  it("hands back a playlist's first page at once and streams the rest", async () => {
    const row = (videoId: string) => ({
      musicResponsiveListItemRenderer: {
        flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: videoId }] } } }],
        playlistItemData: { videoId },
      },
    });
    const next = { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "P2" } } } };
    let releasePage2!: () => void;
    const fetcher = vi.fn(async (r: CatalogRequest): Promise<unknown> => {
      if (r.kind === "playlist") return { contents: [row("a"), row("b"), next] };
      await new Promise<void>((resolve) => (releasePage2 = resolve));
      return { contents: [row("c")] };
    });
    const catalog = new Catalog(fetcher, Date.now, undefined, null);
    const more: string[] = [];

    const first = await catalog.getPlaylistTracks("PL1", (tracks) => more.push(...tracks.map((t) => t.id)));
    expect(first.map((t) => t.id)).toEqual(["a", "b"]);
    expect(more).toEqual([]);

    await vi.waitFor(() => expect(releasePage2).toBeTypeOf("function"));
    releasePage2();
    await vi.waitFor(() => expect(more).toEqual(["c"]));

    // Played again: served whole from the cache, without asking YouTube Music.
    const again = await catalog.getPlaylistTracks("PL1");
    expect(again.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fetches history from YouTube Music", async () => {
    const row = (videoId: string) => ({
      musicResponsiveListItemRenderer: {
        flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: videoId }] } } }],
        playlistItemData: { videoId },
      },
    });
    const fetcher = vi.fn(async (r: CatalogRequest) => {
      if (r.kind === "history") return { contents: [row("h1"), row("h2")] };
      return {};
    });
    const catalog = new Catalog(fetcher);
    const history = await catalog.getHistory();
    expect(history.map((t) => t.id)).toEqual(["h1", "h2"]);
  });

  it("syncs track rating to YouTube Music", async () => {
    const fetcher = vi.fn(async () => ({}));
    const catalog = new Catalog(fetcher);

    await catalog.rateTrack("song1", true);
    expect(fetcher).toHaveBeenCalledWith({ kind: "rate", videoId: "song1", rating: "LIKE" }, expect.any(Number));

    await catalog.rateTrack("song1", false);
    expect(fetcher).toHaveBeenCalledWith({ kind: "rate", videoId: "song1", rating: "INDIFFERENT" }, expect.any(Number));
  });

  it("passes search filters and parameters to the fetcher", async () => {
    const fetcher = vi.fn(async () => ({}));
    const catalog = new Catalog(fetcher);

    await catalog.search("Queen", "albums");
    expect(fetcher).toHaveBeenCalledWith(
      { kind: "search", query: "Queen", params: "EgWKAQIBAWoKEAkQBRAKEAMQBA%3D%3D" },
      expect.any(Number),
    );

    await catalog.search("Queen", "playlists");
    expect(fetcher).toHaveBeenCalledWith(
      { kind: "search", query: "Queen", params: "EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D" },
      expect.any(Number),
    );
  });
});
