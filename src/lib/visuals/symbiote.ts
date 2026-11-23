/**
 * Symbiote — Sonora's liquid entrance animations.
 *
 * Restore (taskbar click on a minimized window):
 *   Music first. The current album art rises out of the taskbar button as a
 *   spinning vinyl disc riding a liquid tendril, lands in its slot in the player
 *   bar and settles into the artwork's own shape; the bar spreads out from it.
 *   Only then do tendrils bleed in from the edges of the screen (not the window:
 *   a window dragged to a corner is reached from the screen edges around it),
 *   flood each panel and melt away as the panel pops into place. Edges, order
 *   and curves are randomized on every restore.
 *
 * Launch:
 *   The Sonora logo rides out of the taskbar into the middle of the window, where
 *   the liquid pools into a glossy droplet with a splash crown. The pool bursts
 *   into tendrils that build every panel, and the logo flies into the sidebar.
 *
 * The liquid takes its colors from the artwork of the playing track (black
 * symbiote when nothing is playing) and is rendered as GPU metaballs (see
 * goo-renderer.ts). Panels only animate transform and opacity, so the
 * compositor can run them without repainting.
 *
 * To avoid Windows flashing the old frame when the window is restored, the
 * shell is faded out *before* minimizing: the native side holds back the
 * taskbar's minimize request until the frontend has painted an empty frame.
 */

import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { icon } from "@/icons";
import { GooRenderer, type GooBlob } from "./goo-renderer";
import { shouldReduceMotion } from "./motion";

// ── Types ─────────────────────────────────────────────────────

export type Direction =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const DIRECTIONS: readonly Direction[] = [
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

/**
 * How panels are assigned to screen edges on a given restore.
 * - natural:   each panel comes from the screen edge it is nearest to
 * - crossfire: each panel comes from the opposite edge, tendrils cross the screen
 * - sweep:     everything comes from one edge, arriving as a wave
 * - scatter:   every panel picks its own random edge or corner
 * - swarm:     tendrils from several random edges converge on every panel
 */
export type RevealMode = "natural" | "crossfire" | "sweep" | "scatter" | "swarm";

export const REVEAL_MODES: readonly RevealMode[] = [
  "natural",
  "crossfire",
  "sweep",
  "scatter",
  "swarm",
] as const;

export type TaskbarEdge = "bottom" | "top" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The screen in the window's coordinate space (CSS px, window top-left = 0,0). */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the window's content area is, and the monitor it is on, in CSS px. */
export interface ScreenGeometry {
  /** Content area's top-left in virtual-screen coordinates. */
  screenX: number;
  screenY: number;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  /** Work area (the monitor minus the taskbar). */
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  /** The monitor's origin, when known. */
  monitorLeft?: number;
  monitorTop?: number;
}

export interface PiecePlan {
  /** Index into the rects passed to planReveal. */
  index: number;
  /** Screen edges the tendrils for this piece come from. */
  from: Direction[];
  /** When the first tendril starts, in ms from the start of the animation. */
  start: number;
  /** Minimum time the tendrils take to reach the piece. */
  travel: number;
}

/** Colors from the playing track's artwork. */
export interface LiquidPalette {
  vibrant: string;
  dominant: string;
  secondary: string;
}

type RGB = [number, number, number];

export interface LiquidColors {
  /** Liquid body colors; entities pick one by index. */
  fills: RGB[];
  /** Specular highlight color. */
  sheen: string;
  /** Thin edge light around the liquid. */
  rim: string;
}

// ── Timeline ──────────────────────────────────────────────────

/** How long the disc is visibly rising before it lands in the player bar. */
export const DISC_RISE_MS = 560;
/** Shortest album art flight; kept for callers that time against it. */
export const ART_FLIGHT_MS = DISC_RISE_MS;
/** Earliest moment a panel tendril leaves its edge. */
const TENDRIL_START_MS = 170;
/** Tendril speed cap, px per ms: long paths take longer instead of whipping. */
const TENDRIL_SPEED = 3.4;
/** Time from a tendril reaching its panel to the goo being gone. */
const MELT_MS = 600;
/** Upper bound for a whole sequence; cleanup is guaranteed by then. */
export const SEQUENCE_MAX_MS = 2800;
/** How long a launch waits for the window to be presented before giving up. */
const PRIME_TIMEOUT_MS = 5000;
/** The shell's fade-out before a minimize (matches the CSS transition). */
const MINIMIZE_FADE_MS = 120;

/** Panels that are revealed by their own tendrils. */
export const PIECE_SELECTORS = [
  ".titlebar__left",
  ".titlebar__search",
  ".titlebar__right",
  ".sidebar",
  ".main",
  ".queue-panel",
] as const;

/** Pieces inside the player bar that follow the album art out. */
const PLAYER_PART_SELECTORS = [".player__meta", ".player__like-btn", ".player__controls", ".player__right"];

const VENOM: RGB = [7, 6, 12];
/** Windows parks minimized windows at -32000,-32000. */
const MINIMIZED_POSITION = -30000;

// ── Easing ────────────────────────────────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeOutBack = (t: number): number => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Lunge: slow peel off the edge, fast travel, soft landing. */
const easeLunge = (t: number): number => easeInOutCubic(t) * 0.85 + easeOutCubic(t) * 0.15;

// ── Geometry (pure, tested) ───────────────────────────────────

/** Unit vector pointing from an edge into the screen. */
export function inwardVector(direction: Direction): Point {
  const d = Math.SQRT1_2;
  switch (direction) {
    case "top":
      return { x: 0, y: 1 };
    case "bottom":
      return { x: 0, y: -1 };
    case "left":
      return { x: 1, y: 0 };
    case "right":
      return { x: -1, y: 0 };
    case "top-left":
      return { x: d, y: d };
    case "top-right":
      return { x: -d, y: d };
    case "bottom-left":
      return { x: d, y: -d };
    case "bottom-right":
      return { x: -d, y: -d };
  }
}

export function oppositeDirection(direction: Direction): Direction {
  const map: Record<Direction, Direction> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
    "top-left": "bottom-right",
    "top-right": "bottom-left",
    "bottom-left": "top-right",
    "bottom-right": "top-left",
  };
  return map[direction];
}

/** The edge (or corner, when two edges are about as close) a rect sits against. */
export function nearestDirection(rect: Rect, area: { width: number; height: number }): Direction {
  const gaps: Array<[Direction, number]> = [
    ["left", rect.x],
    ["right", area.width - (rect.x + rect.width)],
    ["top", rect.y],
    ["bottom", area.height - (rect.y + rect.height)],
  ];
  gaps.sort((a, b) => a[1] - b[1]);
  const [first, second] = gaps;
  const horizontal = (d: Direction) => d === "left" || d === "right";
  if (second[1] - first[1] < 24 && horizontal(first[0]) !== horizontal(second[0])) {
    const v = horizontal(first[0]) ? second[0] : first[0];
    const h = horizontal(first[0]) ? first[0] : second[0];
    return `${v}-${h}` as Direction;
  }
  return first[0];
}

/** The monitor's top-left in virtual-screen coordinates. */
function monitorOrigin(g: ScreenGeometry): Point {
  if (g.monitorLeft !== undefined && g.monitorTop !== undefined) {
    return { x: g.monitorLeft, y: g.monitorTop };
  }
  // Without it, a work area offset by exactly the taskbar's size means the bar is on that side
  const spareH = g.screenHeight - g.availHeight;
  const spareW = g.screenWidth - g.availWidth;
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  return {
    x: spareW > 0 && mod(g.availLeft, g.screenWidth) === spareW ? g.availLeft - spareW : g.availLeft,
    y: spareH > 0 && mod(g.availTop, g.screenHeight) === spareH ? g.availTop - spareH : g.availTop,
  };
}

export function detectTaskbarEdge(g: ScreenGeometry): TaskbarEdge {
  const origin = monitorOrigin(g);
  // The work area is the monitor minus the taskbar; whichever side it gave up holds the bar
  if (g.availHeight < g.screenHeight) return g.availTop > origin.y ? "top" : "bottom";
  if (g.availWidth < g.screenWidth) return g.availLeft > origin.x ? "left" : "right";
  return "bottom";
}

/** The window's monitor, in the window's own coordinates. */
export function screenBoundsInWindow(g: ScreenGeometry): Bounds {
  const origin = monitorOrigin(g);
  const left = origin.x - g.screenX;
  const top = origin.y - g.screenY;
  return { left, top, right: left + g.screenWidth, bottom: top + g.screenHeight };
}

/**
 * Where the taskbar button sits, in the window's coordinates. Windows 11 centers
 * taskbar buttons, so the middle of the taskbar is the best guess. Follows the
 * window wherever it was dragged, including onto another monitor.
 */
export function taskbarAnchor(g: ScreenGeometry): Point & { edge: TaskbarEdge } {
  const edge = detectTaskbarEdge(g);
  const b = screenBoundsInWindow(g);
  const barH = Math.max(32, g.screenHeight - g.availHeight);
  const barW = Math.max(32, g.screenWidth - g.availWidth);
  const midX = (b.left + b.right) / 2;
  const midY = (b.top + b.bottom) / 2;
  switch (edge) {
    case "top":
      return { x: midX, y: b.top + barH / 2, edge };
    case "left":
      return { x: b.left + barW / 2, y: midY, edge };
    case "right":
      return { x: b.right - barW / 2, y: midY, edge };
    default:
      return { x: midX, y: b.bottom - barH / 2, edge };
  }
}

/** A point on a screen edge (or corner) for a tendril aimed at target. */
export function edgeSpawn(
  direction: Direction,
  target: Point,
  b: Bounds,
  margin: number,
  rng: () => number = Math.random,
): Point {
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const jitter = (span: number) => (rng() - 0.5) * span;
  const cx = (x: number) => clamp(x, b.left, b.right);
  const cy = (y: number) => clamp(y, b.top, b.bottom);
  const corner = (x: number, y: number, sx: number, sy: number): Point =>
    rng() < 0.5 ? { x: x - sx * margin, y: y + sy * rng() * h * 0.15 } : { x: x + sx * rng() * w * 0.15, y: y - sy * margin };
  switch (direction) {
    case "left":
      return { x: b.left - margin, y: cy(target.y + jitter(h * 0.3)) };
    case "right":
      return { x: b.right + margin, y: cy(target.y + jitter(h * 0.3)) };
    case "top":
      return { x: cx(target.x + jitter(w * 0.3)), y: b.top - margin };
    case "bottom":
      return { x: cx(target.x + jitter(w * 0.3)), y: b.bottom + margin };
    case "top-left":
      return corner(b.left, b.top, 1, 1);
    case "top-right":
      return corner(b.right, b.top, -1, 1);
    case "bottom-left":
      return corner(b.left, b.bottom, 1, -1);
    case "bottom-right":
      return corner(b.right, b.bottom, -1, -1);
  }
}

/** A random mode that differs from the previous one. */
export function pickMode(previous: RevealMode | null, rng: () => number = Math.random): RevealMode {
  const options = REVEAL_MODES.filter((m) => m !== previous);
  return options[Math.floor(rng() * options.length) % options.length];
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function randomDirection(rng: () => number, avoid?: Direction): Direction {
  const options = DIRECTIONS.filter((d) => d !== avoid);
  return options[Math.floor(rng() * options.length) % options.length];
}

/** How far a rect's center is from the edge a direction names. */
function distanceFromEdge(rect: Rect, direction: Direction, area: { width: number; height: number }): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const v = inwardVector(direction);
  const ox = v.x > 0 ? 0 : v.x < 0 ? area.width : cx;
  const oy = v.y > 0 ? 0 : v.y < 0 ? area.height : cy;
  return (cx - ox) * v.x + (cy - oy) * v.y;
}

/**
 * Decides, for each piece, which edges its tendrils come from and when they leave.
 * Rects and area share one coordinate space (the screen, for restores).
 * Pure: the same rng sequence gives the same plan.
 */
export function planReveal(
  rects: Rect[],
  area: { width: number; height: number },
  mode: RevealMode,
  rng: () => number = Math.random,
  startAt: number = TENDRIL_START_MS,
): PiecePlan[] {
  const indices = rects.map((_, i) => i);
  const sweepFrom = randomDirection(rng);
  const order =
    mode === "sweep"
      ? indices.slice().sort((a, b) => distanceFromEdge(rects[a], sweepFrom, area) - distanceFromEdge(rects[b], sweepFrom, area))
      : shuffle(indices, rng);

  const plans: PiecePlan[] = [];
  let t = startAt;
  let previous: Direction | undefined;
  for (const index of order) {
    const rect = rects[index];
    const near = nearestDirection(rect, area);
    let from: Direction[];
    switch (mode) {
      case "natural":
        from = [near];
        break;
      case "crossfire":
        from = [oppositeDirection(near)];
        break;
      case "sweep":
        from = [sweepFrom];
        break;
      case "scatter":
        from = [randomDirection(rng, previous)];
        break;
      case "swarm":
        from = shuffle(DIRECTIONS.slice(), rng).slice(0, 2 + Math.floor(rng() * 2));
        break;
    }
    previous = from[0];

    const size = rect.width * rect.height;
    const travel = Math.round(320 + rng() * 110 + Math.min(80, size / 12000));
    plans.push({ index, from, start: Math.round(t), travel });
    t += mode === "sweep" ? 55 : 40 + rng() * 55;
  }

  return plans.sort((a, b) => a.index - b.index);
}

// ── Color (pure, tested) ──────────────────────────────────────

export function parseColor(value: string): RGB | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((c) => clamp(Math.round(c), 0, 255)) as RGB;
  return null;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((c) => Math.round(c * 255)) as RGB;
}

const toHex = (rgb: RGB): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * Liquid colors for the playing track: the artwork's hues, deepened so the
 * liquid still reads as a dense, glossy body; black symbiote with nothing playing.
 */
export function liquidColors(palette: LiquidPalette | null, accent = "#a78bfa"): LiquidColors {
  if (!palette) return { fills: [VENOM, VENOM, VENOM], sheen: "#f3efff", rim: accent };
  const vibrant = parseColor(palette.vibrant);
  if (!vibrant) return { fills: [VENOM, VENOM, VENOM], sheen: "#f3efff", rim: accent };

  const deepen = (rgb: RGB | null): RGB => {
    const [h, s, l] = rgbToHsl(rgb ?? vibrant);
    return hslToRgb(h, Math.min(1, s * 1.15 + 0.05), clamp(l * 0.6, 0.09, 0.3));
  };
  const [vh, vs, vl] = rgbToHsl(vibrant);
  return {
    fills: [deepen(vibrant), deepen(parseColor(palette.dominant)), deepen(parseColor(palette.secondary))],
    sheen: toHex(hslToRgb(vh, Math.min(1, vs * 0.6), Math.max(0.86, vl))),
    rim: toHex(hslToRgb(vh, Math.min(1, vs * 1.05), clamp(vl, 0.6, 0.75))),
  };
}

// ── Goo entities ──────────────────────────────────────────────

type Blob = GooBlob;

interface Curve {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
}

interface Tendril extends Curve {
  start: number;
  travel: number;
  /** When the tendril starts melting back. */
  melt: number;
  meltDur: number;
  baseR: number;
  segments: number;
  phase: number;
  wobble: number;
  color: number;
  /** Keep the head alive until then (it carries the disc or logo). */
  headHold?: number;
}

interface Membrane {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  r: number;
  start: number;
  grow: number;
  melt: number;
  meltDur: number;
  driftX: number;
  driftY: number;
  phase: number;
  color: number;
}

/** One leg of a flight along a curve. Sizes and radii in CSS px. */
interface FlightLeg {
  path: Tendril;
  size0: number;
  size1: number;
  /** Size partway through, when the flyer swells on the way (the rising disc). */
  peak?: number;
  radius0: number;
  radius1: number;
  /** Degrees it turns back to rest over the leg; whole turns for the disc. */
  spin: number;
}

/** A DOM element (album disc, logo) flying along legs over the goo. */
interface Flyer {
  el: HTMLElement;
  /** Turning layer inside the element; the outer one only moves and scales. */
  spinner: HTMLElement | null;
  base: number;
  legs: FlightLeg[];
  fadeStart: number;
  fadeDur: number;
  /** Gentle breathing between two moments (the launch pool). */
  breathe?: [number, number];
  /** The disc's grooves fade and it squares off into the artwork over this window. */
  settle?: [number, number];
}

function bezier(t: Curve, u: number): Point {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return { x: a * t.sx + b * t.cx + c * t.tx, y: a * t.sy + b * t.cy + c * t.ty };
}

function bezierNormal(t: Curve, u: number): Point {
  const dx = 2 * (1 - u) * (t.cx - t.sx) + 2 * u * (t.tx - t.cx);
  const dy = 2 * (1 - u) * (t.cy - t.sy) + 2 * u * (t.ty - t.cy);
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Rough length of a curve (its control polygon). */
function pathLength(t: Curve): number {
  return Math.hypot(t.cx - t.sx, t.cy - t.sy) + Math.hypot(t.tx - t.cx, t.ty - t.cy);
}

function tendrilHead(t: Tendril, now: number): Point {
  return bezier(t, easeLunge(clamp01((now - t.start) / t.travel)));
}

function pushTendril(out: Blob[], t: Tendril, now: number, view: Bounds): void {
  if (now < t.start) return;
  const p = clamp01((now - t.start) / t.travel);
  const headU = easeLunge(p);
  const emerge = easeOutCubic(clamp01(p * 3.5));
  const melt = clamp01((now - t.melt) / t.meltDur);
  const spacing = (pathLength(t) * headU) / t.segments;

  for (let i = 0; i <= t.segments; i++) {
    const k = i / t.segments; // 0 = head, 1 = root at the edge
    const u = headU * (1 - k);
    const pos = bezier(t, u);

    // Head is thickest, the middle thins out, the root pools where it came from
    const profile = k < 0.15 ? 1 - k * 0.9 : 0.62 - (k - 0.15) * 0.45 + Math.pow(k, 6) * 0.55;
    const pulse = 1 + 0.13 * Math.sin(now * 0.018 + i * 0.85 + t.phase);
    let r = t.baseR * profile * pulse * emerge;

    // Melt from the root toward the head, so the tendril snaps into droplets
    if (melt > 0) {
      const local = clamp01(melt * 1.6 - (1 - k) * 0.6);
      const keepHead = t.headHold !== undefined && i === 0 && now < t.headHold;
      r *= keepHead ? 1 : 1 - easeInCubic(local);
    }
    if (r < 0.6) continue;

    const n = bezierNormal(t, u);
    const sway = Math.sin(u * Math.PI * 3 + now * 0.011 + t.phase) * t.wobble * k;
    const x = pos.x + n.x * sway;
    const y = pos.y + n.y * sway;
    // Most of a tendril from a far screen edge is outside the window
    if (x + r * 2 < view.left || x - r * 2 > view.right || y + r * 2 < view.top || y - r * 2 > view.bottom) continue;
    // Overlapping segments share the field, so a chain is as thick as one blob
    const w = Math.min(1, Math.max(0.01, spacing / (2 * r)));
    out.push({ x, y, r, w, c: t.color });
  }
}

function pushMembrane(out: Blob[], m: Membrane, now: number): void {
  if (now < m.start) return;
  const g = clamp01((now - m.start) / m.grow);
  const melt = clamp01((now - m.melt) / m.meltDur);
  let r = m.r * easeOutBack(g) * (1 - easeInCubic(melt));
  if (r < 0.6) return;
  r *= 1 + 0.07 * Math.sin(now * 0.02 + m.phase);
  const e = easeOutCubic(g);
  out.push({
    x: lerp(m.fromX, m.toX, e) + m.driftX * melt,
    y: lerp(m.fromY, m.toY, e) + m.driftY * melt,
    r,
    w: 1,
    c: m.color,
  });
}

function placeFlyer(f: Flyer, t: number): void {
  let leg = f.legs[0];
  for (const candidate of f.legs) if (t >= candidate.path.start) leg = candidate;
  const p = clamp01((t - leg.path.start) / leg.path.travel);
  const head = tendrilHead(leg.path, t);
  const landed = t - (leg.path.start + leg.path.travel);
  const bounce = landed > 0 ? Math.sin(Math.PI * clamp01(landed / 220)) * 0.08 : 0;
  const breathe =
    f.breathe && t > f.breathe[0] && t < f.breathe[1]
      ? Math.sin(((t - f.breathe[0]) / (f.breathe[1] - f.breathe[0])) * Math.PI) * 0.05
      : 0;

  let size: number;
  if (leg.peak !== undefined) {
    size =
      p < 0.55
        ? lerp(leg.size0, leg.peak, easeOutCubic(p / 0.55))
        : lerp(leg.peak, leg.size1, easeInOutCubic((p - 0.55) / 0.45));
  } else {
    size = lerp(leg.size0, leg.size1, easeOutCubic(p));
  }
  size *= 1 + bounce + breathe;
  const scale = size / f.base;

  let radius: number;
  if (f.settle) {
    const m = easeInOutCubic(clamp01((t - f.settle[0]) / (f.settle[1] - f.settle[0])));
    radius = lerp(size / 2, leg.radius1, m);
    f.el.style.setProperty("--disc", String(1 - m));
  } else {
    radius = lerp(leg.radius0, leg.radius1, easeInOutCubic(clamp01((p - 0.35) / 0.65)));
  }

  const angle = leg.spin * (1 - easeOutCubic(p));
  f.el.style.transform =
    `translate(${head.x - f.base / 2}px, ${head.y - f.base / 2}px) scale(${scale})` +
    (f.spinner ? "" : ` rotate(${angle}deg)`);
  if (f.spinner) f.spinner.style.transform = `rotate(${angle}deg)`;
  f.el.style.borderRadius = `${radius / Math.max(0.01, scale)}px`;
  f.el.style.opacity = String(1 - clamp01((t - f.fadeStart) / f.fadeDur));
}

// ── Window position tracking ──────────────────────────────────

let nativeGeometry: ScreenGeometry | null = null;
let domGeometry: ScreenGeometry | null = null;

export function isPlausibleGeometry(g: ScreenGeometry): boolean {
  return (
    g.screenX > MINIMIZED_POSITION &&
    g.screenY > MINIMIZED_POSITION &&
    g.innerWidth > 0 &&
    g.innerHeight > 0 &&
    g.screenWidth > 0 &&
    g.screenHeight > 0
  );
}

function readDomGeometry(): ScreenGeometry {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  const innerWidth = window.innerWidth || 1024;
  const innerHeight = window.innerHeight || 768;
  const screenWidth = s?.width || 1920;
  const screenHeight = s?.height || 1080;
  // screenX/Y are the outer frame; step in to the content area
  const frameX = Math.max(0, ((window.outerWidth || innerWidth) - innerWidth) / 2);
  const frameY = Math.max(0, (window.outerHeight || innerHeight) - innerHeight - frameX);
  return {
    screenX: (window.screenX || 0) + frameX,
    screenY: (window.screenY || 0) + frameY,
    innerWidth,
    innerHeight,
    screenWidth,
    screenHeight,
    availLeft: Number(s?.availLeft) || 0,
    availTop: Number(s?.availTop) || 0,
    availWidth: s?.availWidth || screenWidth,
    availHeight: s?.availHeight || screenHeight,
  };
}

/** Records where the window is now, unless it is parked off-screen by a minimize. */
export function rememberWindowPosition(): void {
  const g = readDomGeometry();
  if (isPlausibleGeometry(g)) domGeometry = g;
}

/** Reads the window's exact position and monitor work area from the desktop shell. */
async function refreshNativeGeometry(): Promise<void> {
  if (!isTauri()) return;
  try {
    const win = getCurrentWindow();
    if (await win.isMinimized()) return;
    const [pos, size, scale, monitor] = await Promise.all([
      win.innerPosition(),
      win.innerSize(),
      win.scaleFactor(),
      currentMonitor(),
    ]);
    if (!monitor) return;
    const k = 1 / (scale || 1);
    const work = monitor.workArea ?? { position: monitor.position, size: monitor.size };
    const g: ScreenGeometry = {
      screenX: pos.x * k,
      screenY: pos.y * k,
      innerWidth: size.width * k,
      innerHeight: size.height * k,
      screenWidth: monitor.size.width * k,
      screenHeight: monitor.size.height * k,
      availLeft: work.position.x * k,
      availTop: work.position.y * k,
      availWidth: work.size.width * k,
      availHeight: work.size.height * k,
      monitorLeft: monitor.position.x * k,
      monitorTop: monitor.position.y * k,
    };
    if (isPlausibleGeometry(g)) nativeGeometry = g;
  } catch {
    // Position APIs unavailable; the DOM reading is used instead
  }
}

let nativeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNativeRefresh(): void {
  rememberWindowPosition();
  if (!isTauri() || nativeRefreshTimer) return;
  nativeRefreshTimer = setTimeout(() => {
    nativeRefreshTimer = null;
    refreshNativeGeometry().catch(() => {});
  }, 120);
}

/** The window's last known real position: live if valid, else where it was before minimizing. */
function currentGeometry(): ScreenGeometry {
  const live = readDomGeometry();
  const size = { innerWidth: live.innerWidth, innerHeight: live.innerHeight };
  if (nativeGeometry) return { ...nativeGeometry, ...size };
  if (isPlausibleGeometry(live)) {
    domGeometry = live;
    return live;
  }
  return domGeometry ? { ...domGeometry, ...size } : live;
}

// ── Palette ───────────────────────────────────────────────────

let liquidPalette: LiquidPalette | null = null;

/** Tints the liquid with the playing track's artwork; null for the black symbiote. */
export function setLiquidPalette(palette: LiquidPalette | null): void {
  liquidPalette = palette;
}

// ── DOM plumbing ──────────────────────────────────────────────

function visibleRect(node: Element): Rect | null {
  const r = node.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function canAnimate(node: Element): node is HTMLElement {
  return typeof (node as HTMLElement).animate === "function";
}

function readAccent(): string {
  const shell = document.getElementById("app") ?? document.documentElement;
  return getComputedStyle(shell).getPropertyValue("--color-accent").trim() || "#a78bfa";
}

/** A curved path; bend is a fraction of its length, signed for the side it bows to. */
function curve(from: Point, to: Point, bend: number, maxBend = 260): Curve {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = clamp(bend * len, -maxBend, maxBend);
  return {
    sx: from.x,
    sy: from.y,
    cx: (from.x + to.x) / 2 + (-dy / len) * off,
    cy: (from.y + to.y) / 2 + (dx / len) * off,
    tx: to.x,
    ty: to.y,
  };
}

const randomBend = (lo: number, hi: number) => (Math.random() < 0.5 ? -1 : 1) * lerp(lo, hi, Math.random());

// ── Scene building ────────────────────────────────────────────

interface Scene {
  view: Bounds;
  tendrils: Tendril[];
  membranes: Membrane[];
  flyers: Flyer[];
  animations: Animation[];
  end: number;
}

function animate(scene: Scene, node: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
  if (!node || !canAnimate(node)) return;
  try {
    scene.animations.push(node.animate(keyframes, { fill: "backwards", ...options }));
  } catch {
    // Keyframes the engine cannot run (e.g. pseudo-elements) are skipped
  }
}

/**
 * Fraction of a curve's (eased) travel time spent before its head is inside the
 * window. A tendril from a far screen edge starts that much earlier, so it is
 * already on its way when it is due on screen.
 */
function hiddenFraction(path: Curve, view: Bounds, margin: number): number {
  for (let i = 0; i <= 100; i++) {
    const h = bezier(path, easeLunge(i / 100));
    if (h.x >= view.left - margin && h.x <= view.right + margin && h.y >= view.top - margin && h.y <= view.bottom + margin) {
      return i / 100;
    }
  }
  return 1;
}

/**
 * Shoots tendrils at a piece, timed so the first one comes into view at enterAt.
 * Returns when the first one lands and the direction it came in.
 */
function addTendrils(
  scene: Scene,
  rect: Rect,
  spawns: Point[],
  enterAt: number,
  minTravel: number,
  color: number,
  stagger = 35,
): { arrival: number; entry: Point } {
  const minDim = Math.min(rect.width, rect.height);
  const baseR = clamp(Math.sqrt(minDim) * 1.9, 13, 34);
  let arrival = Infinity;
  let entry: Point = { x: 0, y: -1 };
  spawns.forEach((spawn, i) => {
    const target = {
      x: rect.x + rect.width * (0.3 + Math.random() * 0.4),
      y: rect.y + rect.height * (0.3 + Math.random() * 0.4),
    };
    const path = curve(spawn, target, (Math.random() - 0.5) * 0.7);
    const len = pathLength(path) || 1;
    const travel = clamp(Math.max(minTravel * (0.9 + Math.random() * 0.2), len / TENDRIL_SPEED), minTravel, 1800);
    const hidden = Math.min(0.85, hiddenFraction(path, scene.view, baseR));
    const t0 = enterAt + i * stagger * (0.6 + Math.random() * 0.8) - hidden * travel;
    scene.tendrils.push({
      ...path,
      start: t0,
      travel,
      melt: t0 + travel + 60,
      meltDur: 360 + Math.random() * 120,
      baseR: baseR * (i === 0 ? 1 : 0.7 + Math.random() * 0.25),
      segments: clamp(Math.round(len / (baseR * 0.4)), 12, 200),
      phase: Math.random() * 6.28,
      wobble: 8 + Math.random() * 14,
      color: i === 0 ? color : (color + i) % 3,
    });
    if (t0 + travel < arrival) {
      arrival = t0 + travel;
      const d = Math.hypot(target.x - spawn.x, target.y - spawn.y) || 1;
      entry = { x: (target.x - spawn.x) / d, y: (target.y - spawn.y) / d };
    }
  });
  return { arrival, entry };
}

/** Liquid blooms out from the impact point to cover a piece, then melts away. */
function addFlood(scene: Scene, rect: Rect, arrival: number, entry: Point, color: number): void {
  const spacing = Math.max(44, Math.sqrt((rect.width * rect.height) / 30));
  const cols = Math.max(1, Math.round(rect.width / spacing));
  const rows = Math.max(1, Math.round(rect.height / spacing));
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const impactX = rect.x + rect.width / 2;
  const impactY = rect.y + rect.height / 2;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const toX = rect.x + cellW * (c + 0.5) + (Math.random() - 0.5) * cellW * 0.7;
      const toY = rect.y + cellH * (r + 0.5) + (Math.random() - 0.5) * cellH * 0.7;
      const dist = Math.hypot(toX - impactX, toY - impactY);
      // Melts as a wave travelling the way the tendril came in
      const along = (toX - impactX) * entry.x + (toY - impactY) * entry.y;
      scene.membranes.push({
        fromX: impactX,
        fromY: impactY,
        toX,
        toY,
        // A web rather than a slab: neighbors just touch, leaving holes that tear open
        r: Math.min(cellW, cellH) * (0.32 + Math.random() * 0.26) + Math.abs(cellW - cellH) * 0.2,
        start: arrival - 50 + dist * 0.22,
        grow: 190 + Math.random() * 80,
        melt: arrival + 160 + along * 0.28 + Math.random() * 90,
        meltDur: 200 + Math.random() * 140,
        // Shrinking drops slide off along the flow and drip down
        driftX: entry.x * 22 + (Math.random() - 0.5) * 16,
        driftY: entry.y * 22 + 26 + Math.random() * 34,
        phase: Math.random() * 6.28,
        color: Math.random() < 0.92 ? color : (color + 1) % 3,
      });
    }
  }
  scene.end = Math.max(scene.end, arrival + MELT_MS);
}

/** The piece rushes in along the tendril's direction with a small overshoot. */
function popPiece(scene: Scene, node: HTMLElement, rect: Rect, arrival: number, entry: Point): void {
  const distance = Math.min(80, 30 + Math.min(rect.width, rect.height) * 0.05);
  animate(
    scene,
    node,
    [
      { opacity: 0, transform: `translate(${-entry.x * distance}px, ${-entry.y * distance}px) scale(0.94)` },
      { opacity: 1, transform: `translate(${entry.x * 4}px, ${entry.y * 4}px) scale(1.006)`, offset: 0.6 },
      { opacity: 1, transform: "none" },
    ],
    { duration: 560, delay: arrival + 30, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" },
  );
  // In the floating layout the page sits on a stage (#app::before plus the
  // artwork behind it); it is part of the same piece and must not show early
  if (isFloating() && node.matches(".main")) revealBackdrop(scene, arrival + 30, entry, distance);
}

function isFloating(): boolean {
  return document.documentElement.dataset.window === "floating";
}

/**
 * The backdrop: the stage and artwork in the floating layout (moving with the
 * main panel), or the window-wide artwork glow in the full layout (fading in
 * with the music, as the disc lands).
 */
function revealBackdrop(scene: Scene, at: number, entry: Point | null, distance = 0): void {
  const app = document.getElementById("app");
  const art = document.querySelector(".ambient-art");
  const keyframes: Keyframe[] = entry
    ? [
        { opacity: 0, transform: `translate(${-entry.x * distance}px, ${-entry.y * distance}px) scale(0.94)` },
        { opacity: 1, transform: `translate(${entry.x * 4}px, ${entry.y * 4}px) scale(1.006)`, offset: 0.6 },
        { opacity: 1, transform: "none" },
      ]
    : [{ opacity: 0 }, { opacity: 1 }];
  const timing: KeyframeAnimationOptions = entry
    ? { duration: 560, delay: at, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" }
    : { duration: 520, delay: at, easing: "ease-out" };
  animate(scene, app, keyframes, { ...timing, pseudoElement: "::before" });
  animate(scene, art, keyframes, timing);
}

/** The player bar spreads out from its album art, liquid racing along it. */
function revealPlayer(scene: Scene, player: HTMLElement, playerRect: Rect, art: Point, artSize: Rect, at: number, color: number): void {
  const corners: Point[] = [
    { x: playerRect.x, y: playerRect.y },
    { x: playerRect.x + playerRect.width, y: playerRect.y },
    { x: playerRect.x, y: playerRect.y + playerRect.height },
    { x: playerRect.x + playerRect.width, y: playerRect.y + playerRect.height },
  ];
  const maxR = Math.max(...corners.map((c) => Math.hypot(c.x - art.x, c.y - art.y))) + 60;
  const cx = art.x - playerRect.x;
  const cy = art.y - playerRect.y;
  const artR = Math.hypot(artSize.width, artSize.height) / 2 + 2;
  animate(
    scene,
    player,
    [
      { clipPath: `circle(0px at ${cx}px ${cy}px)`, opacity: 1 },
      { clipPath: `circle(${artR}px at ${cx}px ${cy}px)`, opacity: 1, offset: 0.06 },
      { clipPath: `circle(${maxR}px at ${cx}px ${cy}px)`, opacity: 1 },
    ],
    { duration: 620, delay: at, easing: "cubic-bezier(0.55, 0, 0.25, 1)" },
  );

  const barY = playerRect.y + playerRect.height / 2;
  const r = playerRect.height * 0.5;
  const step = Math.max(28, r * 1.1);
  for (let x = playerRect.x + r * 0.6; x <= playerRect.x + playerRect.width - r * 0.6; x += step) {
    const start = at + 10 + Math.abs(x - art.x) * 0.42;
    scene.membranes.push({
      fromX: art.x,
      fromY: art.y,
      toX: x,
      toY: barY + (Math.random() - 0.5) * r * 0.3,
      r: r * (0.62 + Math.random() * 0.22),
      start,
      grow: 220 + Math.random() * 80,
      melt: start + 170 + Math.random() * 140,
      meltDur: 260 + Math.random() * 120,
      driftX: Math.sign(x - art.x) * 14,
      driftY: (Math.random() - 0.5) * 16,
      phase: Math.random() * 6.28,
      color: Math.random() < 0.7 ? color : (color + 2) % 3,
    });
  }

  // Track info, controls and volume slide out of the art one after another
  for (const selector of PLAYER_PART_SELECTORS) {
    const part = player.querySelector(selector);
    const rect = part ? visibleRect(part) : null;
    if (!part || !rect) continue;
    const dx = rect.x + rect.width / 2 - art.x;
    const dir = Math.sign(dx) || 1;
    animate(
      scene,
      part,
      [
        { opacity: 0, transform: `translateX(${-dir * Math.min(60, 18 + Math.abs(dx) * 0.08)}px) scale(0.92)` },
        { opacity: 1, transform: `translateX(${dir * 3}px) scale(1.01)`, offset: 0.65 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 460, delay: at + 90 + Math.abs(dx) * 0.38, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" },
    );
  }
  scene.end = Math.max(scene.end, at + 90 + playerRect.width * 0.4 + 520);
}

function collectPieces(): Array<{ node: HTMLElement; rect: Rect }> {
  const pieces: Array<{ node: HTMLElement; rect: Rect }> = [];
  for (const selector of PIECE_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      const rect = visibleRect(node);
      if (rect) pieces.push({ node, rect });
    });
  }
  return pieces;
}

function makeFlyer(kind: "disc" | "logo", base: number, source?: string | null): { el: HTMLElement; spinner: HTMLElement | null } {
  const el = document.createElement("div");
  el.className = `symbiote-flyer symbiote-flyer--${kind}`;
  el.setAttribute("aria-hidden", "true");
  el.style.width = `${base}px`;
  el.style.height = `${base}px`;
  el.style.opacity = "0";
  if (kind === "logo") {
    el.innerHTML = icon("sonoraLogo");
    return { el, spinner: null };
  }
  // A record: the artwork turns with its grooves and spindle hole, the sheen stays put
  const spinner = document.createElement("div");
  spinner.className = "symbiote-disc__spin";
  const img = document.createElement("img");
  img.src = source || "/sonora-logo.svg";
  img.alt = "";
  img.draggable = false;
  if (!source) el.classList.add("symbiote-flyer--placeholder");
  const grooves = document.createElement("div");
  grooves.className = "symbiote-disc__grooves";
  spinner.append(img, grooves);
  const sheen = document.createElement("div");
  sheen.className = "symbiote-disc__sheen";
  el.append(spinner, sheen);
  return { el, spinner };
}

/**
 * Restore: music first. The album art rises out of the taskbar as a spinning
 * disc and lands in the player bar; once it has, the panels form from the
 * screen edges.
 */
function buildRestore(scene: Scene, mode: RevealMode, g: ScreenGeometry): void {
  const { right: width, bottom: height } = scene.view;
  const screen = screenBoundsInWindow(g);
  const anchor = taskbarAnchor(g);

  // 1. The disc: connected animation out of the taskbar button
  const player = document.querySelector<HTMLElement>(".player");
  const playerRect = player ? visibleRect(player) : null;
  const artEl = document.querySelector<HTMLElement>(".player__artwork");
  const artRect = artEl ? visibleRect(artEl) : null;
  const landing: Rect = artRect ?? { x: width / 2 - 24, y: height - 72, width: 48, height: 48 };
  const land = { x: landing.x + landing.width / 2, y: landing.y + landing.height / 2 };
  const base = Math.max(landing.width, landing.height);
  const peak = clamp(base * 2.1, 84, 124);

  // On screen from the first frame: the part of the rise below the window has already happened
  const path = curve(anchor, land, randomBend(0.15, 0.35), 220);
  const hidden = Math.min(0.85, hiddenFraction(path, scene.view, peak / 2));
  const travel = clamp(DISC_RISE_MS / (1 - hidden), DISC_RISE_MS, 2200);
  const start = -hidden * travel;
  const landsAt = start + travel;

  const carrier: Tendril = {
    ...path,
    start,
    travel,
    melt: landsAt + 40,
    meltDur: 420,
    baseR: clamp(base * 0.7, 22, 40),
    segments: clamp(Math.round(pathLength(path) / 8), 14, 200),
    phase: Math.random() * 6.28,
    wobble: 10,
    color: 0,
    headHold: landsAt + 260,
  };
  scene.tendrils.push(carrier);

  const artRadius = artEl ? parseFloat(getComputedStyle(artEl).borderRadius) : NaN;
  const finalRadius = Number.isFinite(artRadius) ? Math.min(base / 2, artRadius) : base / 2;
  const disc = makeFlyer("disc", base, artEl?.querySelector("img")?.getAttribute("src"));
  scene.flyers.push({
    ...disc,
    base,
    legs: [{ path: carrier, size0: 30, peak, size1: base, radius0: base / 2, radius1: finalRadius, spin: -900 }],
    settle: [landsAt + 40, landsAt + 300],
    fadeStart: landsAt + 300,
    fadeDur: 140,
  });

  // 2. The player bar spreads out from where the disc lands
  if (player && playerRect) revealPlayer(scene, player, playerRect, land, landing, landsAt - 30, 0);
  if (!isFloating()) revealBackdrop(scene, landsAt - 60, null);

  // 3. Then the panels: tendrils from the screen edges, in the screen's frame of reference
  const pieces = collectPieces();
  const screenArea = { width: screen.right - screen.left, height: screen.bottom - screen.top };
  const plans = planReveal(
    pieces.map(({ rect }) => ({ ...rect, x: rect.x - screen.left, y: rect.y - screen.top })),
    screenArea,
    mode,
    Math.random,
    landsAt + 80,
  );

  plans.forEach((plan, order) => {
    const { node, rect } = pieces[plan.index];
    const perEdge = plan.from.length > 1 ? 1 : rect.width * rect.height > 120000 ? 3 : 2;
    const spawns: Point[] = [];
    for (const direction of plan.from) {
      for (let n = 0; n < perEdge; n++) {
        const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        spawns.push(edgeSpawn(direction, target, screen, 36));
      }
    }
    const color = (order % 3 + 1) % 3;
    const { arrival, entry } = addTendrils(scene, rect, spawns, plan.start, Math.min(plan.travel, 380), color);
    addFlood(scene, rect, arrival, entry, color);
    popPiece(scene, node, rect, arrival, entry);
  });

  scene.end = Math.max(scene.end, landsAt + 700);
}

/** Launch: logo from the taskbar pools in the middle, then bursts into the interface. */
function buildLaunch(scene: Scene, g: ScreenGeometry): void {
  const { right: width, bottom: height } = scene.view;
  const anchor = taskbarAnchor(g);
  const center = { x: width / 2, y: height * 0.47 };
  const logoSize = clamp(Math.min(width, height) * 0.15, 76, 132);

  // 1. Logo rides a tendril out of the taskbar, on screen from the first frame
  const path = curve(anchor, center, randomBend(0.2, 0.4), 260);
  const hidden = Math.min(0.85, hiddenFraction(path, scene.view, logoSize / 2));
  const travel = clamp(620 / (1 - hidden), 620, 2200);
  const start = -hidden * travel;
  const flight = start + travel;
  const burst = flight + 420;

  const carrier: Tendril = {
    ...path,
    start,
    travel,
    melt: flight + 20,
    meltDur: 520,
    baseR: logoSize * 0.42,
    segments: clamp(Math.round(pathLength(path) / 8), 16, 200),
    phase: Math.random() * 6.28,
    wobble: 14,
    color: 0,
    headHold: burst + 120,
  };
  scene.tendrils.push(carrier);

  // 2. It pools into a droplet; a crown of drops splashes off on impact
  const poolR = logoSize * 0.78;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const d = i === 0 ? 0 : poolR * 0.42;
    scene.membranes.push({
      fromX: center.x,
      fromY: center.y,
      toX: center.x + Math.cos(a) * d,
      toY: center.y + Math.sin(a) * d,
      r: poolR * (i === 0 ? 0.85 : 0.5 + Math.random() * 0.12),
      start: flight - 90 + i * 12,
      grow: 300,
      melt: burst + 80 + Math.random() * 220,
      meltDur: 340 + Math.random() * 160,
      driftX: Math.cos(a) * 26,
      driftY: Math.sin(a) * 26,
      phase: Math.random() * 6.28,
      color: i % 3,
    });
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const d = poolR * (1.25 + Math.random() * 0.55);
    scene.membranes.push({
      fromX: center.x + Math.cos(a) * poolR * 0.5,
      fromY: center.y + Math.sin(a) * poolR * 0.5,
      toX: center.x + Math.cos(a) * d,
      toY: center.y + Math.sin(a) * d,
      r: 5 + Math.random() * 8,
      start: flight - 10,
      grow: 240,
      melt: flight + 200 + Math.random() * 120,
      meltDur: 220,
      driftX: Math.cos(a) * 30,
      driftY: Math.sin(a) * 30 + 12,
      phase: Math.random() * 6.28,
      color: (i + 1) % 3,
    });
  }

  // 3. The pool bursts: tendrils shoot out to build every piece
  const pieces = shuffle(collectPieces(), Math.random);
  pieces.forEach(({ node, rect }, i) => {
    const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const away = Math.atan2(target.y - center.y, target.x - center.x);
    const spawnCount = rect.width * rect.height > 120000 ? 3 : 2;
    const spawns = Array.from({ length: spawnCount }, () => {
      const a = away + (Math.random() - 0.5) * 1.2;
      return { x: center.x + Math.cos(a) * poolR * 0.35, y: center.y + Math.sin(a) * poolR * 0.35 };
    });
    const color = (i % 3 + 1) % 3;
    const { arrival, entry } = addTendrils(scene, rect, spawns, burst + i * (30 + Math.random() * 40), 300, color, 25);
    addFlood(scene, rect, arrival, entry, color);
    popPiece(scene, node, rect, arrival, entry);
  });

  // 4. The player bar is struck from the pool at its album art
  const player = document.querySelector<HTMLElement>(".player");
  const playerRect = player ? visibleRect(player) : null;
  const artEl = document.querySelector<HTMLElement>(".player__artwork");
  const artRect = (artEl && visibleRect(artEl)) || null;
  if (player && playerRect) {
    const landing = artRect ?? { x: playerRect.x + 12, y: playerRect.y + playerRect.height / 2 - 24, width: 48, height: 48 };
    const { arrival } = addTendrils(scene, landing, [center], burst + 20, 300, 0);
    revealPlayer(scene, player, playerRect, { x: landing.x + landing.width / 2, y: landing.y + landing.height / 2 }, landing, arrival - 30, 0);
  }

  if (!isFloating()) revealBackdrop(scene, burst, null);

  // 5. The logo: in with the carrier, breathes in the pool, then flies to the sidebar brand
  const logo = makeFlyer("logo", logoSize);
  const legs: FlightLeg[] = [{ path: carrier, size0: 28, size1: logoSize, radius0: 0, radius1: 0, spin: -20 }];
  const slot = document.querySelector<HTMLElement>(".sidebar__brand-icon");
  const slotRect = slot ? visibleRect(slot) : null;
  let fadeStart = burst + 60;
  if (slot && slotRect) {
    const home = { x: slotRect.x + slotRect.width / 2, y: slotRect.y + slotRect.height / 2 };
    const legTravel = clamp(Math.hypot(home.x - center.x, home.y - center.y) / 2.2, 380, 640);
    const leg: Tendril = {
      ...curve(center, home, randomBend(0.12, 0.3)),
      start: burst + 60,
      travel: legTravel,
      melt: burst + 60 + legTravel,
      meltDur: 1,
      baseR: 0,
      segments: 0,
      phase: 0,
      wobble: 0,
      color: 0,
    };
    legs.push({ path: leg, size0: logoSize, size1: Math.max(slotRect.width, slotRect.height), radius0: 0, radius1: 0, spin: 0 });
    fadeStart = burst + 60 + legTravel + 40;
    animate(scene, slot, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: fadeStart - 40 });
  }
  scene.flyers.push({ ...logo, base: logoSize, legs, fadeStart, fadeDur: 160, breathe: [flight, burst + 60] });

  scene.end = Math.max(scene.end, fadeStart + 200);
}

// ── Runtime ───────────────────────────────────────────────────

interface ActiveRun {
  flyers: HTMLElement[];
  animations: Animation[];
  raf: number | null;
  timer: ReturnType<typeof setTimeout>;
  done: () => void;
  detach: () => void;
}

let active: ActiveRun | null = null;
let lastRestore = 0;
let lastMode: RevealMode | null = null;
let launched = false;
let primeTimer: ReturnType<typeof setTimeout> | null = null;
/** Set once the window is (about to be) minimized; the next return plays the restore. */
let awaitingRestore = false;

let renderer: GooRenderer | null = null;
let rendererUnavailable = false;

/** The shared liquid canvas, created once and kept hidden between animations. */
function liquidRenderer(): GooRenderer | null {
  if (renderer?.lost) {
    renderer.canvas.remove();
    renderer = null;
  }
  if (!renderer && !rendererUnavailable) {
    renderer = GooRenderer.create();
    if (!renderer) {
      rendererUnavailable = true;
      return null;
    }
    renderer.canvas.className = "symbiote-canvas";
    renderer.canvas.setAttribute("aria-hidden", "true");
    renderer.canvas.hidden = true;
  }
  if (renderer && !renderer.canvas.isConnected) document.body.appendChild(renderer.canvas);
  return renderer;
}

/** Compiles the liquid shaders while idle, so the first animation starts without a hitch. */
export function warmUpSymbiote(): void {
  const warm = () => {
    if (shouldReduceMotion()) return;
    const goo = liquidRenderer();
    goo?.resize(window.innerWidth || 1024, window.innerHeight || 768);
    goo?.render([]);
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (idle) idle(warm, { timeout: 2000 });
  else setTimeout(warm, 600);
}

export function isSymbioteAnimating(): boolean {
  return active !== null;
}

/** Hides the shell so the next frame shown is empty, ready for an entrance. */
export function primeShell(): void {
  document.documentElement.classList.add("symbiote-primed");
  if (primeTimer) clearTimeout(primeTimer);
}

function unprime(): void {
  document.documentElement.classList.remove("symbiote-primed");
  if (primeTimer) {
    clearTimeout(primeTimer);
    primeTimer = null;
  }
}

function play(kind: "restore" | "launch", mode: RevealMode): Promise<void> {
  stopSymbiote();
  const root = document.documentElement;
  root.classList.add("app--restoring");
  root.dataset.symbiote = kind;
  if (kind === "restore") root.dataset.symbioteMode = mode;

  const width = window.innerWidth || 1024;
  const height = window.innerHeight || 768;
  const scene: Scene = {
    view: { left: 0, top: 0, right: width, bottom: height },
    tendrils: [],
    membranes: [],
    flyers: [],
    animations: [],
    end: 0,
  };
  const geometry = currentGeometry();
  if (kind === "restore") buildRestore(scene, mode, geometry);
  else buildLaunch(scene, geometry);

  // Animations now hold everything hidden until its turn
  unprime();

  const end = Math.min(SEQUENCE_MAX_MS, scene.end);
  let resolveDone: () => void = () => {};
  const finished = new Promise<void>((resolve) => (resolveDone = resolve));

  // Any click or key skips straight to the finished interface
  const skip = () => stopSymbiote();
  window.addEventListener("pointerdown", skip, true);
  window.addEventListener("keydown", skip, true);

  const run: ActiveRun = {
    flyers: scene.flyers.map((f) => f.el),
    animations: scene.animations,
    raf: null,
    timer: setTimeout(stopSymbiote, end + 60),
    done: resolveDone,
    detach: () => {
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skip, true);
    },
  };
  active = run;
  scene.flyers.forEach((f) => document.body.appendChild(f.el));

  const goo = liquidRenderer();
  if (goo) {
    const colors = liquidColors(liquidPalette, readAccent());
    goo.setColors(colors.fills, colors.sheen, colors.rim);
    goo.resize(width, height);
    goo.canvas.hidden = false;
  }

  if (typeof requestAnimationFrame !== "function") return finished;

  const t0 = performance.now();
  const blobs: Blob[] = [];
  const frame = (stamp: number): void => {
    if (active !== run) return;
    const t = stamp - t0;
    if (t > end) {
      stopSymbiote();
      return;
    }
    for (const flyer of scene.flyers) placeFlyer(flyer, t);
    if (goo) {
      blobs.length = 0;
      for (const m of scene.membranes) pushMembrane(blobs, m, t);
      for (const tendril of scene.tendrils) pushTendril(blobs, tendril, t, scene.view);
      goo.render(blobs);
    }
    run.raf = requestAnimationFrame(frame);
  };
  // Place everything for the first frame right away, then follow the display
  frame(t0);
  return finished;
}

/** Cancels a running sequence and puts every element back to its normal state. */
export function stopSymbiote(): void {
  const run = active;
  active = null;
  if (run) {
    if (run.raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(run.raf);
    clearTimeout(run.timer);
    run.detach();
    run.flyers.forEach((el) => el.remove());
    for (const animation of run.animations) {
      try {
        animation.cancel();
      } catch {
        // Already finished
      }
    }
  }
  if (renderer) {
    renderer.clear();
    renderer.canvas.hidden = true;
  }
  const root = document.documentElement;
  root.classList.remove("app--restoring");
  delete root.dataset.symbiote;
  delete root.dataset.symbioteMode;
  run?.done();
  // The window may have moved since; refresh for the next restore
  scheduleNativeRefresh();
}

export interface RestoreOptions {
  /** Play even when motion is reduced and ignore the debounce (previews). */
  force?: boolean;
  /** Use a specific mode instead of a random one. */
  mode?: RevealMode;
}

/**
 * Plays the restore. Returns false when skipped (reduced motion, or a
 * duplicate trigger for the same restore).
 */
export function triggerRestoreAnimation(options: RestoreOptions = {}): boolean {
  if (shouldReduceMotion() && !options.force) {
    unprime();
    return false;
  }
  const now = Date.now();
  if (!options.force && (active || now - lastRestore < 900)) {
    unprime();
    return false;
  }
  lastRestore = now;
  const mode = options.mode ?? pickMode(lastMode);
  lastMode = mode;
  void play("restore", mode);
  return true;
}

/**
 * Fades the shell out before the window minimizes, so the frame Windows keeps
 * (and shows first when the window is restored) is empty rather than the old
 * interface. Resolves once that frame has been painted.
 */
export function prepareMinimize(): Promise<void> {
  if (active) stopSymbiote();
  awaitingRestore = true;
  if (shouldReduceMotion()) return Promise.resolve();
  primeShell();
  return new Promise((resolve) => {
    setTimeout(() => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else resolve();
    }, MINIMIZE_FADE_MS);
  });
}

/**
 * Hides the shell before the window is first shown, so the launch starts from
 * an empty window. Returns whether a launch animation will play. If nothing
 * plays it within a few seconds, the shell is shown anyway.
 */
export function primeLaunch(): boolean {
  if (launched || shouldReduceMotion()) return false;
  primeShell();
  primeTimer = setTimeout(unprime, PRIME_TIMEOUT_MS);
  return true;
}

/** Plays the launch sequence (once per process unless forced). Resolves when it ends. */
export function playLaunchAnimation(options: { force?: boolean } = {}): Promise<void> {
  if (!options.force && (launched || shouldReduceMotion())) {
    unprime();
    return Promise.resolve();
  }
  launched = true;
  // Starting while the first page is still loading would stutter; give it a moment
  return settle().then(() => play("launch", "natural"));
}

/** Resolves once fonts are in and two frames have gone by (at most ~400 ms). */
function settle(): Promise<void> {
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
  const capped = Promise.race([fonts, new Promise((r) => setTimeout(r, 350))]);
  return capped.then(
    () =>
      new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame !== "function") return resolve();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Resets internal state (tests). */
export function resetSymbioteState(): void {
  stopSymbiote();
  unprime();
  lastRestore = 0;
  lastMode = null;
  launched = false;
  awaitingRestore = false;
  nativeGeometry = null;
  domGeometry = null;
}

/**
 * Plays the restore whenever the window comes back from being minimized
 * (taskbar click, Win+Tab, etc). Plain focus changes such as Alt+Tab between
 * open windows do not replay it. Also keeps track of where the window is, so
 * the animation starts from wherever it was last dragged.
 */
export function initRestoreAnimation(): void {
  const onHidden = () => {
    if (active) stopSymbiote();
    awaitingRestore = true;
    if (!shouldReduceMotion()) primeShell();
  };
  const onBack = () => {
    if (!awaitingRestore) return;
    awaitingRestore = false;
    triggerRestoreAnimation();
  };

  rememberWindowPosition();
  scheduleNativeRefresh();
  warmUpSymbiote();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHidden();
    else onBack();
  });
  window.addEventListener("focus", onBack);
  window.addEventListener("blur", scheduleNativeRefresh);
  window.addEventListener("resize", scheduleNativeRefresh);

  if (!isTauri()) return;
  try {
    const appWindow = getCurrentWindow();
    appWindow.onMoved(scheduleNativeRefresh).catch(() => {});
    appWindow.onResized(scheduleNativeRefresh).catch(() => {});
    // The native side holds a taskbar minimize until the shell has faded out
    appWindow
      .listen("sonora://will-minimize", async () => {
        await prepareMinimize();
        await appWindow.minimize().catch(() => {});
      })
      .catch(() => {});
    // Emitted by the window subclass and the sampler in window_mode.rs
    appWindow.listen("sonora://minimize", onHidden).catch(() => {});
    appWindow.listen("sonora://restore", onBack).catch(() => {});
    appWindow
      .listen<boolean>("sonora://focus", ({ payload: focused }) => {
        if (focused) onBack();
        else scheduleNativeRefresh();
      })
      .catch(() => {});
  } catch {
    // Window events unavailable outside the desktop shell
  }
}
