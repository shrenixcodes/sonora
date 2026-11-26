# Contributing to Sonora

Thanks for helping maintain Sonora. For a substantial change, start a GitHub issue describing the problem and proposed behavior so the approach can be discussed before implementation. Bug reports are welcome through the [issue tracker](https://github.com/shrenixcodes/sonora/issues).

## Setup

Sonora targets Windows 10/11 x64. Install Node.js 20.19+ within the 20.x line or Node.js 22.12+, pnpm 12.21.0, stable Rust with the MSVC toolchain, Visual Studio C++ build tools, and the WebView2 runtime. Then:

```powershell
git clone https://github.com/shrenixcodes/sonora.git
cd sonora
pnpm install --frozen-lockfile
pnpm tauri:dev
```

`pnpm dev` starts the frontend alone. Its browser preview cannot run the desktop YouTube Music bridge or native Windows features. `TAURI_DEV_HOST` is an optional environment variable for a remote development host; set it in the shell before starting Vite. No `.env` file is needed for ordinary development.

## Changes and checks

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

Describe the problem, the final behavior, and the checks you ran in a pull request. If a check cannot run, explain why. For UI changes, include a genuine capture from the app with account details and personal listening data removed. See [the capture guide](docs/design/captures.md).

## Design

Read [DESIGN.md](DESIGN.md) before changing visual language, motion, controls, or visualizers. Use the existing tokens and icon system; test dark and light themes, keyboard interaction, reduced motion, and the floating window layout where relevant.

## Community and security

Follow the [code of conduct](CODE_OF_CONDUCT.md). For potential vulnerabilities, use [SECURITY.md](SECURITY.md) rather than publishing exploit details in an issue.
