/**
 * Lyrics providers for Sonora.
 *
 * Primary: LRCLIB (open-source synchronized lyrics repository)
 * Secondary: Fallback provider for local / embedded lyrics
 */

import type { LyricsData, Track } from "@/types/music";
import { parseLrc } from "./synced-lyrics";

const lyricsCache = new Map<string, LyricsData | null>();

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

      const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
        headers: {
          "User-Agent": "Sonora-Music-Player/0.1.0",
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.syncedLyrics) {
          const parsed = parseLrc(data.syncedLyrics, track.id);
          parsed.source = "LRCLIB (Synced)";
          lyricsCache.set(cacheKey, parsed);
          return parsed;
        } else if (data.plainLyrics) {
          const lines = data.plainLyrics
            .split("\n")
            .filter((l: string) => l.trim().length > 0)
            .map((text: string, idx: number) => ({ timeMs: idx * 3000, text }));
          const parsed: LyricsData = {
            trackId: track.id,
            isSynced: false,
            lines,
            plainLyrics: data.plainLyrics,
            source: "LRCLIB (Plain)",
          };
          lyricsCache.set(cacheKey, parsed);
          return parsed;
        }
      }

      // 2. Fallback: Search endpoint if exact lookup didn't match
      const searchRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(
          `${track.artist} ${track.title}`,
        )}`,
        {
          headers: {
            "User-Agent": "Sonora-Music-Player/0.1.0",
          },
        },
      );

      if (searchRes.ok) {
        const results = await searchRes.json();
        if (Array.isArray(results) && results.length > 0) {
          const best = results[0];
          if (best.syncedLyrics) {
            const parsed = parseLrc(best.syncedLyrics, track.id);
            parsed.source = "LRCLIB (Synced)";
            lyricsCache.set(cacheKey, parsed);
            return parsed;
          } else if (best.plainLyrics) {
            const lines = best.plainLyrics
              .split("\n")
              .filter((l: string) => l.trim().length > 0)
              .map((text: string, idx: number) => ({ timeMs: idx * 3000, text }));
            const parsed: LyricsData = {
              trackId: track.id,
              isSynced: false,
              lines,
              plainLyrics: best.plainLyrics,
              source: "LRCLIB (Plain)",
            };
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
