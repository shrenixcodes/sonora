# Sonora design guide

Sonora should feel calm, tactile, and focused on the music. Use a muted editorial direction: strong type, restrained surfaces, and artwork-derived color give the interface character without competing with controls. Motion should explain state changes and settle quickly. Keep text and controls legible in both full and floating window modes.

## Color

The primary backgrounds are charcoal `#17151C` and bone `#F0EBDD`. Use the semantic tokens in [tokens.css](src/styles/tokens.css) for surfaces, text, borders, and feedback; avoid placing text directly on artwork without a readable surface. The theme default is purple in dark mode and green in light mode.

Settings currently provides **eight** explicit accents, in addition to each theme's default:

| Accent | Hex | Suggested character |
| --- | --- | --- |
| Dusty Purple | `#A78BFA` | Calm, default dark accent |
| Bottle Green | `#315E48` | Grounded, default light accent |
| Electric Blue | `#3B82F6` | Crisp, energetic focus |
| Muted Gold | `#C9A96E` | Warm highlights |
| Coral | `#D95342` | Warm contrast |
| Rose Pink | `#F472B6` | Soft emphasis |
| Emerald | `#10B981` | Bright green emphasis |
| Teal | `#14B8A6` | Cool, balanced emphasis |

These character descriptions are guidance, not separate functional states. Accents identify selected controls and focus; status colors have their own semantic tokens. The accent utility adjusts text contrast for the active theme. See the [palette reference](docs/design/palette.svg), [mood board](docs/design/moodboard.svg), and [design notes](docs/design/README.md).

## Typography

Inter Variable is bundled for both display and body text, with Segoe UI and system fallbacks. The token scale runs from 11px (`--text-xs`) through 36px (`--text-4xl`); common body text is 13-14px. Use weight and spacing for hierarchy rather than introducing another display face. Cascadia Mono and monospace fallbacks are available for technical metadata; use tabular figures for durations and other changing numbers.

## Motion

Shared durations are 120, 200, 320, 500, and 1200ms. The shared easing curves are `cubic-bezier(0.16, 1, 0.3, 1)` for exits into rest, `cubic-bezier(0.45, 0, 0.55, 1)` for balanced movement, and `cubic-bezier(0.34, 1.56, 0.64, 1)` for spring accents. Prefer small, purposeful transitions over motion on every element. Respect system reduced-motion and reduced-transparency preferences, and check the floating layout as well as maximized mode.

## Shape, texture, and icons

The spacing system uses a 4px base; common radii are 4, 6, 8, 12, and 16px, with pill shapes for compact controls. Use quiet borders, layered shadows, glass surfaces, and restrained gradients. Artwork and shader color provide texture; grain or halftone is not an existing global material and should not be added as a default. Icons are inline SVGs in [the icon registry](src/icons/index.ts); most outlined icons use a 24px viewBox, 2px strokes, and rounded joins.

## Visualizers and references

Aurora, Fluid, Glow, Cinematic, Minimal, and None are actual settings. Shader implementations live in [ambient-renderer.ts](src/lib/visuals/ambient-renderer.ts); artwork color extraction lives in [color-extractor.ts](src/lib/visuals/color-extractor.ts). The [design notes](docs/design/README.md) contain palette and shader references, plus named example settings that are design recipes, not built-in presets. See the [capture guide](docs/design/captures.md) for genuine screenshots and video.
