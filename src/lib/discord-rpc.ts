/**
 * Discord Rich Presence integration for Sonora.
 *
 * Communicates with the local Discord desktop client via the native
 * Tauri IPC commands `discord_set_activity` and `discord_clear_activity`.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Track, PlaybackState, UserSettings } from "@/types/music";
import { storage } from "@/lib/storage";
import { playerEngine } from "@/lib/playback/engine";

export interface DiscordActivityPayload {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds?: number;
  elapsedSeconds?: number;
  isPlaying: boolean;
  clientId?: string;
}

/**
 * The track length to show in Discord. The engine's `state.duration` is the
 * value the player bar shows and is guarded against YTM crossfade pollution,
 * so it wins; `track.duration` (catalog metadata) is only a fallback.
 * Pass `state` only when it is known to describe `track`: on "trackChange"
 * the engine has not yet reset `state.duration` from the previous song.
 */
export function presenceDuration(track: Track, state?: PlaybackState): number | undefined {
  if (state && state.duration > 0) return Math.round(state.duration);
  return track.duration > 0 ? Math.round(track.duration) : undefined;
}

/**
 * Elapsed seconds, kept a second short of the duration. Discord only draws the
 * progress bar when the end lies after the start of the elapsed time (the
 * backend drops the end once elapsed reaches the duration), so a presence sent
 * in the song's last second would otherwise lose its bar.
 */
export function presenceElapsed(currentTime: number, duration: number | undefined): number {
  const elapsed = Math.max(0, Math.round(currentTime));
  return duration !== undefined && duration > 1 ? Math.min(elapsed, duration - 1) : elapsed;
}

export class DiscordRpcService {
  private lastActivity: DiscordActivityPayload | null = null;
  private lastSendTimestamp: number = 0;
  private enabled: boolean = false;
  private unlisteners: Array<() => void> = [];

  constructor() {
    this.enabled = storage.getSettings().enableDiscordRpc;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  init(): void {
    if (!isTauri()) return;

    // Listen to storage settings changes
    const stopStorage = storage.on("settingsChange", (settings: UserSettings) => {
      const wasEnabled = this.enabled;
      this.enabled = Boolean(settings.enableDiscordRpc);
      if (wasEnabled && !this.enabled) {
        this.clearActivity();
      } else if (!wasEnabled && this.enabled) {
        this.syncWithEngine();
      }
    });
    this.unlisteners.push(stopStorage);

    // Listen to engine state & track changes
    const stopState = playerEngine.on("stateChange", (state: PlaybackState) => {
      if (!this.enabled) return;
      this.handleStateChange(state);
    });
    this.unlisteners.push(stopState);

    const stopTrack = playerEngine.on("trackChange", (track: Track | null) => {
      if (!this.enabled) return;
      this.handleTrackChange(track);
    });
    this.unlisteners.push(stopTrack);

    // Initial sync if already enabled
    if (this.enabled) {
      this.syncWithEngine();
    }
  }

  destroy(): void {
    for (const stop of this.unlisteners) {
      stop();
    }
    this.unlisteners = [];
    this.clearActivity();
  }

  syncWithEngine(): void {
    if (!this.enabled || !isTauri()) return;
    const track = playerEngine.currentTrack;
    if (!track) {
      this.clearActivity();
      return;
    }
    const state = playerEngine.currentState;
    const durationSeconds = presenceDuration(track, state);
    this.sendActivity({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      durationSeconds,
      elapsedSeconds: presenceElapsed(state.currentTime, durationSeconds),
      isPlaying: state.status === "playing",
    });
  }

  handleTrackChange(track: Track | null): void {
    if (!track) {
      this.clearActivity();
      return;
    }
    const state = playerEngine.currentState;
    // state.duration may still be the previous song's here; the stateChange
    // that follows every track change sends the engine's settled duration.
    const durationSeconds = presenceDuration(track);
    this.sendActivity({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      durationSeconds,
      elapsedSeconds: presenceElapsed(state.currentTime, durationSeconds),
      isPlaying: state.status === "playing",
    });
  }

  handleStateChange(state: PlaybackState): void {
    if (!state.currentTrack) {
      this.clearActivity();
      return;
    }

    const isPlaying = state.status === "playing";
    const trackChanged =
      !this.lastActivity ||
      this.lastActivity.title !== state.currentTrack.title ||
      this.lastActivity.artist !== state.currentTrack.artist;
    const playStateChanged = !this.lastActivity || this.lastActivity.isPlaying !== isPlaying;

    const currentDuration = presenceDuration(state.currentTrack, state);
    const durationChanged =
      !this.lastActivity ||
      (currentDuration !== undefined && this.lastActivity.durationSeconds !== currentDuration);

    // Check for user seeking: significant drift (>4s) from expected wall-clock progression
    const now = Date.now();
    const elapsedRealSec = (now - this.lastSendTimestamp) / 1000;
    const expectedElapsed = (this.lastActivity?.elapsedSeconds ?? 0) + (isPlaying ? elapsedRealSec : 0);
    // The engine holds the time at the duration while the page finishes the
    // stream (the video can run a little longer than its listed length). That
    // pause in the clock is not a seek, and re-sending there would only throw
    // the bar away.
    const heldAtEnd = currentDuration !== undefined && state.currentTime >= currentDuration - 1;
    const seekDetected = !heldAtEnd && Math.abs(expectedElapsed - state.currentTime) > 4;

    if (trackChanged || playStateChanged || seekDetected || durationChanged) {
      this.sendActivity({
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        album: state.currentTrack.album,
        artworkUrl: state.currentTrack.artworkUrl,
        durationSeconds: currentDuration,
        elapsedSeconds: presenceElapsed(state.currentTime, currentDuration),
        isPlaying,
      });
    }
  }

  sendActivity(payload: DiscordActivityPayload): void {
    if (!isTauri()) return;
    this.lastActivity = payload;
    this.lastSendTimestamp = Date.now();
    invoke("discord_set_activity", { payload }).catch((err) => {
      console.warn("[Discord RPC] Failed to set activity:", err);
    });
  }

  clearActivity(): void {
    if (!isTauri()) return;
    this.lastActivity = null;
    invoke("discord_clear_activity").catch((err) => {
      console.warn("[Discord RPC] Failed to clear activity:", err);
    });
  }
}

export const discordRpc = new DiscordRpcService();
