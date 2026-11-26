<div align="center">
  <img src="public/sonora-logo.svg" alt="Sonora logo" width="120" height="120" />
  <h1>Sonora</h1>
  <p>A Windows desktop client for YouTube Music with artwork-driven visuals.</p>

  [![CI](https://github.com/shrenixcodes/sonora/actions/workflows/ci.yml/badge.svg)](https://github.com/shrenixcodes/sonora/actions/workflows/ci.yml)
  [![Latest release](https://img.shields.io/github/v/release/shrenixcodes/sonora)](https://github.com/shrenixcodes/sonora/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
</div>

Sonora combines a TypeScript interface and WebGL ambience with a Tauri/Rust desktop shell. Playback and catalog requests use the YouTube Music web app in a separate WebView2 profile. Sonora is a community project and is not an official YouTube Music application.

**Platform:** Windows 10/11 x64. The frontend can run in a browser for interface development, but playback, account access, and native desktop features require the Windows application.

## Features

- Search songs, videos, artists, albums, and playlists; browse Home and Explore; and open artist and collection views.
- Play, seek, shuffle, repeat, reorder the queue, and start song radio from a track. Radio recommendations come from YouTube Music and can vary or be unavailable.
- Use song actions to queue tracks, add them to local Sonora playlists, copy links, and navigate to artists or albums. Local playlists are distinct from YouTube Music account playlists.
- View synced lyrics when a provider has them, adjust lyric size, and open the Now Playing view.
- Use Appearance Studio in Settings to customize light/dark theme, accent, density, ambient visualizer, frame rate, intensity, and theme JSON.
- Select audio quality and enhancement settings, use Windows media controls, choose a per-app audio output, and optionally show Discord Rich Presence.
- Check GitHub Releases for updates. Windows ad filtering uses Brave's filter engine and rule lists; it is not the full Brave browser and may not block every ad.

The **Lossless** setting requests the best available source and applies the app's processing chain. It cannot turn a compressed source into a lossless recording; actual stream availability and quality depend on YouTube Music.

## Visual direction

![Sonora theme and accent palette](docs/design/palette.svg)

The palette above is a design reference drawn from the app's tokens, not an application screenshot. Aurora, Fluid, Glow, Cinematic, and Minimal are available visualizer modes; None disables the effect. A current hero recording, mode screenshot grid, and matched light/dark captures have not yet been added. See [the capture guide](docs/design/captures.md) for the required real-app capture set.

## Install

Download the Windows x64 installer from [the latest release](https://github.com/shrenixcodes/sonora/releases/latest), run it, and launch Sonora. The latest release shown by GitHub may differ from the version in a development checkout.

### Build from source

Prerequisites:

- Windows 10/11 x64 and the Microsoft Edge WebView2 runtime.
- Node.js 20.19 or later in the 20.x line, or Node.js 22.12 or later, as required by the current Vite version.
- pnpm 12.21.0, the version pinned in `package.json`.
- Stable Rust with the Windows MSVC toolchain and Visual Studio C++ build tools. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
git clone https://github.com/shrenixcodes/sonora.git
cd sonora
pnpm install --frozen-lockfile
pnpm tauri:dev
```

Install pnpm first if needed, for example with `npm install --global pnpm@12.21.0`. No `.env` file or API key is required for the normal setup. `TAURI_DEV_HOST` is an optional shell environment variable for remote frontend development; it is not needed on the same machine.

## Quick start

1. Open Sonora and use Search or Home to find a song. Sign in through **Settings** to access your YouTube Music account data.
2. Select a song to play it. Use the player and Up next panel for playback, queue order, and volume. Right-click a song for more actions; the radio control starts recommendations based on that song.
3. Open **Now Playing** for artwork and available lyrics. In **Settings**, choose the theme, accent, visualizer, and audio options that suit your machine.
4. Create a local playlist in **Playlists**, then use a song's context menu to add it. These playlists are stored locally.

## Configuration

Settings are stored locally. Theme export creates `sonora-theme.json` with appearance settings: theme, accent, visualizer mode, FPS limit, intensity, density, and lyrics size. Import accepts those settings and applies valid values; it is not a backup of playlists, account data, audio settings, or the WebView profile. Keep account profiles and personal exports private.

The visualizer supports 15, 30, and 60 FPS limits and follows reduced-motion preferences. Audio quality and output depend on the available stream and Windows device. Sign-in and account features depend on YouTube Music and a working connection.

## Development and checks

```powershell
pnpm dev          # frontend only
pnpm tauri:dev    # desktop app with native bridge
pnpm lint
pnpm check        # TypeScript
pnpm test         # Vitest
pnpm build        # production frontend
pnpm tauri:build  # Windows executable and NSIS installer
```

For Rust checks, run `cargo fmt --check` and `cargo test --locked` in `src-tauri`. The Windows installer is written under `src-tauri/target/release/bundle/nsis/` with the default Cargo target directory. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification, and UI guidance.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl+K | Focus search |
| Space | Play or pause |
| Left / Right | Seek backward / forward five seconds |
| Up / Down | Raise / lower volume by 5% |
| M | Mute or unmute |
| L | Toggle like on the current track |
| F | Open or leave Now Playing |

Most playback shortcuts are ignored while typing in a text field. Sliders and menus also support keyboard navigation. F8 and F9 are manual splash and restore-animation preview shortcuts.

## Repository map

```text
src/components/          Shared player, navigation, queue, and dialogs
src/views/               Home, search, library, settings, artist, and collection views
src/lib/playback/        Playback engine, queue, and radio
src/lib/ytm/             YouTube Music catalog and response parsing
src/lib/visuals/         WebGL visualizers, artwork palette, and window animations
src/styles/              Design tokens and component styles
src-tauri/src/           Rust commands, WebView bridge, updates, and audio routing
src-tauri/filters/       Bundled ad-filter lists and their notices
public/                  Logo, font, and static assets
tests/                   Vitest tests
docs/design/             Design references and capture guidance
```

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md), [DESIGN.md](DESIGN.md), and the [code of conduct](CODE_OF_CONDUCT.md). Report bugs or request features through [GitHub Issues](https://github.com/shrenixcodes/sonora/issues); use [SECURITY.md](SECURITY.md) for private vulnerability reporting. Release history is in [CHANGELOG.md](CHANGELOG.md).

## License and acknowledgments

Sonora's source is distributed under the [MIT License](LICENSE). Bundled third-party materials retain their own licenses: see [ad-filter notices](src-tauri/filters/NOTICE.txt) and the [Inter font license](public/fonts/Inter-LICENSE.txt). Sonora uses YouTube Music, Tauri, WebView2, and other open-source dependencies; their names and marks belong to their respective owners.
