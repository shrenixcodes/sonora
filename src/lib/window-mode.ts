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
import { getCurrentWindow } from "@tauri-apps/api/window";

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
