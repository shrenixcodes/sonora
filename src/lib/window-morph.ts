/**
 * Maximize ⇄ restore morph.
 *
 * The OS window never changes size (src/lib/window-mode.ts): maximize and
 * restore switch between two layouts drawn in the same viewport. In the frame
 * the layout switches, every panel is sent back, with a transform, to the box
 * it had in the old layout, and then travels as an exact box to its new one,
 * in step with the stage and the window background. Its contents are
 * counter-scaled frame by frame, so text and icons keep their real size the
 * whole way: the moving outline reveals them rather than squashing them.
 *
 * Only `transform` and `opacity` animate, which the compositor runs on its
 * own thread. All transforms use a top-left origin (window-morph.css).
 */

export type MorphPartId =
  | "main"
  | "queue"
  | "sidebar"
  | "player"
  | "titlebar-left"
  | "titlebar-search"
  | "titlebar-right";

export const MORPH_PARTS: ReadonlyArray<readonly [MorphPartId, string]> = [
  ["main", ".main"],
  ["queue", ".queue-panel"],
  ["sidebar", ".sidebar"],
  ["player", ".player"],
  ["titlebar-left", ".titlebar__left"],
  ["titlebar-search", ".titlebar__search"],
  ["titlebar-right", ".titlebar__right"],
];

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where every panel sits in one layout, in viewport CSS pixels. */
export interface LayoutSnapshot {
  mode: "floating" | "full";
  /** Where this layout's viewport sat on screen; both layouts share one now, so (0, 0). */
  screen: Point;
  /** The #app box, which is the whole window in both layouts. */
  app: Box;
  /** The stage surface: the central panel when floating, the window when full. */
  stage: Box;
  queueOpen: boolean;
  parts: Partial<Record<MorphPartId, Box>>;
}

export const MORPH_MS = 300;
/** A shorter motion for software compositing, where every frame costs CPU. */
export const MORPH_LITE_MS = 220;
/** How long the artwork glow takes to come back after the panels land. */
export const AMBIENT_RETURN_MS = 170;
/** The motion curve: quick departure, long soft landing. */
export const MORPH_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const EASE: readonly [number, number, number, number] = [0.2, 0, 0, 1];
/** Keyframes sampled per move. Linear between samples, eased across them. */
const STEPS = 24;

let timeScale = 1;
/** Slows every morph down (Settings → Window Animation → slow motion). */
export function setMorphTimeScale(scale: number): void {
  timeScale = scale > 0 ? scale : 1;
}
const ms = (value: number) => value * timeScale;

/** Panels small enough to slide cheaply even when the CPU composites. */
const LITE_SLIDERS: ReadonlySet<MorphPartId> = new Set(["sidebar", "player", "titlebar-left", "titlebar-search", "titlebar-right"]);

function boxOf(node: Element): Box | null {
  const r = node.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function measureLayout(mode: "floating" | "full", root: ParentNode = document): LayoutSnapshot {
  const parts: Partial<Record<MorphPartId, Box>> = {};
  for (const [id, selector] of MORPH_PARTS) {
    const node = root.querySelector(selector);
    const box = node ? boxOf(node) : null;
    if (box) parts[id] = box;
  }
  const appNode = root.querySelector("#app");
  const app = (appNode && boxOf(appNode)) || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  return {
    mode,
    screen: { x: 0, y: 0 },
    app,
    stage: mode === "floating" && parts.main ? parts.main : app,
    queueOpen: !!appNode?.classList.contains("app--queue-open"),
    parts,
  };
}

/** Moves a box measured in `from`'s viewport into `to`'s viewport coordinates. */
export function rebase(box: Box, from: LayoutSnapshot, to: LayoutSnapshot): Box {
  return { ...box, x: box.x + from.screen.x - to.screen.x, y: box.y + from.screen.y - to.screen.y };
}

/** The transform (top-left origin) that draws a box laid out at `to` exactly over `from`. */
export function stretchFlip(from: Box, to: Box): string {
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return `translate(${round(dx)}px, ${round(dy)}px) scale(${round(sx, 4)}, ${round(sy, 4)})`;
}

/** Moves a box laid out at `to` so its center sits on `from`'s, without scaling. */
export function slideFlip(from: Box, to: Box): string {
  const dx = from.x + from.width / 2 - (to.x + to.width / 2);
  const dy = from.y + from.height / 2 - (to.y + to.height / 2);
  return `translate(${round(dx)}px, ${round(dy)}px)`;
}

function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Solves a CSS cubic-bezier timing curve at time `t` (0..1). */
export function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number], t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u ** 2 * (1 - u) + u ** 3;
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    if (bx(u) < t) lo = u;
    else hi = u;
  }
  return by(u);
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const lerpBox = (a: Box, b: Box, p: number): Box => ({
  x: lerp(a.x, b.x, p),
  y: lerp(a.y, b.y, p),
  width: lerp(a.width, b.width, p),
  height: lerp(a.height, b.height, p),
});

/**
 * Keyframes that carry an element laid out at `layout` from box `start` to
 * box `end` along the eased curve, plus the matching counter-scale for its
 * children so their contents keep their size.
 */
export function boxTrack(layout: Box, start: Box, end: Box): { outer: Keyframe[]; inner: Keyframe[] } {
  const outer: Keyframe[] = [];
  const inner: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const offset = i / STEPS;
    const box = lerpBox(start, end, cubicBezier(EASE, offset));
    const sx = box.width / layout.width;
    const sy = box.height / layout.height;
    outer.push({ offset, transform: stretchFlip(box, layout) });
    inner.push({ offset, transform: `scale(${round(1 / sx, 4)}, ${round(1 / sy, 4)})` });
  }
  return { outer, inner };
}

function play(node: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof (node as HTMLElement).animate !== "function") return null;
  try {
    return (node as HTMLElement).animate(keyframes, options);
  } catch {
    return null;
  }
}

export interface RunningMorph {
  finished: Promise<void>;
  /** Removes every animation and the backdrop at once. */
  stop(): void;
}

class Morph implements RunningMorph {
  readonly animations: Animation[] = [];
  private backdrop: HTMLElement | null = null;
  private stopped = false;
  finished: Promise<void> = Promise.resolve();

  add(animation: Animation | null): void {
    if (animation) this.animations.push(animation);
  }

  /** Moves a panel's outline along `track`; its children ride the counter-scale. */
  moveBox(node: Element, track: { outer: Keyframe[]; inner: Keyframe[] }, options: KeyframeAnimationOptions): void {
    this.add(play(node, track.outer, options));
    for (const child of Array.from(node.children)) this.add(play(child, track.inner, options));
  }

  fadeContents(node: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
    for (const child of Array.from(node.children)) this.add(play(child, keyframes, options));
  }

  /** The maximized window's opaque background as one layer behind #app. */
  makeBackdrop(box: Box, root: ParentNode): HTMLElement {
    const backdrop = document.createElement("div");
    backdrop.className = "window-morph-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    Object.assign(backdrop.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    const app = root.querySelector("#app");
    if (app?.parentNode) app.parentNode.insertBefore(backdrop, app);
    this.backdrop = backdrop;
    return backdrop;
  }

  seal(removeBackdropWhenDone: boolean): this {
    this.finished = Promise.all(this.animations.map((a) => a.finished.catch(() => undefined))).then(() => {
      if (removeBackdropWhenDone) this.backdrop?.remove();
    });
    return this;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const animation of this.animations) {
      try {
        animation.cancel();
      } catch {
        // Already done
      }
    }
    this.backdrop?.remove();
  }
}

/** Hides the 36px-blurred artwork glow while panels move; blurs are the costliest thing to move. */
function holdAmbient(morph: Morph, root: ParentNode, duration: number): void {
  const ambient = root.querySelector(".ambient-art");
  if (!ambient) return;
  const total = duration + ms(AMBIENT_RETURN_MS);
  morph.add(play(ambient, [{ opacity: 0 }, { opacity: 0, offset: duration / total }, { opacity: 1 }], { duration: total, easing: "linear" }));
}

/** Contents settle in over the first part of the move. */
const CONTENT_IN: Keyframe[] = [{ opacity: 0.35 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }];
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/** Opacity samples added to a box track (both keyed at the same offsets). */
function withOpacity(frames: Keyframe[], opacityAt: (offset: number) => number): Keyframe[] {
  return frames.map((frame) => ({ ...frame, opacity: opacityAt(frame.offset as number) }));
}

/**
 * Animates the shell from `prev` (the layout before the window changed) to
 * `next` (the layout now applied). Call it in the same frame the new layout
 * is applied, before anything is painted.
 */
export function playMorph(
  prev: LayoutSnapshot,
  next: LayoutSnapshot,
  root: ParentNode = document,
  options: { lite?: boolean } = {},
): RunningMorph {
  const lite = !!options.lite;
  const morph = new Morph();
  const duration = ms(lite ? MORPH_LITE_MS : MORPH_MS);
  const sampled: KeyframeAnimationOptions = { duration, easing: "linear" };
  const eased: KeyframeAnimationOptions = { duration, easing: MORPH_EASING };

  for (const [id, selector] of MORPH_PARTS) {
    const node = root.querySelector(selector);
    const to = next.parts[id];
    if (!node || !to) continue;
    const before = prev.parts[id];
    if (!before || (lite && !LITE_SLIDERS.has(id))) {
      // New panels, and in lite mode the large ones, fade in where they land.
      morph.add(play(node, FADE_IN, eased));
      continue;
    }
    const from = rebase(before, prev, next);
    if (lite) {
      morph.add(play(node, [{ transform: slideFlip(from, to) }, { transform: "none" }], eased));
    } else {
      morph.moveBox(node, boxTrack(to, from, to), sampled);
      morph.fadeContents(node, CONTENT_IN, sampled);
    }
  }

  holdAmbient(morph, root, duration);

  const app = root.querySelector("#app");
  const prevStage = rebase(prev.stage, prev, next);
  if (app) {
    const keyframes = lite ? FADE_IN : boxTrack(next.stage, prevStage, next.stage).outer;
    morph.add(play(app, keyframes, { ...(lite ? eased : sampled), pseudoElement: "::before" }));
  }

  // The window background grows out of the floating stage, or shrinks into it,
  // on the same track as the stage.
  const toFull = next.mode === "full";
  const fullBox = toFull ? next.app : rebase(prev.app, prev, next);
  const stageBox = toFull ? prevStage : next.stage;
  const backdrop = morph.makeBackdrop(fullBox, root);
  if (lite) {
    morph.add(play(backdrop, toFull ? FADE_IN : [{ opacity: 1 }, { opacity: 0 }], { ...eased, fill: "forwards" }));
  } else {
    const track = toFull ? boxTrack(fullBox, stageBox, fullBox).outer : boxTrack(fullBox, fullBox, stageBox).outer;
    const opacity = toFull ? (o: number) => Math.min(1, o / 0.3) : (o: number) => Math.min(1, (1 - o) / 0.3);
    morph.add(play(backdrop, withOpacity(track, opacity), { ...sampled, fill: "forwards" }));
  }

  return morph.seal(true);
}

/* ── Live morph (the default) ────────────────────────────────────────────────
 * The real interface travels. The new layout is applied at once, and every
 * panel rides an outline that travels from the panel's old box to its new
 * one: songs, tiles and controls stay on screen the whole way, at their real
 * size, revealed by the moving outline.
 *
 * Nothing that holds images is scaled. Scaling a panel with album art makes
 * the GPU re-decode every image at each new scale (measured at ~300 ms of
 * decoding and ~170 ms of uploads in a single maximize). So the panels are
 * only shifted (transform: translate) and cut to their outline (clip-path),
 * which leave their pictures as they were drawn. Their own backgrounds are
 * switched off meanwhile: each outline's fill is a flat stand-in behind them,
 * holding no images, which is cheap to scale and turns from the panel's old
 * look into its new one on the way.
 */

/** How a panel's surface looks: what a stand-in copies so the swap is seamless. */
export interface Surface {
  image: string;
  color: string;
  radius: string;
  border: string;
  shadow: string;
}

/** On <html> while a live morph plays: panels give up their own fill to the stand-ins (window-morph.css). */
export const LIVE_CLASS = "is-window-morphing--live";

function surfaceOf(node: Element, pseudo?: string): Surface {
  const cs = getComputedStyle(node, pseudo);
  return {
    image: cs.backgroundImage,
    color: cs.backgroundColor,
    radius: cs.borderRadius,
    border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    shadow: cs.boxShadow,
  };
}

/**
 * Each panel's surface in a layout. In the floating layout the page itself is
 * transparent and sits on the stage (#app::before), so the stage stands in for it.
 */
export function surfacesOf(snapshot: LayoutSnapshot, root: ParentNode = document): Partial<Record<MorphPartId, Surface>> {
  const out: Partial<Record<MorphPartId, Surface>> = {};
  const app = root.querySelector("#app");
  for (const [id, selector] of MORPH_PARTS) {
    if (!snapshot.parts[id]) continue;
    const node = root.querySelector(selector);
    if (!node) continue;
    out[id] = id === "main" && snapshot.mode === "floating" && app ? surfaceOf(app, "::before") : surfaceOf(node);
  }
  return out;
}

/** A corner radius per corner, in CSS pixels: top-left, top-right, bottom-right, bottom-left. */
export type Corners = [number, number, number, number];

/**
 * Reads a computed `border-radius` into its four corners. Percentages are
 * taken against the shorter side of `box`; elliptical radii keep their
 * horizontal part.
 */
export function parseRadius(value: string | undefined, box: Box): Corners {
  const short = Math.min(box.width, box.height);
  const parts = (value ?? "")
    .split("/")[0]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.endsWith("%") ? (parseFloat(token) / 100) * short : parseFloat(token)))
    .filter(Number.isFinite);
  const [a = 0, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

/** Radii a box can actually show: none larger than half its shorter side (a capsule). */
function fitCorners(radius: Corners, box: { width: number; height: number }): Corners {
  const max = Math.min(box.width, box.height) / 2;
  return radius.map((r) => Math.max(0, Math.min(r, max))) as Corners;
}

/**
 * A `border-radius` that shows `radius` on screen while its element is drawn
 * scaled by (sx, sy): the scale would stretch the corners into ovals, so each
 * one is divided by it.
 */
export function cornersAt(radius: Corners, sx: number, sy: number): string {
  const across = radius.map((v) => `${round(v / sx)}px`).join(" ");
  const down = radius.map((v) => `${round(v / sy)}px`).join(" ");
  return `${across} / ${down}`;
}

const px = (values: readonly number[]) => values.map((v) => `${round(v)}px`).join(" ");

/**
 * Where each panel holds on to its outline: [x, y], 0 the start edge, 0.5 the
 * middle, 1 the end edge. Pages and lists keep their top-left corner (their
 * content starts there); the player and search keep their middle, where their
 * controls are; the window buttons keep the right edge.
 */
const ANCHORS: Record<MorphPartId, readonly [number, number]> = {
  main: [0, 0],
  queue: [0, 0],
  sidebar: [0, 0],
  player: [0.5, 0.5],
  "titlebar-left": [0, 0.5],
  "titlebar-search": [0.5, 0.5],
  "titlebar-right": [1, 0.5],
};

/**
 * How a panel laid out at `box` rides an outline at `outline`: the shift that
 * puts the panel's anchor on the outline's, and the clip, in the panel's own
 * coordinates (top, right, bottom, left), that cuts it down to the outline
 * where it is bigger. Both change linearly with the outline, so two keyframes
 * on the outline's easing follow it exactly.
 */
export function rideOutline(
  box: Box,
  outline: Box,
  anchor: readonly [number, number],
): { dx: number; dy: number; inset: [number, number, number, number] } {
  const [ax, ay] = anchor;
  const extraW = Math.max(0, box.width - outline.width);
  const extraH = Math.max(0, box.height - outline.height);
  return {
    dx: outline.x + ax * outline.width - (box.x + ax * box.width),
    dy: outline.y + ay * outline.height - (box.y + ay * box.height),
    inset: [ay * extraH, (1 - ax) * extraW, (1 - ay) * extraH, ax * extraW],
  };
}

/**
 * The old look fades out while the new one fades in, both inside the
 * travelling outline. Each keeps fixed corners, right for when it is the one
 * on show (the old at the start, the new at the landing), so the corners
 * change through the crossfade: nothing is repainted while the panels move.
 */
const SKIN_OUT: Keyframe[] = [
  { opacity: 1 },
  { opacity: 1, offset: 0.2, easing: "ease-in-out" },
  { opacity: 0, offset: 0.75 },
  { opacity: 0 },
];
const SKIN_IN: Keyframe[] = [{ opacity: 0, easing: "ease-in-out" }, { opacity: 1, offset: 0.6 }, { opacity: 1 }];

function placeBox(node: HTMLElement, box: Box): void {
  Object.assign(node.style, {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

/** A layer painted with a panel's look. */
function makeSkin(surface: Surface | undefined, radius = surface?.radius): HTMLDivElement {
  const skin = document.createElement("div");
  skin.className = "window-morph-skin";
  if (surface) {
    Object.assign(skin.style, {
      backgroundImage: surface.image,
      backgroundColor: surface.color,
      borderRadius: radius ?? "",
      border: surface.border,
      boxShadow: surface.shadow,
    });
  }
  return skin;
}

/** Each panel's look in the old and the new layout, read before and after the switch. */
export interface MorphLooks {
  before: Partial<Record<MorphPartId, Surface>>;
  after: Partial<Record<MorphPartId, Surface>>;
}

/**
 * Plays the live morph. Create it in the same task that applies the new
 * layout (`after`), so the old layout's last frame stays on screen until the
 * morph's first one. `looks` must be read before LIVE_CLASS goes on, which
 * this constructor does.
 */
export class SurfaceMorph implements RunningMorph {
  readonly finished: Promise<void>;
  private resolveFinished: () => void = () => {};
  /** Everything that lasts until the landing. */
  private readonly animations: Animation[] = [];
  /** What lasts until the end: the window background and the artwork glow coming back. */
  private readonly held: Animation[] = [];
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly layer: HTMLDivElement;
  private readonly backdrop: HTMLDivElement;
  private readonly ghosts: HTMLDivElement[] = [];
  private landed = false;
  private stopped = false;

  constructor(
    before: LayoutSnapshot,
    after: LayoutSnapshot,
    looks: MorphLooks,
    root: ParentNode = document,
  ) {
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));
    const app = root.querySelector<HTMLElement>("#app");

    // Under #app (inserted just before it): the window background and the
    // panels' fills, with the real panels riding on top of them.
    this.layer = document.createElement("div");
    this.layer.className = "window-morph-layer";
    this.layer.setAttribute("aria-hidden", "true");
    this.backdrop = document.createElement("div");
    this.backdrop.className = "window-morph-surface window-morph-surface--backdrop";
    this.layer.appendChild(this.backdrop);
    if (app?.parentNode) app.parentNode.insertBefore(this.layer, app);
    else document.body.appendChild(this.layer);
    document.documentElement.classList.add(LIVE_CLASS);

    const duration = ms(MORPH_MS);
    const timing: KeyframeAnimationOptions = { duration, easing: MORPH_EASING, fill: "forwards" };
    const crossfade: KeyframeAnimationOptions = { duration, easing: "linear", fill: "forwards" };

    // The window background grows out of the old stage, or shrinks into the new one.
    const toFull = after.mode === "full";
    const fullBox = toFull ? after.app : before.app;
    const stageBox = toFull ? before.stage : after.stage;
    placeBox(this.backdrop, fullBox);
    const collapsed = stretchFlip(stageBox, fullBox);
    this.hold(
      play(
        this.backdrop,
        toFull
          ? [{ transform: collapsed, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: "none", opacity: 1 }]
          : [{ transform: "none", opacity: 1 }, { opacity: 1, offset: 0.7 }, { transform: collapsed, opacity: 0 }],
        timing,
      ),
    );

    for (const [id, selector] of MORPH_PARTS) {
      const from = before.parts[id];
      const to = after.parts[id];
      const node = root.querySelector<HTMLElement>(selector);
      const oldLook = looks.before[id];
      const newLook = looks.after[id];

      if (from && !to) {
        // Gone from the new layout: its fill fades where it was.
        const ghost = this.makeGhost(id, from);
        ghost.appendChild(makeSkin(oldLook));
        this.add(play(ghost, [{ opacity: 1 }, { opacity: 0 }], { ...timing, duration: duration * 0.5 }));
        continue;
      }
      if (!to) continue;
      if (!from) {
        // New in this layout: it fades in where it lands.
        const ghost = this.makeGhost(id, to);
        ghost.appendChild(makeSkin(newLook));
        this.add(play(ghost, [{ opacity: 0 }, { opacity: 1 }], timing));
        if (node) this.add(play(node, [{ opacity: 0 }, { opacity: 1 }], timing));
        continue;
      }

      // The fill: laid out at the new box, stretched back over the old one,
      // travelling with the old look turning into the new.
      const ghost = this.makeGhost(id, to);
      const oldSkin = makeSkin(oldLook, cornersAt(fitCorners(parseRadius(oldLook?.radius, from), from), from.width / to.width, from.height / to.height));
      ghost.appendChild(oldSkin);
      this.add(play(ghost, [{ transform: stretchFlip(from, to) }, { transform: "none" }], timing));
      if (newLook) {
        const newSkin = makeSkin(newLook, px(fitCorners(parseRadius(newLook.radius, to), to)));
        ghost.appendChild(newSkin);
        this.add(play(oldSkin, SKIN_OUT, crossfade));
        this.add(play(newSkin, SKIN_IN, crossfade));
      }

      // The panel itself, in the new layout at its real size, rides the fill.
      if (!node) continue;
      const start = rideOutline(to, from, ANCHORS[id]);
      this.add(play(node, [{ transform: `translate(${round(start.dx)}px, ${round(start.dy)}px)` }, { transform: "none" }], timing));
      if (start.inset.some((v) => v > 0.5)) {
        // Bigger than its outline (growing): cut down to it, with its corners.
        const [top, right, bottom, left] = start.inset;
        const shown = { width: to.width - left - right, height: to.height - top - bottom };
        const r0 = fitCorners(parseRadius(oldLook?.radius, from), shown);
        const r1 = fitCorners(parseRadius(newLook?.radius ?? oldLook?.radius, to), to);
        // Its own animation: a clip must not hold the move back from the compositor.
        this.add(
          play(
            node,
            [{ clipPath: `inset(${px(start.inset)} round ${px(r0)})` }, { clipPath: `inset(0px 0px 0px 0px round ${px(r1)})` }],
            timing,
          ),
        );
      }
    }

    // The 36px-blurred artwork glow stays hidden while panels move (blurs are
    // the costliest thing to move) and comes back once they land.
    const glow = root.querySelector(".ambient-art");
    const total = duration + ms(AMBIENT_RETURN_MS);
    if (glow) {
      this.hold(play(glow, [{ opacity: 0 }, { opacity: 0, offset: duration / total }, { opacity: 1 }], {
        duration: total,
        easing: "linear",
      }));
    }

    this.later(() => this.land(), duration);
    this.later(() => this.stop(), total);
  }

  private makeGhost(id: MorphPartId, box: Box): HTMLDivElement {
    const ghost = document.createElement("div");
    ghost.className = `window-morph-surface window-morph-surface--${id}`;
    placeBox(ghost, box);
    this.layer.appendChild(ghost);
    this.ghosts.push(ghost);
    return ghost;
  }

  private add(animation: Animation | null): Animation | null {
    if (animation) this.animations.push(animation);
    return animation;
  }

  private hold(animation: Animation | null): void {
    if (animation) this.held.push(animation);
  }

  private later(fn: () => void, delay: number): void {
    this.timers.push(setTimeout(fn, delay));
  }

  /**
   * The landing: the panels take their own fills back from the stand-ins,
   * which look the same by now, in one frame. The window background stays
   * until the morph ends, as #app's own is off until then.
   */
  private land(): void {
    if (this.landed) return;
    this.landed = true;
    for (const animation of this.animations) {
      try {
        animation.cancel();
      } catch {
        // Already done
      }
    }
    for (const ghost of this.ghosts) ghost.remove();
    document.documentElement.classList.remove(LIVE_CLASS);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.land();
    for (const animation of this.held) {
      try {
        animation.cancel();
      } catch {
        // Already done
      }
    }
    this.layer.remove();
    this.resolveFinished();
  }
}
