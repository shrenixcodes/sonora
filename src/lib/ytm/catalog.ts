/**
 * YouTube Music catalog: Home shelves and song search.
 *
 * Results come from YouTube Music itself (see client.ts), so they reflect the
 * signed-in user's account. Home is cached briefly so moving between views
 * doesn't refetch it; identical requests in flight share one call.
 */

import { CatalogError, requestCatalog, type CatalogRequest } from "@/lib/ytm/client";
import {
  parseContinuation,
  parseHomeShelves,
  parseLibraryPlaylists,
  parsePlaylistTracks,
  parseSearchSongs,
  type HomeShelf,
  type LibraryPlaylist,
} from "@/lib/ytm/parse";
import { dedupeById } from "@/lib/tracks";
import type { Track } from "@/types/music";

export type { HomeShelf, LibraryPlaylist };
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
/** Sending fails outright while the page is still being created at startup. */
const RETRYABLE = new Set(["not-ready", "timeout", "send-failed"]);

type Fetcher = (request: CatalogRequest, timeoutMs: number) => Promise<unknown>;

export class Catalog {
  private home: { shelves: HomeShelf[]; at: number } | null = null;
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly fetcher: Fetcher = requestCatalog,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async getHome(options: { refresh?: boolean } = {}): Promise<HomeShelf[]> {
    if (!options.refresh && this.home && this.now() - this.home.at < HOME_TTL_MS) {
      return this.home.shelves;
    }
    const shelves = parseHomeShelves(await this.fetch({ kind: "home" }));
    this.home = { shelves, at: this.now() };
    return shelves;
  }

  async searchSongs(query: string): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return parseSearchSongs(await this.fetch({ kind: "search", query: trimmed }));
  }

  /** Songs on the signed-in user's Liked Music playlist. */
  getLikedSongs(): Promise<Track[]> {
    return this.fetchTrackList({ kind: "likedSongs" });
  }

  /** Playlists saved in the signed-in user's library. */
  async getLibraryPlaylists(): Promise<LibraryPlaylist[]> {
    return parseLibraryPlaylists(await this.fetch({ kind: "libraryPlaylists" }));
  }

  getPlaylistTracks(id: string): Promise<Track[]> {
    return this.fetchTrackList({ kind: "playlist", id });
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
