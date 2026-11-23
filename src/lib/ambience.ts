/**
 * App-wide ambience.
 *
 * Tints the shell backdrop with colors from the current artwork by setting
 * CSS custom properties on the root element. global.css turns them into
 * soft gradients behind every panel; without a palette the theme accent is used.
 */

import type { ArtworkPalette } from "@/lib/visuals/color-extractor";
import { readableAccent } from "@/lib/accent";
import type { Theme } from "@/lib/theme";

/** Variables the artwork overrides on the app shell; removing them restores the theme's own. */
const ADAPTIVE_VARS = ["--color-accent", "--color-accent-hover", "--color-hover", "--color-active"] as const;

/**
 * Lets the whole interface take its accent from the artwork: buttons,
 * progress bars, active links and hover states. Set on the shell element so
 * the user's own accent on the root comes back as soon as this is cleared.
 */
export function applyArtworkAccent(palette: ArtworkPalette | null, theme: Theme, shell: HTMLElement): void {
  if (!palette) {
    ADAPTIVE_VARS.forEach((name) => shell.style.removeProperty(name));
    return;
  }
  const accent = readableAccent(palette.vibrant, theme);
  shell.style.setProperty("--color-accent", accent);
  shell.style.setProperty(
    "--color-accent-hover",
    `color-mix(in oklab, ${accent} 85%, ${theme === "light" ? "black" : "white"})`,
  );
  shell.style.setProperty("--color-hover", `color-mix(in oklab, ${accent} 9%, transparent)`);
  shell.style.setProperty("--color-active", `color-mix(in oklab, ${accent} 16%, transparent)`);
}

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

const ARTWORK_FADE_MS = 1200;

/**
 * The current artwork behind the whole app. Two layers
 * cross-fade so a track change never flashes the bare background.
 */
export class AmbientArtwork {
  readonly element: HTMLElement;
  private current: HTMLImageElement | null = null;
  private url: string | null = null;

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "ambient-art";
    this.element.setAttribute("aria-hidden", "true");
  }

  set(url: string | null): void {
    if (url === this.url) return;
    this.url = url;
    const previous = this.current;
    this.current = null;
    if (previous) this.retire(previous);
    if (!url) return;

    const layer = this.element.ownerDocument.createElement("img");
    layer.className = "ambient-art__layer";
    layer.alt = "";
    layer.decoding = "async";
    // Show the layer only once it has loaded, so the old one fades into a real image.
    layer.addEventListener("load", () => {
      if (this.current === layer) layer.classList.add("is-visible");
    }, { once: true });
    layer.addEventListener("error", () => layer.remove(), { once: true });
    layer.src = url;
    this.element.appendChild(layer);
    this.current = layer;
  }

  private retire(layer: HTMLImageElement): void {
    layer.classList.remove("is-visible");
    window.setTimeout(() => layer.remove(), ARTWORK_FADE_MS);
  }
}
