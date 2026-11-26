# Design References

Sonora follows a **muted editorial** direction: calm charcoal/bone surfaces, readable typography, translucent glass panels, and measured artwork-derived color. [DESIGN.md](../../DESIGN.md) defines the rules; this directory holds machine-readable exports, visual references, shader documentation, and importable theme recipes.

## Files in `docs/design/`

| File | Purpose |
| --- | --- |
| [palette.svg](palette.svg) | Visual swatch reference of Charcoal, Bone, and the 8 Settings accents |
| [palette.json](palette.json) | Machine-readable export of Dark/Light theme tokens, 8 accents, type scale, radii, and motion tokens |
| [moodboard.svg](moodboard.svg) | Concept board illustrating the three named mood recipes below (illustration, not a screenshot) |
| [shaders.md](shaders.md) | GLSL fragment shader reference (`Aurora`, `Fluid`, `Glow`, `Cinematic`, `Minimal`), `GooRenderer` metaballs, and `color-extractor.ts` |
| [presets/](presets/sunset-tape.json) | Ready-to-import `sonora-theme.json` files for the mood recipes below |
| [captures.md](captures.md) | Requirements for recording real Windows screenshots and hero GIFs into `docs/images/` |

## Mood Recipes

These named combinations map directly to Sonora's Settings and `sonora-theme.json` schema. They are **documented design recipes**, not built-in presets inside the app — you can load any of them via **Settings → Appearance Studio → Theme Configuration → Import Theme**.

*(Note: `ambientIntensity` is applied by Now Playing and persisted in `sonora-theme.json`, though Settings does not expose a separate intensity slider UI.)*

| Recipe | Theme | Accent | Visualizer | Intensity / FPS | Preset File |
| --- | --- | --- | --- | --- | --- |
| **Sunset Tape** | Dark (`#17151C`) | Muted Gold `#C9A96E` | Glow | `0.6` / `30` | [sunset-tape.json](presets/sunset-tape.json) |
| **Midnight Vinyl** | Dark (`#17151C`) | Dusty Purple `#A78BFA` | Minimal | `0.4` / `30` | [midnight-vinyl.json](presets/midnight-vinyl.json) |
| **Bone Editorial** | Light (`#F0EBDD`) | Bottle Green `#315E48` | Cinematic | `0.4` / `30` | [bone-editorial.json](presets/bone-editorial.json) |

## Source Code References

- Theme colors, spacing, typography, glass tiers, radii, and motion tokens: [tokens.css](../../src/styles/tokens.css)
- Floating layout stage, capsule, and contact shadows: [floating.css](../../src/styles/floating.css)
- Settings accents and JSON theme import/export: [settings.ts](../../src/views/settings.ts)
- WCAG AA `4.5:1` accent contrast adjustment: [accent.ts](../../src/lib/accent.ts)
- Dynamic artwork accent & ambient layer crossfade: [ambience.ts](../../src/lib/ambience.ts)
- WebGL ambient shaders: [ambient-renderer.ts](../../src/lib/visuals/ambient-renderer.ts)
- WebGL2 symbiote metaball renderer: [goo-renderer.ts](../../src/lib/visuals/goo-renderer.ts)
- Artwork palette extraction: [color-extractor.ts](../../src/lib/visuals/color-extractor.ts)
- Inline SVG icon registry: [icons/index.ts](../../src/icons/index.ts)
