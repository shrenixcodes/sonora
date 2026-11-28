# Sonora Design Guide

Sonora should feel calm, tactile, and focused on the music. Its **muted editorial** visual direction pairs strong typography, restrained translucent surfaces, and artwork-derived light so the interface stays atmospheric without competing with controls. Motion explains state changes (floating/full morphs, taskbar restores, elastic overscroll) and settles quickly. Every surface must remain legible across both maximized and floating window layouts, as well as in dark and light themes.

---

## Color

Sonora ships two theme foundations — **Charcoal** (Dark, default) and **Bone** (Light) — defined as CSS custom properties in [src/styles/tokens.css](src/styles/tokens.css).

### Neutral & Semantic Tokens

| Role | Token | Dark (`Charcoal`) | Light (`Bone`) | Usage |
| --- | --- | --- | --- | --- |
| Base canvas | `--color-bg` | `#17151C` | `#F0EBDD` | Window background, base contrast target |
| Primary surface | `--color-surface` | `#211E29` | `#F8F5EC` | Settings rows, menus, dialogs |
| Elevated surface | `--color-surface-secondary` | `#292532` | `#E7E2D4` | Artwork fallbacks, hover rows, inputs |
| Primary text | `--color-text` | `#F4F0F6` | `#202820` | Titles, body copy, active icons |
| Secondary text | `--color-text-secondary` | `#A9A3B3` | `#6C7169` | Subtitles, artist names, metadata |
| Tertiary text | `--color-text-tertiary` | `#736D7E` | `#8E9389` | Section straplines, subtle hints, drag grip |
| Primary border | `--color-border` | `#393342` | `#D8D1C3` | Inputs, buttons, segmented containers |
| Subtle divider | `--color-border-subtle` | `#2E2938` | `#E0DBD0` | Row separators, card edges |
| Glass panel fill | `--color-panel` | `rgba(22, 19, 29, 0.62)` | `rgba(248, 245, 236, 0.76)` | Sidebar, main, queue, player over ambience |
| Glass panel border | `--color-panel-border` | `rgba(255, 255, 255, 0.13)` | `rgba(255, 255, 255, 0.45)` | Translucent rim highlight |
| Danger | `--color-danger` | `#EF4444` | `#DC2626` | Destructive actions, errors |
| Success | `--color-success` | `#22C55E` | `#16A34A` | Positive confirmations |
| Warning | `--color-warning` | `#F59E0B` | `#D97706` | Caution notices |

### Accents & Dynamic Artwork Adaptation

When no explicit accent is chosen (`accentColor: null`), Dark defaults to **Dusty Purple** (`#A78BFA`, secondary `#C9A96E`) and Light defaults to **Bottle Green** (`#315E48`, secondary `#D95342`). Settings provides **eight** selectable accents in [src/views/settings.ts](src/views/settings.ts):

| Accent | Hex | Suggested Character |
| --- | --- | --- |
| Dusty Purple | `#A78BFA` | Calm, default dark accent |
| Bottle Green | `#315E48` | Grounded, default light accent |
| Electric Blue | `#3B82F6` | Crisp, energetic focus |
| Muted Gold | `#C9A96E` | Warm highlights |
| Coral | `#D95342` | Warm contrast, default light secondary |
| Rose Pink | `#F472B6` | Soft emphasis |
| Emerald | `#10B981` | Bright green emphasis |
| Teal | `#14B8A6` | Cool, balanced emphasis |

**Usage rules:**
1. **Contrast clamping:** `readableAccent()` in [src/lib/accent.ts](src/lib/accent.ts) nudges any user-selected or artwork-extracted accent toward `#FFFFFF` (Dark) or `#000000` (Light) until it satisfies WCAG AA **4.5:1** text contrast against the theme's `--color-bg`.
2. **Artwork-driven accent override:** While a track is playing, `applyArtworkAccent()` in [src/lib/ambience.ts](src/lib/ambience.ts) overrides `--color-accent`, `--color-accent-hover`, `--color-hover`, and `--color-active` on `#app` using the track's `palette.vibrant` color (falling back to the Settings choice when cleared), and updates `--ambience-1/2/3` behind the glass panels.
3. **Now Playing theater stage:** `.now-playing` in [src/styles/now-playing.css](src/styles/now-playing.css) always locks its local surface tokens to `#17151C` / `#F4F0F6` so the WebGL visualizer stays dark and cinematic even in Light mode.
4. **Never set text directly on raw artwork** without a scrim (`.now-playing__scrim`, `.mood-card` gradient, or `.color-panel` glass fill).

See [docs/design/palette.svg](docs/design/palette.svg), [docs/design/palette.json](docs/design/palette.json), [docs/design/moodboard.svg](docs/design/moodboard.svg), and [docs/design/README.md](docs/design/README.md).

---

## Typography

Sonora bundles **Inter Variable** (`Inter 4.1`, SIL OFL, [public/fonts/InterVariable.woff2](public/fonts/InterVariable.woff2)) for both display headings and body text, leveraging Inter's optical-size axis (`font-optical-sizing: auto`) so large headings tighten automatically while body sizes remain open. Do not introduce a separate display font; use weight, optical sizing, and letter spacing for hierarchy.

* **UI Sans Stack (`--font-family`):** `"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
* **Technical Mono Stack (`--font-mono`):** `"Cascadia Mono", "Cascadia Code", Consolas, monospace` — reserved for shortcut `<kbd>` badges and telemetry/technical readouts.
* **Tabular Figures:** Apply `font-variant-numeric: tabular-nums` to timestamps, playback counters, track indices, and changing durations ([main.css](src/styles/main.css), [player.css](src/styles/player.css), [queue.css](src/styles/queue.css)).

### Type Scale & Weights

| Token | Size | Typical Role |
| --- | --- | --- |
| `--text-xs` | `11px` (`0.6875rem`) | Section straplines, badges, segmented labels, timestamps |
| `--text-sm` | `12px` (`0.75rem`) | Subtitles, secondary descriptions, artist subtitles |
| `--text-base` | `13px` (`0.8125rem`) | Default document & list body text |
| `--text-md` | `14px` (`0.875rem`) | Setting labels, menu items, prominent track titles |
| `--text-lg` | `16px` (`1rem`) | Section headings, Small (`sm`) lyrics size |
| `--text-xl` | `20px` (`1.25rem`) | Shelf headings, dialog titles |
| `--text-2xl` | `24px` (`1.5rem`) | Now Playing track title, Medium (`md`) lyrics size |
| `--text-3xl` | `30px` (`1.875rem`) | Large (`lg`) lyrics size |
| `--text-4xl` | `36px` (`2.25rem`) | Page header titles (`Home`, `Search`, `Settings`) |

* **Weights:** `--weight-regular` (`400`), `--weight-medium` (`500`), `--weight-semibold` (`600`), `--weight-bold` (`700`).
* **Line heights:** `--leading-tight` (`1.2`), `--leading-normal` (`1.5`), `--leading-relaxed` (`1.65`).
* **Tracking:** `--tracking-tight` (`-0.01em` for headings), `--tracking-normal` (`0em`), `--tracking-wide` (`0.02em`), `--tracking-caps` (`0.06em` for small uppercase straplines).

---

## Motion

Motion should clarify spatial transitions and settle cleanly rather than ornamenting static controls.

### Shared Timing Tokens ([tokens.css](src/styles/tokens.css))

* **Durations:** `--duration-fast` (`120ms`), `--duration-normal` (`200ms`), `--duration-slow` (`320ms`), `--duration-slower` (`500ms`), `--duration-ambience` (`1200ms` for cross-fading blurred artwork backdrops).
* **Curves:**
  * `--ease-out`: `cubic-bezier(0.16, 1, 0.3, 1)` — entrances and exits settling into rest.
  * `--ease-in-out`: `cubic-bezier(0.45, 0, 0.55, 1)` — balanced backdrop & skeleton transitions.
  * `--ease-spring`: `cubic-bezier(0.34, 1.56, 0.64, 1)` — tactile micro-overshoot on buttons, swatches, and toggles.

### Component Choreography & Reduced Motion

* **Window morph:** The OS window never changes size: it stays maximized and transparent, and the floating window is a frame drawn inside it ([src/lib/window-mode.ts](src/lib/window-mode.ts)), moved and resized in the page, with click-through around it. Maximize and restore are a layout switch plus a surface morph ([src/lib/window-morph.ts](src/lib/window-morph.ts)): the content fades out (`80ms`), flat stand-ins for each panel and the window background travel from the old boxes to the new ones (`300ms`, `cubic-bezier(0.2, 0, 0, 1)`), and the new layout fades in over them. Only image-free surfaces are scaled, because scaling panels full of album art makes the GPU re-decode every image; the new layout is switched a frame after the travel starts, so the compositor is already animating while the main thread paints it. Layout breakpoints are frame-width classes on `<html>` (`fw-max-700`, …) and `--frame-*` variables instead of viewport media queries and `vw`/`vh`. No-GPU machines get a lighter variant (Settings → Window Animation); reduced motion skips it.
* **Floating overscroll & sidebar tap:** Stage rubberband stretch/rebound runs at `80ms` / `320ms` (`cubic-bezier(0.22, 1, 0.36, 1)` in [floating.css](src/styles/floating.css)); sidebar link clicks trigger a `280ms` single-tap jiggle ([sidebar.css](src/styles/sidebar.css)).
* **Liquid Symbiote (Launch & Restore):** `GooRenderer` ([src/lib/visuals/goo-renderer.ts](src/lib/visuals/goo-renderer.ts)) and [symbiote.ts](src/lib/visuals/symbiote.ts) animate the Sonora logo on launch and a spinning vinyl artwork disc on taskbar restore over a 2-pass WebGL2 metaball layer, suppressing glass backdrop blurs while animating to avoid per-frame readbacks.
* **Accessibility fallbacks:**
  * `@media (prefers-reduced-motion: reduce)` disables transforms/slide animations across CSS views, fades gently, and hides `.symbiote-canvas` / `.symbiote-flyer` when `data-reduce-motion="true"`.
  * `AmbientVisualRenderer` drops to `10 FPS` when `prefers-reduced-motion: reduce` matches ([ambient-renderer.ts](src/lib/visuals/ambient-renderer.ts)).
  * `shouldReduceMotion()` in [src/lib/visuals/motion.ts](src/lib/visuals/motion.ts) governs JS-driven desktop animations.

---

## Shape, Texture, Glass & Elevation

* **Spacing:** `4px` grid (`--space-1` `4px` through `--space-20` `80px`); shell panel gap is `8px` maximized and `14px` floating (`--float-gap`).
* **Radii:** `--radius-sm` (`4px`), `--radius-md` (`6px`), `--radius-lg` (`8px`), `--radius-xl` (`12px`), `--radius-2xl` (`16px` for docked panels), `--radius-full` (`9999px` for pills, sliders, floating titlebar groups, and player capsule), and `--stage-radius` (`26px` for the floating central stage and Up Next pane in [floating.css](src/styles/floating.css)).
* **Glass material tiers ([tokens.css](src/styles/tokens.css) & [global.css](src/styles/global.css)):**
  * `--glass-blur-thin` (`6px`), `--glass-blur` (`12px`), `--glass-blur-deep` (`16px`), paired with `--glass-saturate` (`140%`) / `--glass-saturate-strong` (`150%`), `--glass-sheen`, and `--glass-edge`.
  * Main desktop panels sit over the pre-blurred `.ambient-art` layer and skip redundant `backdrop-filter` passes for performance.
  * `@media (prefers-reduced-transparency: reduce)` zeroes all blur filters and switches `--color-panel` and `--float-fill` to opaque fills.
* **Shadows:** Layered `--elevation-1..3` for docked panels and modal dialogs; floating pieces over transparent desktop space use tight contact-only shadows (`--float-shadow`, `--float-stage-shadow`) so no dark halo spills onto the user's wallpaper.
* **Texture:** Texture comes from blurred album artwork, radial ambience washes, and WebGL fragment shaders — **global grain or halftone overlays are not part of Sonora** and should not be added globally. (The only localized radial texture is the vinyl groove ring treatment on `.symbiote-disc__grooves` during taskbar restore in [symbiote.css](src/styles/symbiote.css).)

---

## Iconography

All icons live as inline SVG strings in [src/icons/index.ts](src/icons/index.ts) and inherit CSS `currentColor`:

* **Standard outlined icons** (`home`, `explore`, `search`, `library`, `heart`, `radio`, `shuffle`, `repeat`, `lyrics`, window controls, etc.): `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`.
* **Audio device & transport badges (`AUDIO_DEVICE_ICONS`, 24 combinations):** `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, **`stroke-width="1.85"`** with round caps and joins to keep the device silhouette + wired/wireless/Bluetooth badge crisp at small sizes.
* **Solid / brand icons:** `play`, `pause`, `skipForward`/`skipBack` triangles, and `grip` use `fill="currentColor"`. `sonoraLogo` uses a `512x512` viewBox filled with `currentColor` (or the `#38bdf8 → #818cf8 → #c084fc` brand gradient in [public/sonora-logo.svg](public/sonora-logo.svg)).

---

## Visualizers, Shaders & References

`Aurora`, `Fluid`, `Glow`, `Cinematic`, `Minimal`, and `None` are selectable in Settings; `Minimal` and `Cinematic` pause their animation loop once their palette transition converges ([ambient-renderer.ts](src/lib/visuals/ambient-renderer.ts)).

* **Shader & color extraction technical reference:** [docs/design/shaders.md](docs/design/shaders.md)
* **Machine-readable token & palette export:** [docs/design/palette.json](docs/design/palette.json)
* **Visual palette & mood board SVGs:** [docs/design/palette.svg](docs/design/palette.svg), [docs/design/moodboard.svg](docs/design/moodboard.svg)
* **Importable mood recipe JSONs:** [docs/design/presets/](docs/design/presets/sunset-tape.json) (design recipes, not built-in app presets)
* **Real-app capture instructions:** [docs/design/captures.md](docs/design/captures.md)
