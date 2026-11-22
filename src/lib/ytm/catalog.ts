/**
 * YouTube Music catalog: Home shelves and song search.
 *
 * Results come from YouTube Music itself (see client.ts), so they reflect the
 * signed-in user's account. Home is cached briefly so moving between views
 * doesn't refetch it; identical requests in flight share one call.
 */

import { CatalogError, requestCatalog, type CatalogRequest } from "@/lib/ytm/client";
import { parseHomeShelves, parseSearchSongs, type HomeShelf } from "@/lib/ytm/parse";
import type { Track } from "@/types/music";

export type { HomeShelf };
export { CatalogError };

const HOME_TTL_MS = 5 * 60_000;
/** The YouTube Music page takes a few seconds to load when Sonora starts. */
const STARTUP_RETRIES = 10;
const STARTUP_RETRY_MS = 1_000;

type Fetcher = (request: CatalogRequest) => Promise<unknown>;

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

  private fetch(request: CatalogRequest): Promise<unknown> {
    const key = JSON.stringify(request);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.fetchWithStartupRetry(request).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async fetchWithStartupRetry(request: CatalogRequest): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetcher(request);
      } catch (err) {
        const notReady = err instanceof CatalogError && err.reason === "not-ready";
        if (!notReady || attempt >= STARTUP_RETRIES) throw err;
        await this.sleep(STARTUP_RETRY_MS);
      }
    }
  }
}

export const catalog = new Catalog();
