/**
 * YouTube Music catalog: Home shelves and song search.
 *
 * Results come from YouTube Music itself (see client.ts), so they reflect the
 * signed-in user's account. Home is cached briefly so moving between views
 * doesn't refetch it; identical requests in flight share one call.
 */

import { CatalogError, requestCatalog, type CatalogRequest } from "@/lib/ytm/client";
import {
  parseAccountProfile,
  parseContinuation,
  parseHomeChips,
  parseHomeShelves,
  parseLibraryAlbums,
  parseLibraryArtists,
  parseLibraryPlaylists,
  parsePlaylistTracks,
  parseSearchSongs,
  parseWatchPlaylist,
  type AccountProfile,
  type HomeChip,
  type HomeCollection,
  type HomeItem,
  type HomePage,
  type HomeShelf,
  type LibraryArtist,
  type LibraryPlaylist,
} from "@/lib/ytm/parse";
import { dedupeById } from "@/lib/tracks";
import type { Track } from "@/types/music";

export type { AccountProfile, HomeChip, HomeCollection, HomeItem, HomePage, HomeShelf, LibraryArtist, LibraryPlaylist };
export { CatalogError };

const HOME_TTL_MS = 5 * 60_000;
/**
 * The YouTube Music page takes a few seconds to load when Sonora starts, and
 * reloads whenever a song is loaded. A request sent while it loads either gets
 * "not-ready" back or is lost with the old page, so both are retried.
 */
const MAX_ATTEMPTS = 8;
const ATTEMPT_TIMEOUT_MS = 6_000;
const NOT_READY_DELAY_MS = 1_000;
/** Long lists arrive in pages of about 100 songs; this caps a single load. */
const MAX_LIST_PAGES = 20;
/** Home arrives a few shelves at a time, like the site loading more as you scroll. */
const MAX_HOME_PAGES = 5;
const HOME_SNAPSHOT_KEY = "sonora:home_snapshot";
/** Sending fails outright while the page is still being created at startup. */
const RETRYABLE = new Set(["not-ready", "timeout", "send-failed"]);

type Fetcher = (request: CatalogRequest, timeoutMs: number) => Promise<unknown>;

export class Catalog {
  private home: { page: HomePage; at: number } | null = null;
  private explore: { shelves: HomeShelf[]; at: number } | null = null;
  private inFlight = new Map<string, Promise<unknown>>();
  /** How many pages each Home page has loaded, to cap how far it goes. */
  private homePages = new WeakMap<HomePage, number>();

  constructor(
    private readonly fetcher: Fetcher = requestCatalog,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly store: Pick<Storage, "getItem" | "setItem"> | null = globalThis.localStorage ?? null,
  ) {}

  /**
   * The first page of Home: shelves and chips. More shelves come from
   * getMoreHome, so the page can show before all of them arrive. `params` picks
   * a mood or genre chip; filtered pages aren't cached since each chip is its own page.
   */
  async getHome(options: { refresh?: boolean; params?: string } = {}): Promise<HomePage> {
    const filtered = !!options.params;
    if (!filtered && !options.refresh && this.home && this.now() - this.home.at < HOME_TTL_MS) {
      return this.home.page;
    }
    const response = await this.fetch(filtered ? { kind: "home", params: options.params } : { kind: "home" });
    const page: HomePage = { chips: parseHomeChips(response), shelves: parseHomeShelves(response) };
    const more = parseContinuation(response);
    if (more) page.more = more;
    this.homePages.set(page, 1);
    if (!filtered) {
      this.home = { page, at: this.now() };
      this.saveSnapshot(page);
    }
    return page;
  }

  /** Loads the next shelves of a Home page into it and returns them; empty when there are no more. */
  async getMoreHome(page: HomePage): Promise<HomeShelf[]> {
    const loaded = this.homePages.get(page) ?? 1;
    if (!page.more || loaded >= MAX_HOME_PAGES) return [];
    const response = await this.fetch({ kind: "continuation", token: page.more });
    const shelves = parseHomeShelves(response);
    const next = parseContinuation(response);
    if (next && shelves.length > 0) page.more = next;
    else delete page.more;
    this.homePages.set(page, loaded + 1);
    page.shelves.push(...shelves);
    if (this.home?.page === page) this.saveSnapshot(page);
    return shelves;
  }

  /**
   * Home as last seen, to show instantly while a fresh copy loads: the cached
   * page, or the copy saved by the previous session.
   */
  peekHome(): HomePage | null {
    if (this.home) return this.home.page;
    try {
      const saved = this.store?.getItem(HOME_SNAPSHOT_KEY);
      const page = saved ? (JSON.parse(saved) as HomePage) : null;
      return page && Array.isArray(page.shelves) && Array.isArray(page.chips) ? page : null;
    } catch {
      return null;
    }
  }

  private saveSnapshot(page: HomePage): void {
    try {
      this.store?.setItem(HOME_SNAPSHOT_KEY, JSON.stringify({ chips: page.chips, shelves: page.shelves }));
    } catch {
      // Storage full or unavailable: Home just loads without a head start.
    }
  }

  /** Forgets cached pages so the next request fetches fresh ones. */
  clearCache(): void {
    this.home = null;
    this.explore = null;
  }

  /** YouTube Music's Explore page: new releases, charts and trending. */
  async getExplore(): Promise<HomeShelf[]> {
    if (this.explore && this.now() - this.explore.at < HOME_TTL_MS) return this.explore.shelves;
    const shelves = parseHomeShelves(await this.fetch({ kind: "explore" }));
    this.explore = { shelves, at: this.now() };
    return shelves;
  }

  async searchSongs(query: string): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return parseSearchSongs(await this.fetch({ kind: "search", query: trimmed }));
  }

  /** Name and picture of the signed-in Google account. */
  async getAccountProfile(): Promise<AccountProfile | null> {
    return parseAccountProfile(await this.fetch({ kind: "accountInfo" }));
  }

  /** Songs on the signed-in user's Liked Music playlist. */
  getLikedSongs(): Promise<Track[]> {
    return this.fetchTrackList({ kind: "likedSongs" });
  }

  /** Playlists saved in the signed-in user's library. */
  async getLibraryPlaylists(): Promise<LibraryPlaylist[]> {
    return parseLibraryPlaylists(await this.fetch({ kind: "libraryPlaylists" }));
  }

  /** Albums saved in the signed-in user's library. */
  async getLibraryAlbums(): Promise<LibraryPlaylist[]> {
    return parseLibraryAlbums(await this.fetch({ kind: "libraryAlbums" }));
  }

  /** Artists in the signed-in user's library. */
  async getLibraryArtists(): Promise<LibraryArtist[]> {
    return parseLibraryArtists(await this.fetch({ kind: "libraryArtists" }));
  }

  /** Songs of a playlist, album or mix; mixes without a playlist page fall back to their watch queue. */
  async getPlaylistTracks(id: string): Promise<Track[]> {
    const tracks = await this.fetchTrackList({ kind: "playlist", id }).catch((err) => {
      if (!id.startsWith("RD")) throw err;
      return [];
    });
    if (tracks.length > 0 || !id.startsWith("RD")) return tracks;
    return parseWatchPlaylist(await this.fetch({ kind: "watchPlaylist", id }));
  }

  private async fetchTrackList(request: CatalogRequest): Promise<Track[]> {
    let response = await this.fetch(request);
    const tracks = parsePlaylistTracks(response);
    for (let page = 1; page < MAX_LIST_PAGES; page++) {
      const token = parseContinuation(response);
      if (!token) break;
      response = await this.fetch({ kind: "continuation", token });
      const more = parsePlaylistTracks(response);
      if (more.length === 0) break;
      tracks.push(...more);
    }
    return dedupeById(tracks);
  }

  private fetch(request: CatalogRequest): Promise<unknown> {
    const key = JSON.stringify(request);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.fetchWithStartupRetry(request).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async fetchWithStartupRetry(request: CatalogRequest): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.fetcher(request, ATTEMPT_TIMEOUT_MS);
      } catch (err) {
        const retryable = err instanceof CatalogError && RETRYABLE.has(err.reason);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
        if (err.reason !== "timeout") await this.sleep(NOT_READY_DELAY_MS);
      }
    }
  }
}

export const catalog = new Catalog();
