/**
 * App-wide ambience.
 *
 * Tints the shell backdrop with colors from the current artwork by setting
 * CSS custom properties on the root element. global.css turns them into
 * soft gradients behind every panel; without a palette the theme accent is used.
 */

import type { ArtworkPalette } from "@/lib/visuals/color-extractor";

export const AMBIENCE_VARS = {
  "--ambience-1": "vibrant",
  "--ambience-2": "dominant",
  "--ambience-3": "secondary",
} as const satisfies Record<string, keyof ArtworkPalette>;

/** Applies a palette to the backdrop, or restores the theme default when null. */
export function applyAmbience(
  palette: ArtworkPalette | null,
  root: HTMLElement = document.documentElement,
): void {
  for (const [cssVar, key] of Object.entries(AMBIENCE_VARS)) {
    if (palette) {
      root.style.setProperty(cssVar, palette[key]);
    } else {
      root.style.removeProperty(cssVar);
    }
  }
}
