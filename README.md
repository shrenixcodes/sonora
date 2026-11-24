<div align="center">
  <img src="public/sonora-logo.svg" alt="Sonora Logo" width="120" height="120" />
  <h1>Sonora</h1>
  <p><strong>An immersive, lightweight, and atmospheric YouTube Music desktop client for Windows</strong></p>
  <p>Built with Tauri 2, Rust, WebGL, and TypeScript</p>
</div>

---

## Overview

Sonora is designed to make desktop music listening visual, atmospheric, and responsive. Instead of a heavy web-wrapper, Sonora couples a lightweight native Rust core with a custom vanilla TypeScript interface and WebGL-powered ambient background shaders.

### Key Pillars

- **Immersion:** Artwork-driven visual atmospheres that react to current album art without degrading interface readability.
- **Performance:** Native window chrome, low idle resource consumption, throttled 30 FPS ambient visualizer, and sub-second startup.
- **Customization:** Comprehensive Appearance Studio supporting dark and light themes, custom accent colors, UI density options, and theme configuration export/import.

---

## Features

### Music Playback & Queue
- Integrated YouTube playback engine with official stream synchronization.
- Windows ad filtering powered by Brave's adblock engine and EasyList/Brave rules. Lists are checked for updates at startup, at most once a day; a bundled copy is used offline. Some ads can still play, and Brave browser cosmetic filters and its full scriptlet set are not included.
- Persistent player dock with scrubbable progress bar, volume slider, shuffle, and repeat modes.
- Full queue management with automatic playlist continuation.
- Right-click songs to queue them, copy links, or find their artist and album in search.
- System Media Transport Controls (SMTC) integration for Windows 10 and 11 hardware media keys and lockscreen overlay.

### Immersive Now Playing
- Prominent album artwork with adaptive dynamic color extraction.
- Independent WebGL shader engine with multiple visualizer styles:
  - **Aurora:** Organic flowing ribbon waves.
  - **Fluid:** Atmospheric metaball fields.
  - **Glow:** Gentle pulsing ambient bloom.
  - **Cinematic:** Vignette stage backlight.
  - **Minimal:** Soft accent gradient.
- Synchronized line-by-line lyrics powered by open lyrics providers with click-to-seek navigation.
- Dedicated fullscreen immersion mode.

### Exploration & Library
- **Home:** Quick picks, personalized daily recommendations, and recently played albums.
- **Explore:** Mood and genre soundscapes (Chill, Focus, Energy, Synthwave, Acoustic, Rock, Classical).
- **Search:** Real-time debounced search across songs, albums, and artists.
- **Library:** Saved favorites, custom playlists, and local listening history.

### Appearance Studio
- **Themes:** Charcoal Dark (`#17151C`) and Bone Light (`#F0EBDD`).
- **Accent Palettes:** Dusty Purple, Bottle Green, Electric Blue, Muted Gold, Coral Vermilion, Rose Pink, and Emerald.
- **Visualizer Controls:** Selectable shader algorithms, frame rate throttling (15 / 30 / 60 FPS), and intensity sliders.
- **Theme Portability:** Export and import personalized theme configurations as JSON.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | [Tauri 2](https://v2.tauri.app/) (Rust) |
| **Frontend Runtime** | Vanilla TypeScript (ES2022) |
| **Build Tooling** | [Vite 8](https://vitejs.dev/) |
| **Graphics & Shaders** | WebGL / GLSL (Fragment Shaders) |
| **Testing** | [Vitest](https://vitest.dev/) with JSDOM |
| **Package Manager** | [pnpm](https://pnpm.io/) |
| **Target Platform** | Windows 10 & 11 (x64) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/) (v10+ or v12+)
- [Rust](https://www.rust-lang.org/) (stable toolchain)
- Windows 10 or 11 with WebView2 runtime (pre-installed on modern Windows)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/shreyanbag/sonora.git
cd sonora
pnpm install
```

### Development

Run the frontend development server:

```bash
pnpm dev
```

Run the complete desktop application in development mode:

```bash
pnpm tauri:dev
```

### Running Tests

Execute the unit test suite:

```bash
pnpm test
```

Perform TypeScript type checks:

```bash
pnpm check
```

### Production Build

Build the production frontend bundle:

```bash
pnpm build
```

Compile the standalone native Windows executable and installer:

```bash
pnpm tauri:build
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Space</kbd> | Play / Pause playback |
| <kbd>←</kbd> | Seek backward 5 seconds |
| <kbd>→</kbd> | Seek forward 5 seconds |
| <kbd>↑</kbd> | Increase volume (+5%) |
| <kbd>↓</kbd> | Decrease volume (-5%) |
| <kbd>M</kbd> | Toggle Mute |
| <kbd>L</kbd> | Toggle Like for current track |
| <kbd>F</kbd> | Toggle Fullscreen / Now Playing |

---

## Architecture

```text
sonora/
├── index.html                   # Shell container and viewport markup
├── package.json                 # Node dependencies and scripts
├── tsconfig.json                # TypeScript configuration (strict mode)
├── vite.config.ts               # Vite configuration and path resolution
├── vitest.config.ts             # Vitest test runner configuration
├── public/                      # Static branding assets and webview icons
├── src-tauri/                   # Rust desktop backend
│   ├── Cargo.toml               # Rust package manifest
│   ├── tauri.conf.json          # Tauri application and security settings
│   ├── capabilities/            # Window and permission capabilities
│   ├── icons/                   # Multi-resolution Windows app icons
│   └── src/
│       ├── main.rs              # Desktop executable entry
│       ├── lib.rs               # App builder and plugin registration
│       └── commands.rs          # Native IPC command handlers
├── src/                         # TypeScript frontend
│   ├── components/              # Persistent UI components (titlebar, sidebar, player)
│   ├── icons/                   # Crisp inline SVG icon suite
│   ├── lib/
│   │   ├── dom.ts               # DOM manipulation helpers
│   │   ├── events.ts            # Type-safe event emitter
│   │   ├── router.ts            # Hash-based client router
│   │   ├── storage.ts           # Local storage persistence
│   │   ├── theme.ts             # Dark/Light theme manager
│   │   ├── lyrics/              # LRC parser and lyrics synchronization
│   │   ├── playback/            # Playback engine, queue, and YouTube integration
│   │   └── visuals/             # WebGL ambient shader engine & color extraction
│   ├── styles/                  # Design tokens, reset, component CSS
│   ├── types/                   # Core music and application types
│   ├── views/                   # Application views (Home, Explore, Search, Library, Settings, Now Playing)
│   └── main.ts                  # Application bootstrap and global shortcuts
└── tests/                       # Unit and integration test suite
```

---

## License

This project is licensed under the [MIT License](LICENSE).
