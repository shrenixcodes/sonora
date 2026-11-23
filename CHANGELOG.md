# Changelog

All notable changes to Sonora are documented in this file.

---

## [0.5.1] – 2026-11-24

### 🛠 Fixes & Sync Improvements

#### YouTube Music & Interface Synchronization
- **Fixed playback state desync**: Resolved an issue where Sonora's player bar would appear stuck at `0:00` with the play button showing paused/error while music was actively playing in the background.
- **Robust track load confirmation**: The player engine now confirms active playback via matching video ID, title metadata, or active progress reports, preventing false timeout failures from freezing the playback controls.
- **Dynamic `<video>` re-attachment**: The bridge script now continuously checks for video element recreation or SPA replacements so playback events and time updates never detach.
- **Fallback video ID detection**: Multiple fallback strategies (including `lastLoadedVideoId`, `getVideoUrl`, player bar DOM hrefs, and URL queries) ensure reports always correlate with the active track.

#### Discord Rich Presence
- **Dynamic duration synchronization**: Discord presence updates immediately when track duration is resolved, ensuring full progress bars display accurately in Discord profiles and server member lists.

### 📦 Build & Installer
- Version bumped to `0.5.1` across all manifests.
- Attached Windows NSIS installer executable (`Sonora_0.5.1_x64-setup.exe`) to GitHub release assets.

---

## [0.5.0] – 2026-11-24

### ✨ New Features

#### Discord Rich Presence
- **Full Discord integration** — Sonora now displays your currently playing track in Discord as a *Listening to Sonora* activity.
- Shows track name, artist, and album artwork directly on your Discord profile card.
- The activity card links to the latest Sonora GitHub release so your friends can download it.
- Presence text and artwork are automatically trimmed to Discord's character and URL limits so updates are never silently rejected.
- **Auto-reconnect** — Sonora detects when Discord starts or restarts and re-establishes the IPC connection and re-sends the current presence without requiring you to restart the app.
- Discord presence commands are routed through the correct window capability so presence updates always reach Discord.

#### Media Key & System Control Fixes
- **Hardware media keys and Windows system controls now skip tracks correctly** — Next / Previous on your keyboard, Windows lock screen overlay, or Bluetooth headset all advance Sonora's own queue instead of triggering a raw page-level seek.
- Applies to all skip sources: `MediaNextTrack`, `MediaPreviousTrack`, and the SMTC (System Media Transport Controls) buttons on Windows 10/11.

#### Drag-and-Drop Improvements
- **Queue reordering** — drag tracks up or down inside the queue panel to reorder them on the fly.
- Native file-drop interception is disabled so drag gestures inside Sonora no longer open file-picker overlays.

#### Queue Panel UI
- The queue panel is now a **curved floating pane** that sits cleanly above the player dock.
- A dedicated close button in the panel header lets you dismiss it without hunting for a toggle.

### 🛠 Fixes & Polish

- Responsive **multi-row grid layout** for music shelves in windowed mode; shelves scroll horizontally with the mouse wheel.
- Titlebar restore icon and playback control button states now correctly reflect the current window/playback state.
- Fullscreen and minimize icons swap correctly when entering and leaving the lyrics view.
- Repeat-one and restore icons added to the SVG icon registry so they render at all sizes.
- Lyrics typography scaling is configurable, and a 5-second auto-scroll lock indicator appears when you manually scroll the lyrics view.

### 🧪 Tests

- 28 Rust unit tests — all pass.
- 116 frontend unit tests (Vitest + JSDOM) — all pass.
- TypeScript strict-mode type check — clean.

### 📦 Build

- Version bumped from `0.4.2` → `0.5.0` in `tauri.conf.json`, `Cargo.toml`, and `package.json`.
- Target: Windows 10 / 11 x64 NSIS installer (`Sonora_0.5.0_x64-setup.exe`).

---

## [0.4.2] – 2026-11-xx

Initial public release. See [GitHub releases](https://github.com/shrenixcodes/sonora/releases/tag/v0.4.2) for details.

---

## [0.2.0] – Earlier

Initial prototype. Shipped core playback, WebGL ambient shaders, and the Appearance Studio.
