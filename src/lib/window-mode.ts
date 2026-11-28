/**
 * Window mode.
 *
 * The OS window never changes size for a maximize or restore: it stays
 * maximized, covering the monitor's work area, and is transparent. The two
 * layouts are drawn inside it:
 *
 * "full": the maximized layout, panels filling the window.
 * "floating": a frame (the "floating window") drawn somewhere inside it, with
 *   navigation, search, window controls and the player floating around a
 *   central stage. Its position and size live here (remembered for the
 *   session only), not in the OS; dragging and resizing it happen in the page.
 *
 * Resizing a real window makes Chromium show a stale, then stretched, picture
 * for the 150-250 ms the page needs to lay out the new size. Keeping the
 * window still turns maximize and restore into a layout switch plus a
 * compositor animation (src/lib/window-morph.ts), with nothing stale on screen.
 *
 * In floating mode the panels' bounds are sent to the backend, which lets
 * clicks in the empty space around the frame reach the desktop.
 *
 * The frame cannot leave the OS window, so the OS window follows it instead:
 * a frame dropped past the edge of the screen moves the window to the monitor
 * under the pointer, and a Windows snap (Win+Left, Win+Right, Snap Layouts)
 * re-maximizes the window and puts the frame where the snap would have.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { shouldReduceMotion } from "@/lib/visuals/motion";
import { isSymbioteAnimating } from "@/lib/visuals/symbiote";
import { renderTier } from "@/lib/render-tier";
import { storage } from "@/lib/storage";
import {
  SurfaceMorph,
  measureLayout,
  playMorph,
  setMorphTimeScale,
  surfacesOf,
  type RunningMorph,
} from "@/lib/window-morph";

export type WindowMode = "floating" | "full";

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The floating window: a frame inside the (always maximized) OS window, in viewport CSS pixels. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** A spot in the OS window after it moved, with its new viewport (src-tauri/src/window_mode.rs). */
export interface Placement extends Frame {
  viewportWidth: number;
  viewportHeight: number;
}

/** Same as the window's size and minimum size before the window stopped resizing. */
export const FRAME_DEFAULT: Size = { width: 1180, height: 780 };
export const FRAME_MIN: Size = { width: 940, height: 600 };
/**
 * The frame and the layout are remembered for this session only
 * (sessionStorage survives a page reload, not a relaunch): within a run,
 * restoring brings back the size the user set, and every launch opens the
 * default floating window.
 */
const FRAME_KEY = "sonora:floating-frame";
const MODE_KEY = "sonora:window-layout";
const sessionStore: Pick<Storage, "getItem" | "setItem"> =
  typeof sessionStorage !== "undefined" ? sessionStorage : { getItem: () => null, setItem: () => {} };

/** Everything that should take clicks in floating mode. */
const INTERACTIVE_PARTS = [
  ".titlebar",
  ".titlebar__left",
  ".titlebar__search",
  ".titlebar__right",
  ".sidebar",
  ".main",
  ".now-playing",
  ".queue-panel",
  ".player",
  "dialog[open]",
  ".song-context-menu",
  ".audio-device-menu",
  ".update-toast",
  ".window-resize-handle",
];

export function collectRegions(root: ParentNode = document): HitRect[] {
  const regions: HitRect[] = [];
  for (const selector of INTERACTIVE_PARTS) {
    root.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const x = Math.floor(r.left);
      const y = Math.floor(r.top);
      regions.push({ x, y, width: Math.ceil(r.right) - x, height: Math.ceil(r.bottom) - y });
    });
  }
  return regions;
}

/* ── Frame geometry (pure) ──────────────────────────────── */

/** Keeps a frame at least its minimum size and fully inside the viewport. */
export function clampFrame(frame: Frame, viewport: Size): Frame {
  const minWidth = Math.min(FRAME_MIN.width, viewport.width);
  const minHeight = Math.min(FRAME_MIN.height, viewport.height);
  const width = Math.round(Math.min(Math.max(frame.width, minWidth), viewport.width));
  const height = Math.round(Math.min(Math.max(frame.height, minHeight), viewport.height));
  return {
    x: Math.round(Math.min(Math.max(frame.x, 0), viewport.width - width)),
    y: Math.round(Math.min(Math.max(frame.y, 0), viewport.height - height)),
    width,
    height,
  };
}

/** The default floating window, centered. */
export function centeredFrame(viewport: Size): Frame {
  const width = Math.min(FRAME_DEFAULT.width, viewport.width - 48);
  const height = Math.min(FRAME_DEFAULT.height, viewport.height - 48);
  return clampFrame({ x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height }, viewport);
}

export type ResizeEdge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

/** The frame after dragging `edge` by (dx, dy); the opposite edges stay put. */
export function resizeFrame(start: Frame, edge: ResizeEdge, dx: number, dy: number, viewport: Size): Frame {
  const minWidth = Math.min(FRAME_MIN.width, viewport.width);
  const minHeight = Math.min(FRAME_MIN.height, viewport.height);
  let { x, y, width, height } = start;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (edge.includes("East")) width = Math.min(Math.max(start.width + dx, minWidth), viewport.width - start.x);
  if (edge.includes("South")) height = Math.min(Math.max(start.height + dy, minHeight), viewport.height - start.y);
  if (edge.includes("West")) {
    x = Math.min(Math.max(start.x + dx, 0), right - minWidth);
    width = right - x;
  }
  if (edge.includes("North")) {
    y = Math.min(Math.max(start.y + dy, 0), bottom - minHeight);
    height = bottom - y;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Whether a drag was let go beyond the window, which only spans its own monitor. */
export function droppedOutside(x: number, y: number, view: Size): boolean {
  return x < 0 || y < 0 || x >= view.width || y >= view.height;
}

/** The frame on its new monitor, held by the same point it was grabbed at. */
export function frameAtPointer(current: Frame, pointer: Placement, grab: { x: number; y: number }): Frame {
  return clampFrame(
    { ...current, x: pointer.x - grab.x, y: pointer.y - grab.y },
    { width: pointer.viewportWidth, height: pointer.viewportHeight },
  );
}

/** Width-band classes standing in for the viewport media queries the layout used to have. */
export function widthBands(width: number): string[] {
  const bands = [440, 700, 720, 820, 1100, 1200].filter((max) => width <= max).map((max) => `fw-max-${max}`);
  if (width >= 1040) bands.push("fw-min-1040");
  return bands;
}

/* ── State ──────────────────────────────────────────────── */

/** The layout the user picked; fullscreen overrides it with "full". */
let chosenMode: WindowMode = "floating";
let fullscreen = false;
let frame: Frame | null = null;
let currentMode: WindowMode = "full";
let modeInitialized = false;
let lastSentRegionSignature: string | null = null;
/** While the frame is dragged or resized the whole window takes the pointer. */
let regionsLocked = false;
const modeListeners = new Set<(state: { mode: WindowMode; maximized: boolean }) => void>();
let runningMorph: RunningMorph | null = null;
/** While the OS window moves between monitors it is briefly restored; that is not the user's restore. */
let relocating = false;

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

function loadFrame(): Frame {
  try {
    const saved = JSON.parse(sessionStore.getItem(FRAME_KEY) ?? "null") as Frame | null;
    if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return clampFrame(saved, viewport());
  } catch {
    // Fall through to the default
  }
  return centeredFrame(viewport());
}

function saveFrame(): void {
  if (frame) sessionStore.setItem(FRAME_KEY, JSON.stringify(frame));
}

function getFrame(): Frame {
  frame ??= loadFrame();
  return frame;
}

/** The width the layout is laid out at: the frame when floating, the window otherwise. */
export function currentFrameWidth(): number {
  // Before startup has applied a mode, go by the layout the app will open in.
  const mode = modeInitialized ? currentMode : loadChosenMode();
  return mode === "floating" ? getFrame().width : window.innerWidth;
}

/** Writes the frame into the CSS variables and width bands (see floating.css). */
function applyFrame(): void {
  const root = document.documentElement;
  const style = root.style;
  if (currentMode === "floating") {
    const f = getFrame();
    style.setProperty("--frame-x", `${f.x}px`);
    style.setProperty("--frame-y", `${f.y}px`);
    style.setProperty("--frame-w", `${f.width}px`);
    style.setProperty("--frame-h", `${f.height}px`);
    style.setProperty("--frame-r", `${window.innerWidth - f.x - f.width}px`);
    style.setProperty("--frame-b", `${window.innerHeight - f.y - f.height}px`);
  } else {
    for (const name of ["--frame-x", "--frame-y", "--frame-w", "--frame-h", "--frame-r", "--frame-b"]) style.removeProperty(name);
  }
  const bands = widthBands(currentFrameWidth());
  for (const name of Array.from(root.classList)) {
    if (name.startsWith("fw-") && !bands.includes(name)) root.classList.remove(name);
  }
  for (const band of bands) root.classList.add(band);
}

/* ── Morph ──────────────────────────────────────────────── */

function morphAllowed(): boolean {
  const app = document.getElementById("app");
  return !!app && typeof app.animate === "function" && !shouldReduceMotion() && !isSymbioteAnimating();
}

/** Without a usable GPU the compositor runs on the CPU: play the light variant. */
function useLightMorph(): boolean {
  const choice = storage.getSettings().windowAnimation ?? "auto";
  return choice === "light" || (choice === "auto" && renderTier() === "software");
}

/** "slow" plays the morph 6x slower, to inspect it frame by frame. */
const SLOW_MOTION = 6;

/**
 * While a morph plays: CSS transitions are frozen (a layout switch would
 * otherwise set off size and spacing transitions that keep moving things
 * after the morph lands), glass blurs are off, and the ambient shader pauses.
 * Switched on before the layout changes, in the same style pass.
 */
function setMorphFreeze(on: boolean): void {
  const root = document.documentElement;
  if (root.classList.contains("is-window-morphing") === on) return;
  if (on) setMorphTimeScale(storage.getSettings().windowAnimation === "slow" ? SLOW_MOTION : 1);
  root.classList.toggle("is-window-morphing", on);
  root.classList.toggle("is-window-morphing--lite", on && useLightMorph());
  window.dispatchEvent(new CustomEvent("sonora:window-morph", { detail: { active: on } }));
}

/* ── Mode ───────────────────────────────────────────────── */

/** Subscribe to window layout mode changes; `maximized` is true for the full layout. */
export function subscribeWindowMode(
  listener: (state: { mode: WindowMode; maximized: boolean }) => void,
): () => void {
  modeListeners.add(listener);
  if (modeInitialized) {
    listener({ mode: currentMode, maximized: currentMode === "full" });
  }
  return () => {
    modeListeners.delete(listener);
  };
}

/** Applies a layout at once: the frame variables, width bands and listeners. */
function switchLayout(mode: WindowMode, changed: boolean): void {
  currentMode = mode;
  document.documentElement.dataset.window = mode;
  applyFrame();
  modeInitialized = true;
  if (changed) {
    modeListeners.forEach((listener) => listener({ mode, maximized: mode === "full" }));
  }
  scheduleRegionSync();
}

/**
 * Switches the layout. With `animate`, the panels' surfaces travel from their
 * boxes in the current layout to their boxes in the new one (both share one
 * viewport, so the "before" boxes are simply measured here). The default
 * morph (SurfaceMorph) switches at once and carries the real panels, at their
 * real size, along outlines travelling between the two; the light one (no
 * GPU) also switches at once but only slides the small pieces.
 */
function applyMode(mode: WindowMode, animate: boolean): void {
  const prevMode = currentMode;
  const changed = !modeInitialized || prevMode !== mode;
  const morph = modeInitialized && changed && animate && morphAllowed();

  // A morph still fading out has not switched yet, so currentMode is still
  // where it started; stopping it puts that layout back as it was.
  runningMorph?.stop();
  runningMorph = null;

  if (!morph) {
    setMorphFreeze(false);
    switchLayout(mode, changed);
    return;
  }

  const before = measureLayout(prevMode);
  // Freeze transitions before the layout switches, in the same style pass.
  setMorphFreeze(true);
  const whenDone = (running: RunningMorph) => {
    void running.finished.then(() => {
      if (runningMorph !== running) return;
      runningMorph = null;
      setMorphFreeze(false);
      scheduleRegionSync();
    });
  };

  if (useLightMorph()) {
    switchLayout(mode, true);
    const running = playMorph(before, measureLayout(mode), document, { lite: true });
    runningMorph = running;
    whenDone(running);
    return;
  }

  // Read the old looks, apply the new layout and read its boxes and looks,
  // then start the morph: all in this task, so the old layout's last frame
  // stays up until the first frame of the panels travelling.
  const looksBefore = surfacesOf(before);
  switchLayout(mode, true);
  const after = measureLayout(mode);
  const live = new SurfaceMorph(before, after, { before: looksBefore, after: surfacesOf(after) });
  runningMorph = live;
  whenDone(live);
}

function effectiveMode(): WindowMode {
  return fullscreen ? "full" : chosenMode;
}

function setChosenMode(mode: WindowMode, animate = true): void {
  chosenMode = mode;
  sessionStore.setItem(MODE_KEY, mode);
  applyMode(effectiveMode(), animate);
}

/** Immediately switches the layout without the morph. */
export function setOptimisticMaximized(maximized: boolean): void {
  setChosenMode(maximized ? "full" : "floating", false);
}

/**
 * Maximizes or restores the layout with the morph. The OS window does not
 * change size (see the top of this file); the argument is accepted for the
 * callers that leave fullscreen first.
 */
export async function toggleMaximizeAnimated(_appWindow?: unknown): Promise<void> {
  setChosenMode(chosenMode === "full" ? "floating" : "full");
}

/** Whether the window is fullscreen (immersive Now Playing), as last reported by the OS. */
export function isFullscreenWindow(): boolean {
  return fullscreen;
}

/** True while a maximize/restore morph is playing. */
export function isWindowMorphing(): boolean {
  return runningMorph !== null;
}

/* ── Click-through regions ──────────────────────────────── */

let regionFrame = 0;
function scheduleRegionSync(): void {
  if (!isTauri() || regionFrame) return;
  if (currentMode !== "floating" && lastSentRegionSignature === "full") return;
  regionFrame = requestAnimationFrame(() => {
    regionFrame = 0;
    // Mid-morph boxes are transformed, and a drag keeps the whole window live;
    // both re-sync when they end.
    if (runningMorph || regionsLocked) return;
    const regions = currentMode === "floating" ? collectRegions() : null;
    const signature = regions
      ? regions.map((r) => `${r.x},${r.y},${r.width},${r.height}`).join(";")
      : "full";
    if (signature === lastSentRegionSignature) return;
    lastSentRegionSignature = signature;
    invoke("set_floating_regions", { regions }).catch((err) => {
      lastSentRegionSignature = null;
      console.error("[window-mode] failed to update click regions:", err);
    });
  });
}

/**
 * Makes the whole window take the pointer while the frame moves, so a fast
 * drag cannot slip off the frame onto a click-through area and drop the drag.
 */
function lockRegions(locked: boolean): void {
  if (!isTauri() || regionsLocked === locked) return;
  regionsLocked = locked;
  if (locked) {
    lastSentRegionSignature = "locked";
    invoke("set_floating_regions", { regions: null }).catch(() => {});
  } else {
    lastSentRegionSignature = null;
    scheduleRegionSync();
  }
}

/** Re-sends panel bounds whenever any of them changes size or the layout shifts. */
function watchLayout(): void {
  const onLayoutChange = () => {
    if (currentMode === "floating") scheduleRegionSync();
  };
  const observer = new ResizeObserver(onLayoutChange);
  [".titlebar", ".sidebar", ".main", ".queue-panel", ".player"].forEach((selector) =>
    document.querySelectorAll(selector).forEach((node) => observer.observe(node)),
  );
  observer.observe(document.documentElement);
  // Opening "Up next" changes the grid without resizing every observed part.
  const app = document.getElementById("app");
  if (app) new MutationObserver(onLayoutChange).observe(app, { attributes: true, attributeFilter: ["class"] });
  // Moving the frame changes no panel's size, only the frame variables on <html>.
  new MutationObserver(onLayoutChange).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-immersive", "style"],
  });
  new MutationObserver(onLayoutChange).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
}

/* ── Moving and resizing the floating frame ─────────────── */

/** Elements inside a drag region that keep their own clicks. */
const NO_DRAG = "button, input, select, textarea, a, [role='button'], .no-drag";
/** How far the pointer must travel before a press on a drag region becomes a drag. */
const DRAG_THRESHOLD = 4;

let pendingFrameApply = 0;
function scheduleFrameApply(): void {
  if (pendingFrameApply) return;
  pendingFrameApply = requestAnimationFrame(() => {
    pendingFrameApply = 0;
    applyFrame();
  });
}

/**
 * A press on a drag region (titlebar, "Up next" header). Floating: moves the
 * frame. Full: a pull past the threshold restores to floating with the frame
 * under the pointer, then keeps following it, like dragging a maximized
 * window off the top of the screen.
 */
function onDragRegionPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary) return;
  const target = event.target as Element | null;
  if (!target || target.closest(NO_DRAG)) return;
  const handle = target.closest<HTMLElement>("[data-drag-region]");
  if (!handle) return;
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  let origin: Frame | null = currentMode === "floating" ? { ...getFrame() } : null;
  let pointerAtOrigin = { x: startX, y: startY };
  let dragging = false;

  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // Not capturable (synthetic event); window listeners still follow it.
  }
  if (origin) lockRegions(true);

  const onMove = (move: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return;
      if (!origin && fullscreen) return;
      dragging = true;
      document.documentElement.classList.add("is-frame-dragging");
      if (!origin) {
        // Pull to restore: the frame comes back under the pointer, at the
        // same relative spot along its titlebar.
        const size = getFrame();
        const rel = startX / window.innerWidth;
        frame = clampFrame(
          { x: move.clientX - rel * size.width, y: move.clientY - startY, width: size.width, height: size.height },
          viewport(),
        );
        lockRegions(true);
        setChosenMode("floating");
        origin = { ...frame };
        pointerAtOrigin = { x: move.clientX, y: move.clientY };
        return;
      }
    }
    if (!origin) return;
    frame = clampFrame(
      { ...origin, x: origin.x + move.clientX - pointerAtOrigin.x, y: origin.y + move.clientY - pointerAtOrigin.y },
      viewport(),
    );
    scheduleFrameApply();
  };

  const onUp = (up: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.documentElement.classList.remove("is-frame-dragging");
    if (dragging) {
      saveFrame();
      if (origin && up.type === "pointerup" && droppedOutside(up.clientX, up.clientY, viewport())) {
        void followPointerToMonitor({ x: pointerAtOrigin.x - origin.x, y: pointerAtOrigin.y - origin.y });
      }
    }
    lockRegions(false);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/** Moves the OS window to the monitor a frame was dropped on, keeping the frame under the pointer. */
async function followPointerToMonitor(grab: { x: number; y: number }): Promise<void> {
  if (!isTauri() || relocating) return;
  relocating = true;
  try {
    const pointer = await invoke<Placement | null>("follow_cursor_to_monitor");
    if (!pointer) return;
    frame = frameAtPointer(getFrame(), pointer, grab);
    saveFrame();
    applyFrame();
    scheduleRegionSync();
  } catch (err) {
    console.error("[window-mode] could not move to the other monitor:", err);
  } finally {
    relocating = false;
  }
}

function onDragRegionDoubleClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target || target.closest(NO_DRAG) || !target.closest("[data-drag-region]") || fullscreen) return;
  void toggleMaximizeAnimated();
}

function createResizeHandles(): void {
  const edges: ResizeEdge[] = ["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"];
  for (const edge of edges) {
    const handle = document.createElement("div");
    handle.className = `window-resize-handle window-resize-handle--${edge.toLowerCase()}`;
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || currentMode !== "floating") return;
      event.preventDefault();
      const start = { ...getFrame() };
      const startX = event.clientX;
      const startY = event.clientY;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners still follow it.
      }
      lockRegions(true);
      document.documentElement.classList.add("is-frame-resizing");
      const onMove = (move: PointerEvent) => {
        frame = resizeFrame(start, edge, move.clientX - startX, move.clientY - startY, viewport());
        scheduleFrameApply();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.documentElement.classList.remove("is-frame-resizing");
        saveFrame();
        lockRegions(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
    document.body.appendChild(handle);
  }
}

/* ── Startup ────────────────────────────────────────────── */

function loadChosenMode(): WindowMode {
  return sessionStore.getItem(MODE_KEY) === "full" ? "full" : "floating";
}

function listenForFrameInput(): void {
  createResizeHandles();
  document.addEventListener("pointerdown", onDragRegionPointerDown);
  document.addEventListener("dblclick", onDragRegionDoubleClick);
}

export async function initWindowMode(): Promise<void> {
  // Builds before session-only memory kept these across launches.
  try {
    localStorage.removeItem(FRAME_KEY);
    localStorage.removeItem(MODE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
  chosenMode = loadChosenMode();
  frame = loadFrame();

  if (!isTauri()) {
    // Browser development: ?window=floating|full picks the layout.
    const preview = new URLSearchParams(location.search).get("window");
    if (preview === "floating" || preview === "full") chosenMode = preview;
    applyMode(effectiveMode(), false);
    listenForFrameInput();
    window.addEventListener("resize", () => {
      frame = clampFrame(getFrame(), viewport());
      applyFrame();
    });
    return;
  }

  const appWindow = getCurrentWindow();
  listenForFrameInput();

  /**
   * The OS window must stay maximized. Fullscreen (immersive Now Playing)
   * shows the full layout. If something restored the window anyway (Win+Down),
   * that reads as "restore": switch to floating and maximize the window again.
   * A snap (Win+Left or Win+Right) also moves the frame to the snapped spot.
   */
  const syncWindowState = async (animate: boolean) => {
    const [maximized, isFullscreen, minimized] = await Promise.all([
      appWindow.isMaximized(),
      appWindow.isFullscreen(),
      appWindow.isMinimized(),
    ]);
    if (minimized || relocating) return;
    if (!maximized && !isFullscreen) {
      chosenMode = "floating";
      sessionStore.setItem(MODE_KEY, chosenMode);
      const snapped = await invoke<Placement | null>("settle_restored_window").catch(async (err) => {
        console.error("[window-mode] could not settle the restored window:", err);
        await appWindow.maximize().catch((error) => console.error("[window-mode] could not maximize:", error));
        return null;
      });
      if (snapped) {
        frame = clampFrame(snapped, { width: snapped.viewportWidth, height: snapped.viewportHeight });
        saveFrame();
      }
    }
    fullscreen = isFullscreen;
    applyMode(effectiveMode(), animate);
  };

  await syncWindowState(false);
  watchLayout();

  // The viewport changes only when the work area does (taskbar, resolution,
  // another monitor) or for fullscreen: keep the frame inside it.
  window.addEventListener("resize", () => {
    frame = clampFrame(getFrame(), viewport());
    applyFrame();
    scheduleRegionSync();
  });

  let resizeQueued = false;
  await appWindow.onResized(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      syncWindowState(true).catch((err) => console.error("[window-mode] failed to read window state:", err));
    });
  });

  // Show the window in place after the first paint. The liquid launch animation
  // (symbiote.ts) is the entrance, so the native slide-in is not used.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      invoke("present_main_window", { animate: false })
        .catch((err) => console.error("[window-mode] failed to show the window:", err))
        .finally(resolve);
    });
  });
}
