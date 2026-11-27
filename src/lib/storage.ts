/**
 * Persistent local storage for user preferences, playlists, history, and liked tracks.
 */

import type { Track, Playlist, RepeatMode, UserSettings } from "@/types/music";
import { EventEmitter } from "@/lib/events";
import { sanitizeAudioEnhancement, sanitizeAudioQuality } from "@/lib/audio-quality";

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

const MAX_SAVED_QUEUE_TRACKS = 500;

function isValidTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.artist === "string"
  );
}

export interface SavedQueueState {
  tracks: Track[];
  order?: number[];
  position?: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "dark",
  accentColor: null,
  ambientMode: "aurora",
  ambientFpsLimit: 30,
  ambientIntensity: 0.8,
  density: "comfortable",
  lyricsFontSize: "md",
  volume: 0.8,
  shuffle: false,
  repeat: "off",
  audioQuality: "high",
  audioEnhancement: "off",
  normalizeVolume: true,
  autoPlayNext: true,
  enableDiscordRpc: true,
  audioOutputDeviceId: null,
};

const VALID_REPEAT_MODES = new Set<RepeatMode>(["off", "all", "one"]);

function normalizeSettings(raw: Partial<UserSettings> | null | undefined, fallback: UserSettings = DEFAULT_SETTINGS): UserSettings {
  const merged = { ...fallback, ...(raw ?? {}) };
  merged.shuffle = Boolean(merged.shuffle);
  if (!VALID_REPEAT_MODES.has(merged.repeat)) {
    merged.repeat = fallback.repeat;
  }
  if (typeof merged.volume !== "number" || !Number.isFinite(merged.volume)) {
    merged.volume = fallback.volume;
  } else {
    merged.volume = Math.max(0, Math.min(1, merged.volume));
  }
  merged.audioQuality = sanitizeAudioQuality(merged.audioQuality, fallback.audioQuality);
  merged.audioEnhancement = sanitizeAudioEnhancement(merged.audioEnhancement, fallback.audioEnhancement);
  merged.normalizeVolume = Boolean(merged.normalizeVolume);
  merged.autoPlayNext = Boolean(merged.autoPlayNext);
  merged.enableDiscordRpc = Boolean(merged.enableDiscordRpc);
  return merged;
}

class StorageService extends EventEmitter<StorageEvents> {
  private likedCache: { raw: string | null; tracks: Track[]; ids: Set<string> } | null = null;
  private historyCache: { raw: string | null; tracks: Track[] } | null = null;

  private readLikedCache(): { raw: string | null; tracks: Track[]; ids: Set<string> } {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LIKED_TRACKS);
      if (this.likedCache && this.likedCache.raw === raw) {
        return this.likedCache;
      }
      const tracks: Track[] = raw ? JSON.parse(raw) : [];
      const ids = new Set(tracks.map((t) => t.id));
      this.likedCache = { raw, tracks, ids };
      return this.likedCache;
    } catch {
      return { raw: null, tracks: [], ids: new Set() };
    }
  }

  getSettings(): UserSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!data) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(data);
      return normalizeSettings(parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings: Partial<UserSettings>): UserSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    updated.audioQuality = sanitizeAudioQuality(updated.audioQuality, current.audioQuality);
    updated.audioEnhancement = sanitizeAudioEnhancement(updated.audioEnhancement, current.audioEnhancement);
    updated.normalizeVolume = Boolean(updated.normalizeVolume);
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    } catch (err) {
      console.error("[Storage] Failed to save settings:", err);
    }
    this.emit("settingsChange", updated);
    return updated;
  }

  getLikedTracks(): Track[] {
    return [...this.readLikedCache().tracks];
  }

  isLiked(trackId: string): boolean {
    return this.readLikedCache().ids.has(trackId);
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
      const serialized = JSON.stringify(liked);
      localStorage.setItem(STORAGE_KEYS.LIKED_TRACKS, serialized);
      this.likedCache = { raw: serialized, tracks: liked, ids: new Set(liked.map((t) => t.id)) };
    } catch (err) {
      console.error("[Storage] Failed to save liked tracks:", err);
      this.likedCache = null;
    }

    this.emit("likeChange", { trackId: track.id, isLiked: isNowLiked, track });
    return isNowLiked;
  }

  getHistory(): Track[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (this.historyCache && this.historyCache.raw === raw) {
        return [...this.historyCache.tracks];
      }
      const tracks: Track[] = raw ? JSON.parse(raw) : [];
      this.historyCache = { raw, tracks };
      return [...tracks];
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

  getSavedQueue(): SavedQueueState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.QUEUE);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const tracks = parsed.filter(isValidTrack);
        return tracks.length > 0 ? { tracks } : null;
      }
      if (!parsed || typeof parsed !== "object") return null;
      const candidate = parsed as Record<string, unknown>;
      if (!Array.isArray(candidate.tracks)) return null;
      const tracks = candidate.tracks.filter(isValidTrack);
      if (tracks.length === 0) return null;
      const order = Array.isArray(candidate.order) && candidate.order.every((n) => typeof n === "number")
        ? (candidate.order as number[])
        : undefined;
      const position = typeof candidate.position === "number" ? candidate.position : undefined;
      return { tracks, order, position };
    } catch {
      return null;
    }
  }

  saveQueue(state: SavedQueueState): void {
    try {
      if (state.tracks.length === 0) {
        localStorage.removeItem(STORAGE_KEYS.QUEUE);
        return;
      }
      const tracks = state.tracks.slice(0, MAX_SAVED_QUEUE_TRACKS);
      const payload: SavedQueueState =
        state.tracks.length <= MAX_SAVED_QUEUE_TRACKS
          ? { tracks, order: state.order, position: state.position }
          : { tracks };
      localStorage.setItem(STORAGE_KEYS.QUEUE, JSON.stringify(payload));
    } catch (err) {
      console.error("[Storage] Failed to save queue:", err);
    }
  }

  getLastTrack(): Track | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAST_TRACK);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return isValidTrack(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  saveLastTrack(track: Track | null): void {
    try {
      if (!track) {
        localStorage.removeItem(STORAGE_KEYS.LAST_TRACK);
        return;
      }
      localStorage.setItem(STORAGE_KEYS.LAST_TRACK, JSON.stringify(track));
    } catch (err) {
      console.error("[Storage] Failed to save last track:", err);
    }
  }

  renamePlaylist(playlistId: string, nextTitle: string): boolean {
    const title = nextTitle.trim();
    if (!title) return false;
    const playlists = this.getPlaylists();
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return false;
    if (playlist.title === title) return true;
    playlist.title = title;
    playlist.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      this.emit("playlistChange", undefined);
      return true;
    } catch (err) {
      console.error("[Storage] Failed to rename playlist:", err);
      return false;
    }
  }

  removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
    const playlists = this.getPlaylists();
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return false;
    const nextTracks = playlist.tracks.filter((item) => item.id !== trackId);
    if (nextTracks.length === playlist.tracks.length) return false;
    playlist.tracks = nextTracks;
    playlist.trackCount = nextTracks.length;
    playlist.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      this.emit("playlistChange", undefined);
      return true;
    } catch (err) {
      console.error("[Storage] Failed to remove track from playlist:", err);
      return false;
    }
  }
}

export const storage = new StorageService();
