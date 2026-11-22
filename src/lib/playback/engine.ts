/**
 * Sonora Core Playback Engine.
 *
 * Coordinates playback, YouTube IFrame Player integration, queue management,
 * Windows System Media Transport Controls (SMTC via MediaSession), and audio state.
 */

import type { Track, PlaybackState, RepeatMode } from "@/types/music";
import { EventEmitter } from "@/lib/events";
import { storage } from "@/lib/storage";
import { extractPalette, type ArtworkPalette } from "@/lib/visuals/color-extractor";
import { lyricsService } from "@/lib/lyrics/providers";
import type { LyricsData } from "@/types/music";

export interface PlaybackEvents {
  stateChange: PlaybackState;
  trackChange: Track | null;
  timeUpdate: { currentTime: number; duration: number };
  queueChange: Track[];
  paletteChange: ArtworkPalette;
  lyricsChange: LyricsData | null;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

class PlaybackEngine extends EventEmitter<PlaybackEvents> {
  private state: PlaybackState = {
    currentTrack: null,
    status: "idle",
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    isMuted: false,
    shuffle: false,
    repeat: "off",
    playbackRate: 1.0,
  };

  private queue: Track[] = [];
  private history: Track[] = [];
  private shuffledIndices: number[] = [];
  private currentQueueIndex = -1;

  private ytPlayer: any = null;
  private isYtReady = false;
  private timeUpdateTimer: number | null = null;

  constructor() {
    super();
    const settings = storage.getSettings();
    this.state.volume = settings.volume;
    this.initYouTubeApi();
    this.setupMediaSession();
  }

  get currentState(): PlaybackState {
    return { ...this.state };
  }

  get currentTrack(): Track | null {
    return this.state.currentTrack;
  }

  get currentQueue(): Track[] {
    return [...this.queue];
  }

  private initYouTubeApi(): void {
    // Hidden container for the YouTube player
    let container = document.getElementById("sonora-yt-player");
    if (!container) {
      container = document.createElement("div");
      container.id = "sonora-yt-player";
      container.style.position = "absolute";
      container.style.width = "1px";
      container.style.height = "1px";
      container.style.top = "-9999px";
      container.style.left = "-9999px";
      container.style.opacity = "0";
      container.style.pointerEvents = "none";
      document.body.appendChild(container);
    }

    if (window.YT && window.YT.Player) {
      this.createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        this.createPlayer();
      };

      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }

  private createPlayer(): void {
    try {
      this.ytPlayer = new window.YT.Player("sonora-yt-player", {
        height: "200",
        width: "200",
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.isYtReady = true;
            this.ytPlayer.setVolume(Math.round(this.state.volume * 100));
          },
          onStateChange: (event: { data: number }) => {
            this.handleYtStateChange(event.data);
          },
          onError: (err: any) => {
            console.warn("[PlaybackEngine] YouTube Player Error:", err);
            this.state.status = "error";
            this.state.error = "Error streaming track from YouTube";
            this.emit("stateChange", this.currentState);
          },
        },
      });
    } catch (e) {
      console.warn("[PlaybackEngine] Failed to create YouTube Player:", e);
    }
  }

  private handleYtStateChange(ytState: number): void {
    // YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
    switch (ytState) {
      case 1: // playing
        this.state.status = "playing";
        this.startTimeTracker();
        this.updateMediaSessionState();
        break;
      case 2: // paused
        this.state.status = "paused";
        this.stopTimeTracker();
        this.updateMediaSessionState();
        break;
      case 3: // buffering
        this.state.status = "loading";
        break;
      case 0: // ended
        this.handleTrackEnded();
        break;
      default:
        break;
    }
    this.emit("stateChange", this.currentState);
  }

  private startTimeTracker(): void {
    this.stopTimeTracker();
    this.timeUpdateTimer = window.setInterval(() => {
      if (this.ytPlayer && typeof this.ytPlayer.getCurrentTime === "function") {
        const currentTime = this.ytPlayer.getCurrentTime() || 0;
        const duration = this.ytPlayer.getDuration() || this.state.duration || 0;

        this.state.currentTime = currentTime;
        this.state.duration = duration;

        this.emit("timeUpdate", { currentTime, duration });
        this.updateMediaSessionPosition();
      }
    }, 250);
  }

  private stopTimeTracker(): void {
    if (this.timeUpdateTimer !== null) {
      clearInterval(this.timeUpdateTimer);
      this.timeUpdateTimer = null;
    }
  }

  async playTrack(track: Track, newQueue?: Track[]): Promise<void> {
    if (newQueue) {
      this.setQueue(newQueue, track);
    }

    this.state.currentTrack = track;
    this.state.currentTime = 0;
    this.state.duration = track.duration || 0;
    this.state.status = "loading";

    this.emit("trackChange", track);
    this.emit("stateChange", this.currentState);

    storage.addToHistory(track);

    // Concurrently load artwork palette and lyrics
    this.fetchArtworkAndLyrics(track);

    // Play in YouTube player
    if (this.isYtReady && this.ytPlayer && typeof this.ytPlayer.loadVideoById === "function") {
      this.ytPlayer.loadVideoById(track.id);
      this.ytPlayer.playVideo();
    } else {
      // If player not yet ready, retry shortly
      const checkInterval = setInterval(() => {
        if (this.isYtReady && this.ytPlayer) {
          clearInterval(checkInterval);
          this.ytPlayer.loadVideoById(track.id);
          this.ytPlayer.playVideo();
        }
      }, 200);
      setTimeout(() => clearInterval(checkInterval), 4000);
    }

    this.updateMediaSessionMetadata(track);
  }

  private async fetchArtworkAndLyrics(track: Track): Promise<void> {
    // 1. Color extraction
    extractPalette(track.artworkUrl).then((palette) => {
      this.emit("paletteChange", palette);
    });

    // 2. Lyrics lookup
    lyricsService.getLyrics(track).then((lyrics) => {
      this.emit("lyricsChange", lyrics);
    });
  }

  setQueue(tracks: Track[], startTrack?: Track): void {
    this.queue = [...tracks];
    if (startTrack) {
      this.currentQueueIndex = this.queue.findIndex((t) => t.id === startTrack.id);
    } else {
      this.currentQueueIndex = 0;
    }

    if (this.state.shuffle) {
      this.generateShuffleOrder();
    }

    this.emit("queueChange", this.queue);
  }

  togglePlay(): void {
    if (!this.state.currentTrack) {
      if (this.queue.length > 0) {
        this.playTrack(this.queue[0]);
      }
      return;
    }

    if (this.state.status === "playing") {
      this.pause();
    } else {
      this.resume();
    }
  }

  resume(): void {
    if (this.ytPlayer && typeof this.ytPlayer.playVideo === "function") {
      this.ytPlayer.playVideo();
    }
  }

  pause(): void {
    if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === "function") {
      this.ytPlayer.pauseVideo();
    }
  }

  next(): void {
    if (this.queue.length === 0) return;

    if (this.state.currentTrack) {
      this.history.push(this.state.currentTrack);
    }

    let nextIndex = this.currentQueueIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.state.repeat === "all") {
        nextIndex = 0;
      } else {
        return; // End of queue
      }
    }

    this.currentQueueIndex = nextIndex;
    const nextTrack = this.queue[this.currentQueueIndex];
    if (nextTrack) {
      this.playTrack(nextTrack);
    }
  }

  previous(): void {
    // If more than 3 seconds in, restart track
    if (this.state.currentTime > 3) {
      this.seekTo(0);
      return;
    }

    if (this.history.length > 0) {
      const prevTrack = this.history.pop()!;
      this.currentQueueIndex = this.queue.findIndex((t) => t.id === prevTrack.id);
      this.playTrack(prevTrack);
      return;
    }

    let prevIndex = this.currentQueueIndex - 1;
    if (prevIndex < 0) {
      if (this.state.repeat === "all") {
        prevIndex = this.queue.length - 1;
      } else {
        prevIndex = 0;
      }
    }

    this.currentQueueIndex = prevIndex;
    const prevTrack = this.queue[this.currentQueueIndex];
    if (prevTrack) {
      this.playTrack(prevTrack);
    }
  }

  seekTo(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.state.duration || seconds));
    this.state.currentTime = clamped;

    if (this.ytPlayer && typeof this.ytPlayer.seekTo === "function") {
      this.ytPlayer.seekTo(clamped, true);
    }

    this.emit("timeUpdate", { currentTime: clamped, duration: this.state.duration });
  }

  setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    this.state.volume = clamped;
    this.state.isMuted = clamped === 0;

    if (this.ytPlayer && typeof this.ytPlayer.setVolume === "function") {
      this.ytPlayer.setVolume(Math.round(clamped * 100));
    }

    storage.saveSettings({ volume: clamped });
    this.emit("stateChange", this.currentState);
  }

  toggleMute(): void {
    if (this.state.isMuted) {
      this.setVolume(this.state.volume || 0.8);
    } else {
      if (this.ytPlayer && typeof this.ytPlayer.mute === "function") {
        this.ytPlayer.mute();
      }
      this.state.isMuted = true;
      this.emit("stateChange", this.currentState);
    }
  }

  toggleShuffle(): void {
    this.state.shuffle = !this.state.shuffle;
    if (this.state.shuffle) {
      this.generateShuffleOrder();
    }
    this.emit("stateChange", this.currentState);
  }

  cycleRepeat(): void {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const nextIdx = (modes.indexOf(this.state.repeat) + 1) % modes.length;
    this.state.repeat = modes[nextIdx];
    this.emit("stateChange", this.currentState);
  }

  private generateShuffleOrder(): void {
    this.shuffledIndices = Array.from({ length: this.queue.length }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = this.shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffledIndices[i], this.shuffledIndices[j]] = [
        this.shuffledIndices[j],
        this.shuffledIndices[i],
      ];
    }
  }

  private handleTrackEnded(): void {
    if (this.state.repeat === "one") {
      this.seekTo(0);
      this.resume();
    } else {
      this.next();
    }
  }

  /* ── Windows System Media Transport Controls (SMTC) ─────────────────── */

  private setupMediaSession(): void {
    if (!("mediaSession" in navigator)) return;

    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => this.resume());
    ms.setActionHandler("pause", () => this.pause());
    ms.setActionHandler("previoustrack", () => this.previous());
    ms.setActionHandler("nexttrack", () => this.next());
    ms.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        this.seekTo(details.seekTime);
      }
    });
    ms.setActionHandler("seekbackward", (details) => {
      this.seekTo(this.state.currentTime - (details.seekOffset || 10));
    });
    ms.setActionHandler("seekforward", (details) => {
      this.seekTo(this.state.currentTime + (details.seekOffset || 10));
    });
  }

  private updateMediaSessionMetadata(track: Track): void {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || "Sonora",
      artwork: [
        { src: track.artworkUrl, sizes: "512x512", type: "image/jpeg" },
      ],
    });
  }

  private updateMediaSessionState(): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState =
      this.state.status === "playing" ? "playing" : "paused";
  }

  private updateMediaSessionPosition(): void {
    if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
    try {
      if (this.state.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: this.state.duration,
          playbackRate: this.state.playbackRate,
          position: Math.min(this.state.currentTime, this.state.duration),
        });
      }
    } catch {
      // Ignore if state is changing rapidly
    }
  }
}

export const playerEngine = new PlaybackEngine();
