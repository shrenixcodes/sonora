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

/* ── Surface morph (the default) ─────────────────────────────────────────────
 * Scaling a panel that holds album art makes the GPU re-decode every image at
 * each new scale: measured at ~300 ms of image decoding per worker thread and
 * ~170 ms of uploads during a single maximize, which is where the dropped
 * frames came from. So only flat surfaces travel: rounded rectangles that take
 * each panel's look (background, border, radius), plus the window background.
 * They hold no images and cost almost nothing to scale. The real interface
 * fades out in place, the surfaces travel from the old layout's boxes to the
 * new layout's, and the new layout, drawn once at its real size, fades in
 * over them as they land.
 */

/** How a panel's surface looks: what a stand-in copies so the swap is seamless. */
export interface Surface {
  image: string;
  color: string;
  radius: string;
  border: string;
  shadow: string;
}

/** Old content fading out before the surfaces travel. */
export const SURFACE_FADE_OUT_MS = 80;
/** New content fading in over the landing surfaces. */
export const SURFACE_REVEAL_MS = 170;
/** Fraction of the travel after which the reveal starts: the surfaces are within a few pixels of landing. */
const REVEAL_AT = 0.8;

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

function placeBox(node: HTMLElement, box: Box): void {
  Object.assign(node.style, {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

function paintSurface(node: HTMLElement, surface: Surface | undefined): void {
  if (!surface) return;
  Object.assign(node.style, {
    backgroundImage: surface.image,
    backgroundColor: surface.color,
    borderRadius: surface.radius,
    border: surface.border,
    boxShadow: surface.shadow,
  });
}

/**
 * Plays the surface morph in two steps:
 *  1. `new SurfaceMorph(before, after, targets)`: stand-ins appear over the
 *     panels of the current layout while the real interface fades out
 *     (`ready` resolves). `after` and `targets` describe the new layout,
 *     measured beforehand (window-mode.ts lays it out once and switches back).
 *  2. `travel()`: the stand-ins travel to the new boxes and the new interface
 *     fades in over them. The caller switches the real layout a frame after
 *     this, so the travel is already running on the compositor before the
 *     main thread starts painting the new layout.
 */
export class SurfaceMorph implements RunningMorph {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  private resolveFinished: () => void = () => {};
  private readonly animations: Animation[] = [];
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly back: HTMLDivElement;
  private readonly front: HTMLDivElement;
  private readonly backdrop: HTMLDivElement;
  private readonly ghosts = new Map<MorphPartId, HTMLDivElement>();
  private readonly app: HTMLElement | null;
  private appFade: Animation | null = null;
  private stopped = false;

  constructor(
    private readonly before: LayoutSnapshot,
    private readonly after: LayoutSnapshot,
    private readonly targets: Partial<Record<MorphPartId, Surface>>,
    root: ParentNode = document,
  ) {
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));
    this.app = root.querySelector<HTMLElement>("#app");

    this.back = document.createElement("div");
    this.back.className = "window-morph-layer window-morph-layer--back";
    this.front = document.createElement("div");
    this.front.className = "window-morph-layer window-morph-layer--front";
    for (const layer of [this.back, this.front]) layer.setAttribute("aria-hidden", "true");
    this.backdrop = document.createElement("div");
    this.backdrop.className = "window-morph-surface window-morph-surface--backdrop";
    this.back.appendChild(this.backdrop);
    if (this.app?.parentNode) this.app.parentNode.insertBefore(this.back, this.app);
    else document.body.appendChild(this.back);
    document.body.appendChild(this.front);

    // The maximized window's opaque background, behind everything.
    placeBox(this.backdrop, before.mode === "full" ? before.app : before.stage);
    this.backdrop.style.opacity = before.mode === "full" ? "1" : "0";

    const surfaces = surfacesOf(before, root);
    for (const [id, box] of Object.entries(before.parts) as Array<[MorphPartId, Box]>) {
      const ghost = document.createElement("div");
      ghost.className = `window-morph-surface window-morph-surface--${id}`;
      placeBox(ghost, box);
      paintSurface(ghost, surfaces[id]);
      this.front.appendChild(ghost);
      this.ghosts.set(id, ghost);
    }

    const fadeOut = ms(SURFACE_FADE_OUT_MS);
    // The stand-ins fade in over the panels as the real interface fades out.
    this.front.style.opacity = "0";
    this.add(play(this.front, [{ opacity: 0 }, { opacity: 1 }], { duration: fadeOut, easing: "linear", fill: "forwards" }));
    if (this.app) {
      this.appFade = this.add(
        play(this.app, [{ opacity: 1 }, { opacity: 0 }], { duration: fadeOut, easing: "linear", fill: "forwards" }),
      );
    }
    this.ready = new Promise((resolve) => this.later(resolve, fadeOut));
  }

  private add(animation: Animation | null): Animation | null {
    if (animation) this.animations.push(animation);
    return animation;
  }

  private later(fn: () => void, delay: number): void {
    this.timers.push(setTimeout(fn, delay));
  }

  /**
   * Step 2: carry the surfaces into the new layout and reveal it.
   *
   * The new layout stays fully hidden while the surfaces travel. Drawing it
   * for the first time (its album art at new sizes) is the heaviest GPU job of
   * the whole switch, measured at 60-110 ms even with no animation at all;
   * hidden, the browser does not draw it yet, so the flat surfaces have the
   * GPU to themselves while they move. It is drawn when the reveal starts,
   * when nothing is moving any more.
   */
  travel(): void {
    if (this.stopped) return;
    const after = this.after;
    if (this.app) {
      this.appFade?.cancel();
      this.appFade = null;
      this.app.style.opacity = "0";
    }
    const duration = ms(MORPH_MS);
    const timing: KeyframeAnimationOptions = { duration, easing: MORPH_EASING, fill: "forwards" };
    const before = this.before;
    const targets = this.targets;

    for (const [id, ghost] of this.ghosts) {
      const to = after.parts[id];
      const from = before.parts[id]!;
      if (!to) {
        this.add(play(ghost, [{ opacity: 1 }, { opacity: 0 }], { ...timing, duration: duration * 0.5 }));
        continue;
      }
      // Laid out at the target box; the transform carries it there from the old one.
      placeBox(ghost, to);
      const radius = targets[id]?.radius;
      if (radius) ghost.style.borderRadius = radius;
      this.add(play(ghost, [{ transform: stretchFlip(from, to) }, { transform: "none" }], timing));
    }
    for (const [id, to] of Object.entries(after.parts) as Array<[MorphPartId, Box]>) {
      if (this.ghosts.has(id)) continue;
      const ghost = document.createElement("div");
      ghost.className = `window-morph-surface window-morph-surface--${id}`;
      placeBox(ghost, to);
      paintSurface(ghost, targets[id]);
      this.front.appendChild(ghost);
      this.ghosts.set(id, ghost);
      this.add(play(ghost, [{ opacity: 0 }, { opacity: 1 }], timing));
    }

    // The window background grows out of the old stage, or shrinks into the new one.
    const toFull = after.mode === "full";
    const fullBox = toFull ? after.app : before.app;
    const stageBox = toFull ? before.stage : after.stage;
    placeBox(this.backdrop, fullBox);
    const collapsed = stretchFlip(stageBox, fullBox);
    this.add(
      play(
        this.backdrop,
        toFull
          ? [{ transform: collapsed, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: "none", opacity: 1 }]
          : [{ transform: "none", opacity: 1 }, { opacity: 1, offset: 0.7 }, { transform: collapsed, opacity: 0 }],
        timing,
      ),
    );

    // Reveal the new interface over the landing surfaces, then hand over.
    const reveal = ms(SURFACE_REVEAL_MS);
    const revealDelay = duration * REVEAL_AT;
    this.later(() => {
      if (this.stopped) return;
      if (this.app) {
        this.app.style.opacity = "";
        this.add(play(this.app, [{ opacity: 0 }, { opacity: 1 }], { duration: reveal, easing: "linear" }));
      }
      this.add(play(this.front, [{ opacity: 1 }, { opacity: 0 }], { duration: reveal, easing: "linear", fill: "forwards" }));
      this.later(() => this.stop(), Math.max(reveal, duration - revealDelay) + 20);
    }, revealDelay);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    for (const animation of this.animations) {
      try {
        animation.cancel();
      } catch {
        // Already done
      }
    }
    if (this.app) this.app.style.opacity = "";
    this.back.remove();
    this.front.remove();
    this.resolveFinished();
  }
}
