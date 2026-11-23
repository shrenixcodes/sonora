/**
 * Plasma restore animation for Sonora with check origin awareness.
 *
 * When the window is restored (e.g. from the taskbar after being minimized),
 * the player bar immediately holds its place as a magnetic attractor core.
 * Plasma fluid tendrils stream in with awareness of the window's physical screen
 * origin, display boundaries, and taskbar position, coalescing the rest of the
 * window panels into position.
 */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { shouldReduceMotion } from "./motion";

export type PlasmaOrigin =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "all";

export const PLASMA_ORIGINS: readonly PlasmaOrigin[] = [
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "all",
] as const;

export const RESTORE_DURATION_MS = 750;

export interface WindowOriginState {
  screenX: number;
  screenY: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenWidth: number;
  screenHeight: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  taskbarEdge: "bottom" | "top" | "left" | "right";
  nearestScreenEdge: PlasmaOrigin;
  relativeX: number;
  relativeY: number;
}

interface PlasmaParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  trail: Array<{ x: number; y: number }>;
}

const PLASMA_PALETTE = [
  "#38bdf8", // cyan glow
  "#818cf8", // indigo plasma
  "#c084fc", // purple violet
  "#f472b6", // energetic pink
  "#22d3ee", // bright electric teal
  "#a78bfa", // lavender electric
];

let lastWindowOrigin: WindowOriginState | null = null;

/**
 * Checks and records the current window origin, screen geometry, and taskbar edge.
 */
export function recordWindowOrigin(): WindowOriginState {
  const win = typeof window !== "undefined" ? window : null;
  const screen = win?.screen;

  const screenX = win?.screenX ?? 0;
  const screenY = win?.screenY ?? 0;
  const innerWidth = win?.innerWidth ?? 1024;
  const innerHeight = win?.innerHeight ?? 768;
  const outerWidth = win?.outerWidth ?? innerWidth;
  const outerHeight = win?.outerHeight ?? innerHeight;

  const screenWidth = screen?.width ?? 1920;
  const screenHeight = screen?.height ?? 1080;
  const availLeft = (screen && "availLeft" in screen ? Number((screen as unknown as Record<string, unknown>).availLeft) : 0) || 0;
  const availTop = (screen && "availTop" in screen ? Number((screen as unknown as Record<string, unknown>).availTop) : 0) || 0;
  const availWidth = screen?.availWidth ?? screenWidth;
  const availHeight = screen?.availHeight ?? screenHeight;

  // Detect taskbar position from available screen bounds
  let taskbarEdge: "bottom" | "top" | "left" | "right" = "bottom";
  if (availTop > 0) {
    taskbarEdge = "top";
  } else if (availLeft > 0) {
    taskbarEdge = "left";
  } else if (availWidth < screenWidth) {
    taskbarEdge = "right";
  } else if (availHeight < screenHeight) {
    taskbarEdge = "bottom";
  }

  // Calculate nearest screen edge or corner based on window center
  const centerX = screenX + outerWidth / 2;
  const centerY = screenY + outerHeight / 2;
  const normX = Math.max(0, Math.min(1, centerX / (screenWidth || 1)));
  const normY = Math.max(0, Math.min(1, centerY / (screenHeight || 1)));

  let nearestScreenEdge: PlasmaOrigin = "bottom";
  if (normX < 0.35 && normY < 0.35) nearestScreenEdge = "top-left";
  else if (normX > 0.65 && normY < 0.35) nearestScreenEdge = "top-right";
  else if (normX < 0.35 && normY > 0.65) nearestScreenEdge = "bottom-left";
  else if (normX > 0.65 && normY > 0.65) nearestScreenEdge = "bottom-right";
  else if (normY < 0.35) nearestScreenEdge = "top";
  else if (normY > 0.65) nearestScreenEdge = "bottom";
  else if (normX < 0.35) nearestScreenEdge = "left";
  else if (normX > 0.65) nearestScreenEdge = "right";
  else nearestScreenEdge = taskbarEdge;

  const state: WindowOriginState = {
    screenX,
    screenY,
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    screenWidth,
    screenHeight,
    availLeft,
    availTop,
    availWidth,
    availHeight,
    taskbarEdge,
    nearestScreenEdge,
    relativeX: normX,
    relativeY: normY,
  };

  lastWindowOrigin = state;
  return state;
}

/**
 * Checks the last recorded or active window origin awareness state.
 */
export function checkOriginAwareness(): WindowOriginState {
  if (lastWindowOrigin) {
    return lastWindowOrigin;
  }
  return recordWindowOrigin();
}

/** Randomly chooses an origin boundary for the fluid plasma stream. */
export function pickRandomOrigin(): PlasmaOrigin {
  const index = Math.floor(Math.random() * PLASMA_ORIGINS.length);
  return PLASMA_ORIGINS[index];
}

/**
 * Resolves restore origin taking into account window screen origin and taskbar placement.
 */
export function resolveOriginWithAwareness(options?: {
  preferTaskbar?: boolean;
}): { origin: PlasmaOrigin; originState: WindowOriginState } {
  const originState = checkOriginAwareness();
  let origin: PlasmaOrigin;

  if (options?.preferTaskbar) {
    origin = originState.taskbarEdge;
  } else {
    // Check nearest edge or pick origin
    const usePhysical = Math.random() < 0.5;
    origin = usePhysical ? originState.nearestScreenEdge : pickRandomOrigin();
  }

  return { origin, originState };
}

let lastTriggerTime = 0;
let activeCanvas: HTMLCanvasElement | null = null;
let activeRafId: number | null = null;
let activeCleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Creates particles spawned from the specified screen edge or corner with origin awareness.
 */
function createPlasmaParticles(
  origin: PlasmaOrigin,
  width: number,
  height: number,
  count = 50,
  originState?: WindowOriginState,
): PlasmaParticle[] {
  const particles: PlasmaParticle[] = [];

  // Fine-tune initial velocity scaling when origin-aware
  const edgeWeight = originState && originState.nearestScreenEdge === origin ? 1.25 : 1;

  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;

    let subOrigin = origin;
    if (origin === "all") {
      const edges: PlasmaOrigin[] = ["top", "bottom", "left", "right"];
      subOrigin = edges[Math.floor(Math.random() * edges.length)];
    }

    switch (subOrigin) {
      case "top":
        x = Math.random() * width;
        y = -10 - Math.random() * 40;
        vx = (Math.random() - 0.5) * 5;
        vy = (4 + Math.random() * 8) * edgeWeight;
        break;
      case "bottom":
        x = Math.random() * width;
        y = height + 10 + Math.random() * 40;
        vx = (Math.random() - 0.5) * 5;
        vy = (-4 - Math.random() * 8) * edgeWeight;
        break;
      case "left":
        x = -10 - Math.random() * 40;
        y = Math.random() * height;
        vx = (4 + Math.random() * 8) * edgeWeight;
        vy = (Math.random() - 0.5) * 5;
        break;
      case "right":
        x = width + 10 + Math.random() * 40;
        y = Math.random() * height;
        vx = (-4 - Math.random() * 8) * edgeWeight;
        vy = (Math.random() - 0.5) * 5;
        break;
      case "top-left":
        x = -15 + Math.random() * 50;
        y = -15 + Math.random() * 50;
        vx = (3 + Math.random() * 6) * edgeWeight;
        vy = (3 + Math.random() * 6) * edgeWeight;
        break;
      case "top-right":
        x = width - 35 + Math.random() * 50;
        y = -15 + Math.random() * 50;
        vx = (-3 - Math.random() * 6) * edgeWeight;
        vy = (3 + Math.random() * 6) * edgeWeight;
        break;
      case "bottom-left":
        x = -15 + Math.random() * 50;
        y = height - 35 + Math.random() * 50;
        vx = (3 + Math.random() * 6) * edgeWeight;
        vy = (-3 - Math.random() * 6) * edgeWeight;
        break;
      case "bottom-right":
        x = width - 35 + Math.random() * 50;
        y = height - 35 + Math.random() * 50;
        vx = (-3 - Math.random() * 6) * edgeWeight;
        vy = (-3 - Math.random() * 6) * edgeWeight;
        break;
    }

    const color = PLASMA_PALETTE[Math.floor(Math.random() * PLASMA_PALETTE.length)];
    particles.push({
      x,
      y,
      vx,
      vy,
      size: 2.5 + Math.random() * 3.5,
      color,
      alpha: 0.75 + Math.random() * 0.25,
      trail: [{ x, y }],
    });
  }

  return particles;
}

/**
 * Triggers the magnetic plasma restore sequence with check origin awareness.
 * Can be tested with a deterministic origin or options.
 */
export function triggerPlasmaRestore(
  forcedOrigin?: PlasmaOrigin,
  options?: { originAware?: boolean; force?: boolean },
): void {
  // Check user preference for reduced motion unless forced
  const prefersReduced = shouldReduceMotion();

  if (prefersReduced && !options?.force) {
    return;
  }

  // Debounce consecutive triggers (e.g. visibility + focus simultaneously)
  const now = Date.now();
  if (now - lastTriggerTime < 500 && !options?.force) {
    return;
  }
  lastTriggerTime = now;

  // Clean up any ongoing animation first
  stopPlasmaRestore();

  // Apply check origin awareness
  const originAware = options?.originAware ?? true;
  let origin = forcedOrigin;
  let originState: WindowOriginState | undefined;

  if (originAware) {
    const awareness = resolveOriginWithAwareness({ preferTaskbar: !forcedOrigin });
    originState = awareness.originState;
    if (!origin) {
      origin = awareness.origin;
    }
  } else if (!origin) {
    origin = pickRandomOrigin();
  }

  const root = document.documentElement;
  root.classList.add("app--restoring");
  root.setAttribute("data-plasma-origin", origin);

  if (originState) {
    root.setAttribute("data-plasma-origin-aware", "true");
    root.style.setProperty("--plasma-screen-x", `${originState.screenX}px`);
    root.style.setProperty("--plasma-screen-y", `${originState.screenY}px`);
    root.style.setProperty("--plasma-taskbar", originState.taskbarEdge);
  }

  const width = window.innerWidth || 1024;
  const height = window.innerHeight || 768;

  // Locate the player to act as the magnetic attractor core
  let targetX = width / 2;
  let targetY = height - 40;
  const player = document.querySelector(".player");
  if (player) {
    const rect = player.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      targetX = rect.left + rect.width / 2;
      targetY = rect.top + rect.height / 2;
    }
  }

  // Create overlay canvas
  const canvas = document.createElement("canvas");
  canvas.className = "plasma-canvas";
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  activeCanvas = canvas;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // If running in an environment without 2D context (such as jsdom), clean up via timeout
    activeCleanupTimer = setTimeout(() => {
      stopPlasmaRestore();
    }, RESTORE_DURATION_MS);
    return;
  }

  const particles = createPlasmaParticles(origin, width, height, 55, originState);
  const startTime = performance.now();

  function animate(currentTime: number): void {
    const elapsed = currentTime - startTime;
    if (elapsed >= RESTORE_DURATION_MS) {
      stopPlasmaRestore();
      return;
    }

    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Fade out particles near the end of the restore duration
    const fadeProgress = elapsed > 550 ? Math.max(0, 1 - (elapsed - 550) / 200) : 1;

    for (const p of particles) {
      // Magnetic pull toward the player bar attractor
      const dx = targetX - p.x;
      const dy = targetY - p.y;
      const dist = Math.hypot(dx, dy) + 1;

      // Acceleration towards player increases with distance falloff
      const force = Math.min(3.2, 380 / (dist + 60));
      p.vx += (dx / dist) * force * 1.6;
      p.vy += (dy / dist) * force * 1.6;

      // Fluid drag
      p.vx *= 0.93;
      p.vy *= 0.93;

      p.x += p.vx;
      p.y += p.vy;

      // Record trail for fluid appearance
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 7) {
        p.trail.shift();
      }

      const currentAlpha = p.alpha * fadeProgress;
      if (currentAlpha <= 0.01) continue;

      // Render fluid tendril
      if (p.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let j = 1; j < p.trail.length; j++) {
          ctx.lineTo(p.trail[j].x, p.trail[j].y);
        }
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.7;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = currentAlpha * 0.7;
        ctx.stroke();
      }

      // Render glowing particle head
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = currentAlpha;
      ctx.fill();
    }

    activeRafId = requestAnimationFrame(animate);
  }

  activeRafId = requestAnimationFrame(animate);

  // Fallback safety cleanup
  activeCleanupTimer = setTimeout(() => {
    stopPlasmaRestore();
  }, RESTORE_DURATION_MS + 50);
}

/** Cancels ongoing animation and cleans up DOM elements and classes. */
export function stopPlasmaRestore(): void {
  if (activeRafId !== null) {
    cancelAnimationFrame(activeRafId);
    activeRafId = null;
  }
  if (activeCleanupTimer !== null) {
    clearTimeout(activeCleanupTimer);
    activeCleanupTimer = null;
  }
  if (activeCanvas) {
    activeCanvas.remove();
    activeCanvas = null;
  }
  const root = document.documentElement;
  root.classList.remove("app--restoring");
  root.removeAttribute("data-plasma-origin");
  root.removeAttribute("data-plasma-origin-aware");
  root.style.removeProperty("--plasma-screen-x");
  root.style.removeProperty("--plasma-screen-y");
  root.style.removeProperty("--plasma-taskbar");
  lastTriggerTime = 0;
}

/**
 * Initializes listeners for window minimize/restore and focus events with origin awareness.
 */
export function initPlasmaRestore(): void {
  let wasInactive = false;

  // Track initial window screen origin
  recordWindowOrigin();

  // Track document visibility (minimized window causes document to be hidden)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      recordWindowOrigin();
      wasInactive = true;
    } else if (document.visibilityState === "visible") {
      if (wasInactive) {
        wasInactive = false;
        triggerPlasmaRestore();
      }
    }
  });

  // Track window blur and focus
  window.addEventListener("blur", () => {
    recordWindowOrigin();
    wasInactive = true;
  });

  window.addEventListener("focus", () => {
    if (wasInactive) {
      wasInactive = false;
      triggerPlasmaRestore();
    }
  });

  // If running inside Tauri, hook window unminimize and focus events
  if (isTauri()) {
    try {
      const appWindow = getCurrentWindow();

      // Native restore event from Rust click_through_sampler polling window.is_minimized()
      appWindow
        .listen("sonora://restore", () => {
          wasInactive = false;
          triggerPlasmaRestore();
        })
        .catch(() => {});

      appWindow
        .listen("sonora://minimize", () => {
          recordWindowOrigin();
          wasInactive = true;
        })
        .catch(() => {});

      appWindow
        .listen<boolean>("sonora://focus", ({ payload: focused }) => {
          if (!focused) {
            recordWindowOrigin();
            wasInactive = true;
          } else if (wasInactive) {
            wasInactive = false;
            triggerPlasmaRestore();
          }
        })
        .catch(() => {});

      appWindow
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            recordWindowOrigin();
            wasInactive = true;
          } else if (wasInactive) {
            wasInactive = false;
            triggerPlasmaRestore();
          }
        })
        .catch(() => {});
    } catch {
      // Window listeners might not be available in non-desktop environments
    }
  }
}
