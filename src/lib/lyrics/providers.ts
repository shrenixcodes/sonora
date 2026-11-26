/**
 * Lyrics providers for Sonora.
 *
 * Primary: LRCLIB (open-source synchronized lyrics repository)
 * Secondary: Fallback provider for local / embedded lyrics
 */

import type { LyricsData, Track } from "@/types/music";
import { BoundedCache } from "@/lib/cache";
import { parseLrc } from "./synced-lyrics";

const LRCLIB_TIMEOUT_MS = 8000;
const lyricsCache = new BoundedCache<string, LyricsData | null>(150);

function createTimeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(ms), cleanup: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

function parseLrclibEntry(entry: { syncedLyrics?: string; plainLyrics?: string }, trackId: string): LyricsData | null {
  if (entry.syncedLyrics) {
    const parsed = parseLrc(entry.syncedLyrics, trackId);
    parsed.source = "LRCLIB (Synced)";
    return parsed;
  }
  if (entry.plainLyrics) {
    const lines = entry.plainLyrics
      .split("\n")
      .filter((line: string) => line.trim().length > 0)
      .map((text: string, idx: number) => ({ timeMs: idx * 3000, text }));
    return {
      trackId,
      isSynced: false,
      lines,
      plainLyrics: entry.plainLyrics,
      source: "LRCLIB (Plain)",
    };
  }
  return null;
}

export class LyricsService {
  /**
   * Fetch synchronized or plain lyrics for a track.
   */
  async getLyrics(track: Track): Promise<LyricsData | null> {
    if (!track.title || !track.artist) return null;

    const cacheKey = `${track.id}:${track.artist}:${track.title}`;
    if (lyricsCache.has(cacheKey)) {
      return lyricsCache.get(cacheKey) || null;
    }

    try {
      // 1. Try exact match from LRCLIB
      const params = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artist,
      });

      if (track.album) {
        params.append("album_name", track.album);
      }
      if (track.duration > 0) {
        params.append("duration", String(Math.round(track.duration)));
      }

      const exactTimeout = createTimeoutSignal(LRCLIB_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
          signal: exactTimeout.signal,
        });
      } finally {
        exactTimeout.cleanup();
      }

      if (res.ok) {
        const data = await res.json();
        const parsed = parseLrclibEntry(data, track.id);
        if (parsed) {
          lyricsCache.set(cacheKey, parsed);
          return parsed;
        }
      }

      // 2. Fallback: Search endpoint if exact lookup didn't match
      const searchTimeout = createTimeoutSignal(LRCLIB_TIMEOUT_MS);
      let searchRes: Response;
      try {
        searchRes = await fetch(
          `https://lrclib.net/api/search?q=${encodeURIComponent(
            `${track.artist} ${track.title}`,
          )}`,
          { signal: searchTimeout.signal },
        );
      } finally {
        searchTimeout.cleanup();
      }

      if (searchRes.ok) {
        const results = await searchRes.json();
        if (Array.isArray(results) && results.length > 0) {
          const parsed = parseLrclibEntry(results[0], track.id);
          if (parsed) {
            lyricsCache.set(cacheKey, parsed);
            return parsed;
          }
        }
      }
    } catch (err) {
      console.warn("[LyricsService] Failed to load lyrics:", err);
    }

    lyricsCache.set(cacheKey, null);
    return null;
  }
}

export const lyricsService = new LyricsService();
