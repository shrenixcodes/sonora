# Audio Quality, Routing & Configuration Guide

## Audio Quality Tiers & Mastering Chain

Configured under **Settings → Playback & Sound** ([audio-quality.ts](../src/lib/audio-quality.ts), applied inside [ytm_bridge.js](../src-tauri/src/ytm_bridge.js)):

| Mode | Badge | Behavior |
| --- | --- | --- |
| `saver` | Data Saver | Prefers lighter audio streams (~64–128 kbps) to reduce bandwidth |
| `balanced` | Balanced | Standard YouTube Music adaptive streaming with original-track protection |
| `high` *(default)* | High Quality | Locks full-bitrate YouTube Music streams (up to 256 kbps Premium / 160 kbps Opus) and blocks low-bitrate drops |
| `lossless` | Lossless Studio | Locks peak available YouTube Music bitrates and engages a 64-bit Web Audio mastering chain (subsonic filter, harmonic air restoration, true-peak limiter) |

> **Important:** YouTube Music does not serve native lossless PCM/FLAC streams. **Lossless** selects the highest available upstream stream and runs Sonora's client-side mastering chain. If a stream stalls or is unavailable, Sonora automatically falls back to the best available quality tier and displays the effective tier in telemetry (`Best Available`).

### Audio Enhancement Profiles & Loudness

* **Profiles:** `Pure (Unaltered)` (`off`), `Studio Clarity` (`clarity`), `Warm & Smooth` (`warm`), `Deep Bass` (`bass`), `Vocal Focus` (`vocal`).
* **Normalize Volume:** Enabled by default (`normalizeVolume: true`) for track gain leveling and peak protection.
* **Live Telemetry:** Displays requested/fallback quality tier, codec, bitrate (`kbps`), sample rate (`kHz`), DSP sample rate, and applied normalization gain (`dB`).

---

## Per-App Windows Audio Output Routing

Click the speaker/headphones icon on the right side of the player bar to steer **only Sonora** (`sonora.exe` and its WebView2 audio/renderer subprocesses) to any active Windows endpoint without changing the system default device:

* Supports **8 hardware form factors** (`speaker`, `headphones`, `headset`, `earbuds`, `monitor`, `dac`, `handset`, `generic`) across **3 transport types** (`wired`, `wireless`, `bluetooth`).
* Process-tree routing uses Windows Core Audio (`AudioPolicyConfig`) with a `20s` process rescan interval ([audio_devices.rs](../src-tauri/src/audio_devices.rs)) and automatic refresh on hardware `devicechange` or window focus (`15s` cooldown in [audio-devices.ts](../src/lib/audio-devices.ts)).

---

## Theme Export & Import (`sonora-theme.json`)

**Settings → Appearance Studio → Theme Configuration** exports and imports appearance preferences as JSON (`sonora-theme.json`). It does **not** include playlists, liked tracks, audio settings, or your YouTube Music WebView2 session.

### Schema & Valid Values

| Key | Type | Valid Values | Default |
| --- | --- | --- | --- |
| `theme` | `string` | `"dark"` \| `"light"` | `"dark"` |
| `accentColor` | `string \| null` | `null` (theme default) or `#RGB`/`#RRGGBB`/`#RRGGBBAA` hex | `null` |
| `ambientMode` | `string` | `"aurora"` \| `"fluid"` \| `"glow"` \| `"cinematic"` \| `"minimal"` \| `"none"` | `"aurora"` |
| `ambientFpsLimit` | `number` | `15` \| `30` \| `60` | `30` |
| `ambientIntensity` | `number` | `0.1` to `1.0` *(clamped; configured via JSON)* | `0.8` |
| `density` | `string` | `"comfortable"` \| `"compact"` | `"comfortable"` |
| `lyricsFontSize` | `string` | `"sm"` \| `"md"` \| `"lg"` \| `"off"` | `"md"` |

Example (`sunset-tape.json`, also under [docs/design/presets/](design/presets/sunset-tape.json)):

```json
{
  "theme": "dark",
  "accentColor": "#C9A96E",
  "ambientMode": "glow",
  "ambientFpsLimit": 30,
  "ambientIntensity": 0.6,
  "density": "comfortable",
  "lyricsFontSize": "md"
}
```

---

## Local Storage & Privacy Notes

* **Frontend `localStorage` keys ([storage.ts](../src/lib/storage.ts)):**
  * `sonora:settings` — full `UserSettings` JSON (appearance, playback defaults, audio quality/DSP, Discord RPC toggle, selected audio device ID)
  * `sonora:liked_tracks` — locally cached liked tracks (also synced with YouTube Music when signed in)
  * `sonora:playlists` — local Sonora playlists (distinct from YouTube Music account playlists)
  * `sonora:history` — listening history (capped at 200 items)
  * `sonora:queue`, `sonora:last_track` — queue persistence
* **Isolated WebView2 profile & ad-filter cache:** Google sign-in cookies and cached ad-filter lists stay inside Sonora's local Windows application data directories. Never attach exported profiles or logs containing account details to public bug reports.
