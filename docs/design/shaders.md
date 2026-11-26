# Shaders & Color Extraction Reference

Sonora's visual atmosphere relies on three modules in `src/lib/visuals/` plus `src/lib/ambience.ts`.

---

## 1. Artwork Color Extraction (`src/lib/visuals/color-extractor.ts`)

`extractPalette(imageUrl)` derives an `ArtworkPalette` from each track's cover image:

* **Downsampling:** Draws artwork onto a single reused `64x64` offscreen `<canvas>` (`willReadFrequently: true`) and samples every 4th pixel (step = 16 bytes) while skipping transparent pixels (`alpha < 128`).
* **Color bucketing:** Groups pixels within Manhattan RGB distance `< 40` into weighted buckets sorted descending by frequency.
* **Palette roles:**
  * `dominant` — highest-weight bucket.
  * `vibrant` — best score (`s * 1.5 - |l - 0.5|`) among the top 15 buckets whose lightness falls in `[0.25, 0.80]`.
  * `secondary` — second-most frequent bucket (fallback: `vibrant`).
  * `darkMuted` — `dominant * 0.25`.
  * `lightMuted` — `min(255, vibrant * 0.4 + 180)`.
* **Caching & fallback:** Results are memoized in a `BoundedCache` of `150` entries. On CORS failure, missing URL, or `4000ms` timeout, falls back to Sonora's default Charcoal/Purple/Gold palette (`#292532`, `#A78BFA`, `#C9A96E`, `#17151C`, `#F4F0F6`).

---

## 2. Ambient Visualizer Shaders (`src/lib/visuals/ambient-renderer.ts`)

`AmbientVisualRenderer` renders a full-screen quad in WebGL1 (`alpha: false, depth: false, antialias: false, powerPreference: "low-power"`).

### Shared Uniforms & Scaling

| Uniform | Type | Description |
| --- | --- | --- |
| `u_time` | `float` | Elapsed seconds since renderer initialization |
| `u_intensity` | `float` | Clamped to `[0.1, 1.0]` (`0.8` default; configurable via `sonora-theme.json`) |
| `u_color_dominant` | `vec3` | Normalized RGB from `rgbDominant` |
| `u_color_vibrant` | `vec3` | Normalized RGB from `rgbVibrant` |
| `u_color_secondary` | `vec3` | Normalized RGB from `rgbSecondary` |
| `u_color_dark` | `vec3` | `rgbDominant * 0.2 / 255.0` |

* **Resolution cap:** Backing canvas width/height scales down via `min(0.4, 640 / max(cssWidth, cssHeight))` to keep GPU fill-rate costs low on HiDPI displays.
* **Color interpolation:** Each rendered frame lerps `currentPalette` toward `targetPalette` (`lerpFactor = 0.05`) until within `0.0015` (`PALETTE_CONVERGE_EPSILON`).
* **Power management:**
  * Frame rate is throttled via `setTimeout` + `requestAnimationFrame` to `15`, `30` (default), or `60` FPS.
  * Automatically pauses on `document.hidden` (`visibilitychange`).
  * Drops to `10` FPS when `prefers-reduced-motion: reduce` matches.

### Visualizer Modes

| Mode (`AmbientVisualMode`) | Visual Behavior | Render Loop |
| --- | --- | --- |
| `aurora` | Dual layered 2D value-noise distortion creating drifting auroral ribbons blended across dark, dominant, secondary, and vibrant colors with radial vignette | Continuous |
| `fluid` | 3-octave iterative sine/cosine domain warping around screen center producing organic flowing bands | Continuous |
| `glow` | Breathing exponential bloom (`sin(u_time * 0.6)`) centered at `(0.5, 0.45)` | Continuous |
| `cinematic` | Dual vertical top/bottom exponential spotlights with a darkened circular stage vignette | **Pauses once palette converges** |
| `minimal` | Smooth diagonal wash (`v_uv.y * 0.7 + v_uv.x * 0.3`) between dark, dominant, and subtle vibrant tones | **Pauses once palette converges** |
| `none` | Clears WebGL buffer to `#17151C` (`rgba(0.09, 0.08, 0.11, 1.0)`) and stops rendering | Stopped |

---

## 3. Liquid Symbiote Metaball Renderer (`src/lib/visuals/goo-renderer.ts`)

Used by [symbiote.ts](../../src/lib/visuals/symbiote.ts) for launch splash (`F8`) and taskbar restore (`F9`) animations on a transparent full-window `<canvas>` (`.symbiote-canvas`).

* **Two-pass WebGL2 pipeline (`#version 300 es`):**
  1. **Splat pass:** Draws instanced quads into a half-resolution RGBA8 field texture using additive blending (`ONE, ONE`), accumulating cubic radial falloff `(1 - d²)³ * weight` into alpha and field-weighted RGB.
  2. **Composite pass:** Thresholds the field at `T = 0.5` with `fwidth`-based anti-aliasing, computes surface normals from neighboring field height samples, and applies directional diffuse shading, Blinn-Phong specular highlight (`pow(..., 46.0)`), and rim lighting.
* **Palette integration:** Driven by `setLiquidPalette(palette)` in [main.ts](../../src/main.ts), matching the currently playing track's artwork colors.
