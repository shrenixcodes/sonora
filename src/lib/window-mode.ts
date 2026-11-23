/**
 * Window mode.
 *
 * "full": the maximized (or fullscreen) layout, panels filling the window.
 * "floating": the normal-size layout, a central stage with navigation, search,
 * window controls and the player floating around it over the desktop.
 *
 * In floating mode the panels' bounds are sent to the backend, which lets
 * clicks in the empty space between them reach whatever is behind the window.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

export type WindowMode = "floating" | "full";

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything that should take clicks in floating mode. */
const INTERACTIVE_PARTS = [
  ".titlebar__left",
  ".titlebar__search",
  ".titlebar__right",
  ".sidebar",
  ".main",
  ".now-playing",
  ".queue-panel",
  ".player",
  "dialog[open]",
];

export function modeFor(state: { maximized: boolean; fullscreen: boolean }): WindowMode {
  return state.maximized || state.fullscreen ? "full" : "floating";
}

/* ── Snapping to the middle of the screen ─────────
 * The floating window is dragged around by hand and there is no other way to
 * put it back where it started. A drag that finishes near the middle of the
 * screen is pulled the rest of the way, so the window can always be recentred
 * without aiming for it.
 */

/** How near the middle, in screen pixels, a drag has to finish to be pulled in. */
const SNAP_RADIUS = 90;
/** A drag reports a position for every step; wait for it to come to rest. */
const SNAP_SETTLE_MS = 180;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a window of this size would sit centred on this screen, or null when it
 * is already there or too far away to be pulled in.
 */
export function snapTarget(
  window_: Box,
  screen: Box,
  radius = SNAP_RADIUS,
): { x: number; y: number } | null {
  const x = Math.round(screen.x + (screen.width - window_.width) / 2);
  const y = Math.round(screen.y + (screen.height - window_.height) / 2);
  if (x === window_.x && y === window_.y) return null; // already centred
  if (Math.hypot(window_.x - x, window_.y - y) > radius) return null;
  return { x, y };
}

/** Bounds of the visible interactive parts, rounded outward to whole pixels. */
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

let currentMode: WindowMode = "full";

function applyMode(mode: WindowMode): void {
  currentMode = mode;
  document.documentElement.dataset.window = mode;
  scheduleRegionSync();
}

let regionFrame = 0;
function scheduleRegionSync(): void {
  if (!isTauri() || regionFrame) return;
  regionFrame = requestAnimationFrame(() => {
    regionFrame = 0;
    const regions = currentMode === "floating" ? collectRegions() : null;
    invoke("set_floating_regions", { regions }).catch((err) =>
      console.error("[window-mode] failed to update click regions:", err),
    );
  });
}

/** Re-sends panel bounds whenever any of them changes size or the layout shifts. */
function watchLayout(): void {
  const observer = new ResizeObserver(scheduleRegionSync);
  INTERACTIVE_PARTS.forEach((selector) =>
    document.querySelectorAll(selector).forEach((node) => observer.observe(node)),
  );
  observer.observe(document.documentElement);
  // Opening "Up next" changes the grid without resizing every observed part.
  const app = document.getElementById("app");
  if (app) new MutationObserver(scheduleRegionSync).observe(app, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(scheduleRegionSync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
}

/** Pulls the floating window to the middle of the screen when a drag finishes near it. */
function watchForRecentring(appWindow: ReturnType<typeof getCurrentWindow>): void {
  let settle = 0;
  const snap = async (): Promise<void> => {
    if (currentMode !== "floating") return;
    const screen = await currentMonitor();
    if (!screen) return;
    const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
    const target = snapTarget(
      { x: position.x, y: position.y, width: size.width, height: size.height },
      { x: screen.position.x, y: screen.position.y, width: screen.size.width, height: screen.size.height },
      Math.round(SNAP_RADIUS * screen.scaleFactor),
    );
    if (target) await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
  };

  void appWindow.onMoved(() => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      snap().catch((err) => console.error("[window-mode] could not recentre the window:", err));
    }, SNAP_SETTLE_MS);
  });
}

export async function initWindowMode(): Promise<void> {
  if (!isTauri()) {
    // Browser development: preview the floating layout with ?window=floating
    const preview = new URLSearchParams(location.search).get("window") === "floating";
    applyMode(preview ? "floating" : "full");
    return;
  }

  const appWindow = getCurrentWindow();
  const refresh = async () => {
    const [maximized, fullscreen] = await Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()]);
    applyMode(modeFor({ maximized, fullscreen }));
  };

  await refresh();
  watchLayout();
  watchForRecentring(appWindow);
  await appWindow.onResized(() => {
    refresh().catch((err) => console.error("[window-mode] failed to read window state:", err));
  });

  // Show the window after the first paint; slide in unless the user prefers less motion.
  const animate = currentMode === "floating" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => {
    invoke("present_main_window", { animate }).catch((err) =>
      console.error("[window-mode] failed to show the window:", err),
    );
  });
}
