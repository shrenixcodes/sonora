/**
 * Audio quality presets, enhancement profiles, and telemetry formatting.
 */

import type { AudioEnhancementProfile, AudioQualityMode, AudioStreamInfo, UserSettings } from "@/types/music";
import type { YtmAudioConfig } from "@/lib/playback/ytm-bridge";

export interface AudioQualityOption {
  id: AudioQualityMode;
  label: string;
  badge: string;
  description: string;
}

export const AUDIO_QUALITY_OPTIONS: readonly AudioQualityOption[] = [
  {
    id: "saver",
    label: "Saver",
    badge: "Data Saver",
    description: "Prefers lighter audio streams (~64–128 kbps) to conserve bandwidth.",
  },
  {
    id: "balanced",
    label: "Balanced",
    badge: "Balanced",
    description: "Standard YouTube Music adaptive streaming with original-track protection.",
  },
  {
    id: "high",
    label: "High",
    badge: "High Quality",
    description: "Locks full-bitrate YouTube Music streams (up to 256 kbps Premium / 160 kbps Opus) and blocks low-bitrate drops.",
  },
  {
    id: "lossless",
    label: "Lossless",
    badge: "Lossless Studio",
    description: "Locks peak source bitrates and runs a 64-bit Web Audio mastering chain (subsonic filter, harmonic air restoration, and true-peak limiter). Native source caps at YouTube Music's highest stream.",
  },
] as const;

export interface AudioEnhancementOption {
  id: AudioEnhancementProfile;
  label: string;
  description: string;
}

export const AUDIO_ENHANCEMENT_OPTIONS: readonly AudioEnhancementOption[] = [
  {
    id: "off",
    label: "Pure (Unaltered)",
    description: "Neutral frequency response without tonal shaping.",
  },
  {
    id: "clarity",
    label: "Studio Clarity",
    description: "Cleans muddy low-mids (280 Hz) and restores vocal/top-end air on compressed tracks.",
  },
  {
    id: "warm",
    label: "Warm & Smooth",
    description: "Adds low-end warmth while softening harsh upper-mid sibilance.",
  },
  {
    id: "bass",
    label: "Deep Bass",
    description: "Tight sub-bass weight without muddying vocals.",
  },
  {
    id: "vocal",
    label: "Vocal Focus",
    description: "Brings lead vocals forward on live recordings and music videos.",
  },
] as const;

const VALID_QUALITIES = new Set<AudioQualityMode>(["saver", "balanced", "high", "lossless"]);
const VALID_PROFILES = new Set<AudioEnhancementProfile>(["off", "clarity", "warm", "bass", "vocal"]);

export function sanitizeAudioQuality(value: unknown, fallback: AudioQualityMode = "high"): AudioQualityMode {
  return typeof value === "string" && VALID_QUALITIES.has(value as AudioQualityMode)
    ? (value as AudioQualityMode)
    : fallback;
}

export function sanitizeAudioEnhancement(
  value: unknown,
  fallback: AudioEnhancementProfile = "off",
): AudioEnhancementProfile {
  return typeof value === "string" && VALID_PROFILES.has(value as AudioEnhancementProfile)
    ? (value as AudioEnhancementProfile)
    : fallback;
}

export function audioConfigFromSettings(
  settings: Pick<UserSettings, "audioQuality" | "audioEnhancement" | "normalizeVolume">,
): YtmAudioConfig {
  return {
    quality: sanitizeAudioQuality(settings.audioQuality),
    profile: sanitizeAudioEnhancement(settings.audioEnhancement),
    normalizeVolume: Boolean(settings.normalizeVolume),
  };
}

export function audioQualityOption(mode: AudioQualityMode): AudioQualityOption {
  return AUDIO_QUALITY_OPTIONS.find((item) => item.id === mode) ?? AUDIO_QUALITY_OPTIONS[2];
}

export function audioEnhancementOption(profile: AudioEnhancementProfile): AudioEnhancementOption {
  return AUDIO_ENHANCEMENT_OPTIONS.find((item) => item.id === profile) ?? AUDIO_ENHANCEMENT_OPTIONS[0];
}

export function formatAudioTelemetry(
  settings: Pick<UserSettings, "audioQuality" | "audioEnhancement" | "normalizeVolume">,
  info?: AudioStreamInfo | null,
): string {
  const requested = sanitizeAudioQuality(settings.audioQuality);
  const mode = audioQualityOption(requested);
  const parts: string[] = [];

  if (info?.fallbackUsed && info.effectiveQuality) {
    const activeMode = audioQualityOption(info.effectiveQuality);
    parts.push(`${mode.badge} → Best Available (${activeMode.badge})`);
  } else {
    parts.push(mode.badge);
  }

  if (info?.codec) parts.push(info.codec);
  if (info?.bitrateKbps) parts.push(`${info.bitrateKbps} kbps`);
  if (info?.sampleRate) parts.push(`${(info.sampleRate / 1000).toFixed(1)} kHz`);

  if (info?.dspActive) {
    const rate = info.dspSampleRate ? ` (${(info.dspSampleRate / 1000).toFixed(1)} kHz)` : "";
    parts.push(`DSP Active${rate}`);
  } else if (requested === "lossless" || settings.audioEnhancement !== "off" || settings.normalizeVolume) {
    parts.push("DSP Ready");
  }

  if (typeof info?.normalizedGainDb === "number" && Number.isFinite(info.normalizedGainDb)) {
    const sign = info.normalizedGainDb >= 0 ? "+" : "";
    parts.push(`Gain ${sign}${info.normalizedGainDb.toFixed(1)} dB`);
  }

  return parts.join(" · ");
}

export function formatCompactQualityBadge(
  settings: Pick<UserSettings, "audioQuality" | "audioEnhancement">,
  info?: AudioStreamInfo | null,
): string | null {
  if (settings.audioQuality === "lossless") {
    if (info?.fallbackUsed) {
      return info.bitrateKbps ? `Best · ${info.bitrateKbps} kbps` : "Best Available";
    }
    return info?.bitrateKbps ? `Lossless · ${info.bitrateKbps} kbps` : "Lossless Studio";
  }
  if (settings.audioQuality === "high") {
    if (info?.fallbackUsed) {
      return info.bitrateKbps ? `Best · ${info.bitrateKbps} kbps` : "Best Available";
    }
    if (info?.bitrateKbps) return `High · ${info.bitrateKbps} kbps`;
    if (settings.audioEnhancement !== "off") return audioEnhancementOption(settings.audioEnhancement).label;
    return null;
  }
  if (settings.audioEnhancement !== "off") {
    return audioEnhancementOption(settings.audioEnhancement).label;
  }
  return null;
}
