# Design references

The chosen direction is **muted editorial**: neutral, legible surfaces with measured artwork color and restrained motion. [DESIGN.md](../../DESIGN.md) is the source for usage rules; [palette.svg](palette.svg) is an export of the current theme backgrounds and eight Settings accents. The [mood board](moodboard.svg) illustrates the recipes below. Both are design references, not screenshots of the application.

## Mood recipes

These are suggested combinations of existing settings, not named presets in Sonora. Their colors may be adjusted for contrast by the app and the artwork palette changes the final visual.

| Recipe | Theme | Accent | Visualizer | Intensity / FPS |
| --- | --- | --- | --- | --- |
| Sunset Tape | Dark | Muted Gold `#C9A96E` | Glow | 0.6 / 30 |
| Midnight Vinyl | Dark | Dusty Purple `#A78BFA` | Minimal | 0.4 / 30 |
| Bone Editorial | Light | Bottle Green `#315E48` | Cinematic | 0.4 / 30 |

## Source references

- Theme colors, spacing, type, glass, radii, and motion: [tokens.css](../../src/styles/tokens.css).
- Actual accent choices and theme JSON handling: [settings.ts](../../src/views/settings.ts).
- Theme contrast adjustment: [accent.ts](../../src/lib/accent.ts).
- Visualizer modes and rendering: [ambient-renderer.ts](../../src/lib/visuals/ambient-renderer.ts).
- Artwork color extraction: [color-extractor.ts](../../src/lib/visuals/color-extractor.ts).
- Inline SVG icons: [icons/index.ts](../../src/icons/index.ts).
- Real app captures: [capture guide](captures.md).
