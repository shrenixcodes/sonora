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
    this.sendActivity({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      durationSeconds: track.duration || (state.duration > 0 ? Math.round(state.duration) : undefined),
      elapsedSeconds: Math.round(state.currentTime),
      isPlaying: state.status === "playing",
    });
  }

  handleTrackChange(track: Track | null): void {
    if (!track) {
      this.clearActivity();
      return;
    }
    const state = playerEngine.currentState;
    this.sendActivity({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      durationSeconds: track.duration || (state.duration > 0 ? Math.round(state.duration) : undefined),
      elapsedSeconds: Math.round(state.currentTime),
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

    const currentDuration =
      state.currentTrack.duration || (state.duration > 0 ? Math.round(state.duration) : undefined);
    const durationChanged =
      !this.lastActivity ||
      (currentDuration !== undefined && this.lastActivity.durationSeconds !== currentDuration);

    // Check for user seeking: significant drift (>4s) from expected wall-clock progression
    const now = Date.now();
    const elapsedRealSec = (now - this.lastSendTimestamp) / 1000;
    const expectedElapsed = (this.lastActivity?.elapsedSeconds ?? 0) + (isPlaying ? elapsedRealSec : 0);
    const seekDetected = Math.abs(expectedElapsed - state.currentTime) > 4;

    if (trackChanged || playStateChanged || seekDetected || durationChanged) {
      this.sendActivity({
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        album: state.currentTrack.album,
        artworkUrl: state.currentTrack.artworkUrl,
        durationSeconds: currentDuration,
        elapsedSeconds: Math.round(state.currentTime),
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
