/**
 * Core domain types for Sonora music player.
 */

export interface Track {
  id: string; // YouTube videoId or unique identifier
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration: number; // in seconds
  artworkUrl: string;
  thumbnailUrl?: string;
  isLiked?: boolean;
  streamUrl?: string;
  addedAt?: number;
}

export interface Artist {
  id: string;
  name: string;
  thumbnailUrl?: string;
  description?: string;
  subscribers?: string;
  albums?: Album[];
  topTracks?: Track[];
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  year?: string | number;
  artworkUrl: string;
  trackCount?: number;
  tracks?: Track[];
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  author?: string;
  artworkUrl?: string;
  trackCount: number;
  tracks: Track[];
  isCustom?: boolean; // User created
  updatedAt?: number;
}

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type RepeatMode = "off" | "all" | "one";

export type AudioQualityMode = "saver" | "balanced" | "high" | "lossless";

export type AudioEnhancementProfile = "off" | "clarity" | "warm" | "bass" | "vocal";

export interface AudioStreamInfo {
  codec?: string;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
  qualityTier?: string;
  loudnessDb?: number;
  dspActive: boolean;
  dspSampleRate?: number;
  normalizedGainDb?: number;
  effectiveQuality?: AudioQualityMode;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

export interface PlaybackState {
  currentTrack: Track | null;
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  volume: number; // 0 to 1
  isMuted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  playbackRate: number;
  /** True while YouTube Music plays an ad; seeking and skipping are unavailable. */
  isAd: boolean;
  /** Active audio stream and DSP status reported by the bridge. */
  audioInfo?: AudioStreamInfo | null;
  error?: string;
}

export interface LyricsLine {
  timeMs: number;
  text: string;
}

export interface LyricsData {
  trackId: string;
  isSynced: boolean;
  lines: LyricsLine[];
  plainLyrics?: string;
  source?: string;
}

export interface SearchResult {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  playlists: Playlist[];
}

export type AmbientVisualMode = "aurora" | "fluid" | "glow" | "cinematic" | "minimal" | "none";

export interface UserSettings {
  theme: "dark" | "light";
  /** null uses the current theme's own accent. */
  accentColor: string | null;
  ambientMode: AmbientVisualMode;
  ambientFpsLimit: 15 | 30 | 60;
  ambientIntensity: number; // 0.1 to 1.0
  density: "comfortable" | "compact";
  lyricsFontSize?: "sm" | "md" | "lg" | "off";
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  audioQuality: AudioQualityMode;
  audioEnhancement: AudioEnhancementProfile;
  normalizeVolume: boolean;
  autoPlayNext: boolean;
  enableDiscordRpc: boolean;
  audioOutputDeviceId?: string | null;
  /**
   * Maximize/restore animation. "auto" picks "light" when the machine has no
   * usable GPU (src/lib/render-tier.ts); "light" never scales large layers.
   */
  windowAnimation?: "auto" | "full" | "light" | "slow";
}
