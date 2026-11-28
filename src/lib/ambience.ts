/**
 * App-wide ambience.
 *
 * Tints the shell backdrop with colors from the current artwork by setting
 * CSS custom properties on the root element. global.css turns them into
 * soft gradients behind every panel; without a palette the theme accent is used.
 */

import type { ArtworkPalette } from "@/lib/visuals/color-extractor";
import { isValidHexAccent, onAccentColor, readableAccent } from "@/lib/accent";
import type { Theme } from "@/lib/theme";

/** Variables the artwork overrides on the app shell; removing them restores the theme's own. */
const ADAPTIVE_VARS = [
  "--color-accent",
  "--color-accent-hover",
  "--color-on-accent",
  "--color-hover",
  "--color-active",
] as const;

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
  shell.style.setProperty("--color-on-accent", onAccentColor(accent));
  shell.style.setProperty("--color-hover", `color-mix(in oklab, ${accent} 9%, transparent)`);
  shell.style.setProperty("--color-active", `color-mix(in oklab, ${accent} 16%, transparent)`);
}

/** Applies artwork accent only when no explicit user accent color is selected. */
export function syncShellAccent(
  palette: ArtworkPalette | null,
  theme: Theme,
  shell: HTMLElement,
  customAccent: string | null,
): void {
  applyArtworkAccent(isValidHexAccent(customAccent) ? null : palette, theme, shell);
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
 * The artwork is blurred once, small; the browser's smooth upscale to window
 * size finishes the softening. The blur matches the old live
 * `blur(36px)` on a ~2500px layer, scaled down to this canvas.
 */
export const ARTWORK_CANVAS_SIZE = 128;
export const ARTWORK_FILTER = "blur(2.5px) saturate(140%)";

export type ImageLoader = (url: string) => Promise<CanvasImageSource & { width: number; height: number }>;

const loadImage: ImageLoader = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`artwork failed to load: ${url}`));
    image.src = url;
  });

/**
 * Draws the whole artwork, blurred, into the layer at its own shape (longest
 * side ARTWORK_CANVAS_SIZE), so object-fit crops it as it did the image.
 * False when it cannot draw.
 */
function paintBlurred(layer: HTMLCanvasElement, image: CanvasImageSource & { width: number; height: number }): boolean {
  if (image.width <= 0 || image.height <= 0) return false;
  const scale = ARTWORK_CANVAS_SIZE / Math.max(image.width, image.height);
  layer.width = Math.max(1, Math.round(image.width * scale));
  layer.height = Math.max(1, Math.round(image.height * scale));
  const ctx = layer.getContext("2d");
  if (!ctx) return false;
  ctx.filter = ARTWORK_FILTER;
  ctx.drawImage(image, 0, 0, layer.width, layer.height);
  return true;
}

/**
 * The current artwork behind the whole app. Two layers
 * cross-fade so a track change never flashes the bare background.
 *
 * A live CSS blur here was redrawn whenever anything above it changed: every
 * frame of the Now Playing shader, and both layers through each cross-fade.
 */
export class AmbientArtwork {
  readonly element: HTMLElement;
  private current: HTMLCanvasElement | null = null;
  private url: string | null = null;

  constructor(
    doc: Document = document,
    private readonly load: ImageLoader = loadImage,
  ) {
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

    const layer = this.element.ownerDocument.createElement("canvas");
    layer.className = "ambient-art__layer";
    this.element.appendChild(layer);
    this.current = layer;
    // Show the layer only once it holds the artwork, so the old one fades into a real image.
    this.load(url)
      .then((image) => {
        if (this.current !== layer) return;
        if (paintBlurred(layer, image)) layer.classList.add("is-visible");
        else layer.remove();
      })
      .catch(() => layer.remove());
  }

  private retire(layer: HTMLCanvasElement): void {
    layer.classList.remove("is-visible");
    window.setTimeout(() => layer.remove(), ARTWORK_FADE_MS);
  }
}
