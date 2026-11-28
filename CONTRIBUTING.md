# Contributing to Sonora

Thanks for helping maintain Sonora. For a substantial change, start a [GitHub issue](https://github.com/shrenixcodes/sonora/issues) describing the problem and proposed behavior so the approach can be discussed before implementation.

## Setup

Sonora targets Windows 10/11 x64. Install Node.js `20.19.0+` (20.x) or `22.12.0+`, `pnpm` `12.21.0`, stable Rust with the Windows MSVC toolchain, Visual Studio C++ Build Tools, and the WebView2 runtime. Then:

```powershell
git clone https://github.com/shrenixcodes/sonora.git
cd sonora
pnpm install --frozen-lockfile
pnpm tauri:dev
```

`pnpm dev` starts the frontend alone (`http://localhost:1430`, with `?window=floating` to preview floating mode). Its browser preview cannot run the desktop YouTube Music bridge or native Windows features. No `.env` file is needed for ordinary development; optional `TAURI_DEV_HOST` and `RUST_LOG` variables are documented in [.env.example](.env.example).

Before making architectural or audio changes, review [the architecture overview](docs/architecture.md) and [the audio & configuration guide](docs/audio-and-configuration.md).

## Changes and Checks

Keep changes focused and preserve existing behavior. Include tests for meaningful new behavior or regressions. Never commit credentials, WebView profiles, personal account data, generated installers, or dependency directories.

```powershell
pnpm lint
pnpm check
pnpm test
pnpm build
cd src-tauri
cargo fmt --check
cargo test --locked
cd ..
pnpm tauri:build
```

To change the app version, run `pnpm version:bump <major.minor.patch>`; it updates `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, and the frontend fallback together.

Describe the problem, the final behavior, and the checks you ran in your pull request. If a check cannot run in your environment, explain why. For UI changes, include a genuine capture from the Windows app with account details and personal listening data removed (see [the capture guide](docs/design/captures.md)).

## Design

Read [DESIGN.md](DESIGN.md) and [the design references](docs/design/README.md) before changing visual language, motion, controls, icons, or visualizers. Use the existing semantic tokens in [tokens.css](src/styles/tokens.css) and icon registry in [src/icons/index.ts](src/icons/index.ts); verify dark and light themes, keyboard navigation, reduced motion, reduced transparency, and the floating window layout where relevant.

## Community and Security

Follow the [code of conduct](CODE_OF_CONDUCT.md). For potential security issues, follow [SECURITY.md](SECURITY.md) rather than publishing exploit details in a public issue.
