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
import { shouldReduceMotion } from "@/lib/visuals/motion";
import { isSymbioteAnimating } from "@/lib/visuals/symbiote";

export type WindowMode = "floating" | "full";

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  ".window-resize-handle",
];

export function modeFor(state: { maximized: boolean; fullscreen: boolean }): WindowMode {
  return state.maximized || state.fullscreen ? "full" : "floating";
}

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
let currentMaximized = false;
let modeInitialized = false;
let lastSentRegionSignature: string | null = null;
const modeListeners = new Set<(state: { mode: WindowMode; maximized: boolean }) => void>();

const MORPH_SELECTORS = [".titlebar", ".sidebar", ".main", ".queue-panel", ".player"] as const;
const MORPH_MS = 210;
let morphAnimations: Animation[] = [];
let morphTimer: ReturnType<typeof setTimeout> | null = null;

function stopWindowMorph(): void {
  if (morphTimer !== null) {
    clearTimeout(morphTimer);
    morphTimer = null;
  }
  for (const anim of morphAnimations) {
    try {
      anim.cancel();
    } catch {
      // Already finished
    }
  }
  morphAnimations = [];
  document.documentElement.classList.remove("is-window-morphing");
}

function playWindowMorph(from: WindowMode, to: WindowMode): void {
  if (from === to || shouldReduceMotion() || isSymbioteAnimating()) return;
  stopWindowMorph();
  const root = document.documentElement;
  root.classList.add("is-window-morphing");

  const expanding = to === "full";
  const keyframes: Keyframe[] = expanding
    ? [
        { opacity: 0.8, transform: "scale(0.978)" },
        { opacity: 1, transform: "none" },
      ]
    : [
        { opacity: 0.86, transform: "scale(1.016)" },
        { opacity: 1, transform: "none" },
      ];
  const timing: KeyframeAnimationOptions = {
    duration: MORPH_MS,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  };

  for (const selector of MORPH_SELECTORS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node && typeof node.animate === "function") {
      try {
        morphAnimations.push(node.animate(keyframes, timing));
      } catch {
        // Animation unavailable in headless environments
      }
    }
  }

  const app = document.getElementById("app");
  if (app && typeof app.animate === "function") {
    try {
      morphAnimations.push(
        app.animate([{ opacity: 0.72 }, { opacity: 1 }], { ...timing, pseudoElement: "::before" }),
      );
    } catch {
      // Pseudo-element animations unsupported in jsdom
    }
  }

  morphTimer = setTimeout(stopWindowMorph, MORPH_MS + 30);
}

/** Subscribe to window layout mode and maximize state changes. */
export function subscribeWindowMode(
  listener: (state: { mode: WindowMode; maximized: boolean }) => void,
): () => void {
  modeListeners.add(listener);
  if (modeInitialized) {
    listener({ mode: currentMode, maximized: currentMaximized });
  }
  return () => {
    modeListeners.delete(listener);
  };
}

/** Immediately previews the target maximize layout to avoid a stretched-floating frame flash. */
export function setOptimisticMaximized(maximized: boolean): void {
  applyMode(modeFor({ maximized, fullscreen: false }), maximized, true);
}

function applyMode(mode: WindowMode, maximized = mode === "full", allowMorph = true): void {
  const prevMode = currentMode;
  const changed = !modeInitialized || prevMode !== mode || currentMaximized !== maximized;
  currentMode = mode;
  currentMaximized = maximized;
  document.documentElement.dataset.window = mode;
  if (modeInitialized && allowMorph && prevMode !== mode) {
    playWindowMorph(prevMode, mode);
  }
  modeInitialized = true;
  if (changed) {
    modeListeners.forEach((listener) => listener({ mode, maximized }));
  }
  scheduleRegionSync();
}

let regionFrame = 0;
function scheduleRegionSync(): void {
  if (!isTauri() || regionFrame) return;
  if (currentMode !== "floating" && lastSentRegionSignature === "full") return;
  regionFrame = requestAnimationFrame(() => {
    regionFrame = 0;
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
  new MutationObserver(onLayoutChange).observe(document.documentElement, { attributes: true, attributeFilter: ["data-immersive"] });
  new MutationObserver(onLayoutChange).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
}

export async function initWindowMode(): Promise<void> {
  if (!isTauri()) {
    // Browser development: preview the floating layout with ?window=floating
    const preview = new URLSearchParams(location.search).get("window") === "floating";
    applyMode(preview ? "floating" : "full", !preview, false);
    return;
  }

  const appWindow = getCurrentWindow();
  const directions = ["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"] as const;
  for (const direction of directions) {
    const handle = document.createElement("div");
    handle.className = `window-resize-handle window-resize-handle--${direction.toLowerCase()}`;
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("mousedown", (event) => {
      if (event.button === 0 && currentMode === "floating") {
        event.preventDefault();
        void appWindow.startResizeDragging(direction).catch((err) => console.error("[window-mode] resize failed:", err));
      }
    });
    document.body.appendChild(handle);
  }
  const refresh = async (allowMorph = true) => {
    const [maximized, fullscreen] = await Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()]);
    applyMode(modeFor({ maximized, fullscreen }), maximized, allowMorph);
  };

  await refresh(false);
  watchLayout();

  let resizeQueued = false;
  await appWindow.onResized(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      refresh(true).catch((err) => console.error("[window-mode] failed to read window state:", err));
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
