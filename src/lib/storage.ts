/**
 * Persistent local storage for user preferences, playlists, history, and liked tracks.
 */

import type { Track, Playlist, UserSettings } from "@/types/music";
import { EventEmitter } from "@/lib/events";

export interface StorageEvents {
  likeChange: { trackId: string; isLiked: boolean; track: Track };
  settingsChange: UserSettings;
  playlistChange: void;
}

const STORAGE_KEYS = {
  SETTINGS: "sonora:settings",
  LIKED_TRACKS: "sonora:liked_tracks",
  HISTORY: "sonora:history",
  PLAYLISTS: "sonora:playlists",
  QUEUE: "sonora:queue",
  LAST_TRACK: "sonora:last_track",
} as const;

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "dark",
  accentColor: null,
  ambientMode: "aurora",
  ambientFpsLimit: 30,
  ambientIntensity: 0.8,
  density: "comfortable",
  lyricsFontSize: "md",
  volume: 0.8,
  normalizeVolume: true,
  autoPlayNext: true,
  enableDiscordRpc: true,
};

class StorageService extends EventEmitter<StorageEvents> {
  getSettings(): UserSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!data) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(data);
      // Migration: enable Discord RPC by default for all existing user configurations
      if (localStorage.getItem("sonora:discord_rpc_migrated") !== "true") {
        parsed.enableDiscordRpc = true;
        localStorage.setItem("sonora:discord_rpc_migrated", "true");
        try {
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...DEFAULT_SETTINGS, ...parsed, enableDiscordRpc: true }));
        } catch {}
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings: Partial<UserSettings>): UserSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    } catch (err) {
      console.error("[Storage] Failed to save settings:", err);
    }
    this.emit("settingsChange", updated);
    return updated;
  }

  getLikedTracks(): Track[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.LIKED_TRACKS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  isLiked(trackId: string): boolean {
    const liked = this.getLikedTracks();
    return liked.some((t) => t.id === trackId);
  }

  toggleLike(track: Track): boolean {
    const liked = this.getLikedTracks();
    const idx = liked.findIndex((t) => t.id === track.id);
    let isNowLiked = false;

    if (idx !== -1) {
      liked.splice(idx, 1);
      isNowLiked = false;
    } else {
      liked.unshift({ ...track, isLiked: true, addedAt: Date.now() });
      isNowLiked = true;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.LIKED_TRACKS, JSON.stringify(liked));
    } catch (err) {
      console.error("[Storage] Failed to save liked tracks:", err);
    }

    this.emit("likeChange", { trackId: track.id, isLiked: isNowLiked, track });
    return isNowLiked;
  }

  getHistory(): Track[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  addToHistory(track: Track): void {
    const history = this.getHistory();
    // Remove if already in history to move to top
    const filtered = history.filter((t) => t.id !== track.id);
    filtered.unshift({ ...track, addedAt: Date.now() });
    // Cap at 200 items
    const capped = filtered.slice(0, 200);

    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(capped));
    } catch (err) {
      console.error("[Storage] Failed to save history:", err);
    }
  }

  clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
    } catch (err) {
      console.error("[Storage] Failed to clear history:", err);
    }
  }

  getPlaylists(): Playlist[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  savePlaylist(playlist: Playlist): void {
    const playlists = this.getPlaylists();
    const idx = playlists.findIndex((p) => p.id === playlist.id);
    if (idx !== -1) {
      playlists[idx] = { ...playlist, updatedAt: Date.now() };
    } else {
      playlists.push({ ...playlist, updatedAt: Date.now() });
    }
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      this.emit("playlistChange", undefined);
    } catch (err) {
      console.error("[Storage] Failed to save playlists:", err);
    }
  }

  /** Adds a song to a local playlist without duplicating an existing track. */
  addTrackToPlaylist(playlistId: string, track: Track): "added" | "duplicate" | "missing" | "error" {
    const playlists = this.getPlaylists();
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return "missing";
    if (playlist.tracks.some((item) => item.id === track.id)) return "duplicate";
    playlist.tracks = [...playlist.tracks, track];
    playlist.trackCount = playlist.tracks.length;
    playlist.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      this.emit("playlistChange", undefined);
      return "added";
    } catch (err) {
      console.error("[Storage] Failed to save playlists:", err);
      return "error";
    }
  }

  deletePlaylist(playlistId: string): void {
    const playlists = this.getPlaylists().filter((p) => p.id !== playlistId);
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      this.emit("playlistChange", undefined);
    } catch (err) {
      console.error("[Storage] Failed to delete playlist:", err);
    }
  }
}

export const storage = new StorageService();
