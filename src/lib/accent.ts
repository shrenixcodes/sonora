/**
 * Accent color.
 *
 * With no saved choice, each theme uses its own accent from tokens.css.
 * A chosen accent is nudged toward black (light theme) or white (dark theme)
 * just far enough to stay readable as text on that theme's background.
 */

import type { Theme } from "@/lib/theme";

/** WCAG AA for normal-size text. */
const MIN_TEXT_CONTRAST = 4.5;
const STEP = 0.04;

/** The darkest surface text sits on in each theme (see tokens.css). */
const THEME_BACKGROUND: Record<Theme, string> = {
  dark: "#17151C",
  light: "#F0EBDD",
};

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const trimmed = hex.trim();
  const six = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  if (six) {
    const n = parseInt(six[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const three = /^#?([0-9a-f]{3})$/i.exec(trimmed);
  if (three) {
    const [r, g, b] = three[1].split("").map((ch) => parseInt(ch + ch, 16));
    return [r, g, b];
  }
  return null;
}

export function isValidHexAccent(hex: string | null | undefined): boolean {
  return Boolean(hex && parseHex(hex));
}

function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Returns the accent, adjusted only as much as needed to read on the theme background. */
export function readableAccent(hex: string, theme: Theme): string {
  const base = parseHex(hex);
  if (!base) return hex;
  const background = THEME_BACKGROUND[theme];
  const target: Rgb = theme === "light" ? [0, 0, 0] : [255, 255, 255];

  for (let t = 0; t <= 1; t += STEP) {
    const mixed = base.map((v, i) => v + (target[i] - v) * t) as Rgb;
    const candidate = toHex(mixed);
    if (contrastRatio(candidate, background) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return toHex(target);
}

/** Picks dark or light ink with stronger contrast against an accent surface. */
export function onAccentColor(accentHex: string): string {
  return contrastRatio(accentHex, THEME_BACKGROUND.dark) >= contrastRatio(accentHex, "#FFFFFF")
    ? THEME_BACKGROUND.dark
    : "#FFFFFF";
}

/** Applies a chosen accent for the theme, or clears it so the theme's own accent shows. */
export function applyAccent(
  hex: string | null,
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  if (!hex || !parseHex(hex)) {
    root.style.removeProperty("--color-accent");
    root.style.removeProperty("--color-accent-hover");
    root.style.removeProperty("--color-on-accent");
    root.style.removeProperty("--color-hover");
    root.style.removeProperty("--color-active");
    return;
  }
  const accent = readableAccent(hex, theme);
  root.style.setProperty("--color-accent", accent);
  root.style.setProperty("--color-accent-hover", `color-mix(in oklab, ${accent} 85%, ${theme === "light" ? "black" : "white"})`);
  root.style.setProperty("--color-on-accent", onAccentColor(accent));
  root.style.setProperty("--color-hover", `color-mix(in oklab, ${accent} 9%, transparent)`);
  root.style.setProperty("--color-active", `color-mix(in oklab, ${accent} 16%, transparent)`);
}
