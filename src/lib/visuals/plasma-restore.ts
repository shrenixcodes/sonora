/**
 * Plasma restore animation for Sonora.
 *
 * When the window is restored (e.g. from the taskbar after being minimized),
 * the player bar immediately holds its place as a magnetic attractor core.
 * Randomized plasma fluid tendrils stream in from the screen edge or corners,
 * coalescing the rest of the window panels into position.
 */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

/** Randomly chooses an origin boundary for the fluid plasma stream. */
export function pickRandomOrigin(): PlasmaOrigin {
  const index = Math.floor(Math.random() * PLASMA_ORIGINS.length);
  return PLASMA_ORIGINS[index];
}

let lastTriggerTime = 0;
let activeCanvas: HTMLCanvasElement | null = null;
let activeRafId: number | null = null;
let activeCleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Creates particles spawned from the specified screen edge or corner.
 */
function createPlasmaParticles(
  origin: PlasmaOrigin,
  width: number,
  height: number,
  count = 50,
): PlasmaParticle[] {
  const particles: PlasmaParticle[] = [];

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
        vy = 4 + Math.random() * 8;
        break;
      case "bottom":
        x = Math.random() * width;
        y = height + 10 + Math.random() * 40;
        vx = (Math.random() - 0.5) * 5;
        vy = -4 - Math.random() * 8;
        break;
      case "left":
        x = -10 - Math.random() * 40;
        y = Math.random() * height;
        vx = 4 + Math.random() * 8;
        vy = (Math.random() - 0.5) * 5;
        break;
      case "right":
        x = width + 10 + Math.random() * 40;
        y = Math.random() * height;
        vx = -4 - Math.random() * 8;
        vy = (Math.random() - 0.5) * 5;
        break;
      case "top-left":
        x = -15 + Math.random() * 50;
        y = -15 + Math.random() * 50;
        vx = 3 + Math.random() * 6;
        vy = 3 + Math.random() * 6;
        break;
      case "top-right":
        x = width - 35 + Math.random() * 50;
        y = -15 + Math.random() * 50;
        vx = -3 - Math.random() * 6;
        vy = 3 + Math.random() * 6;
        break;
      case "bottom-left":
        x = -15 + Math.random() * 50;
        y = height - 35 + Math.random() * 50;
        vx = 3 + Math.random() * 6;
        vy = -3 - Math.random() * 6;
        break;
      case "bottom-right":
        x = width - 35 + Math.random() * 50;
        y = height - 35 + Math.random() * 50;
        vx = -3 - Math.random() * 6;
        vy = -3 - Math.random() * 6;
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
 * Triggers the magnetic plasma restore sequence.
 * Can be tested with a deterministic origin if provided.
 */
export function triggerPlasmaRestore(forcedOrigin?: PlasmaOrigin): void {
  // Check user preference for reduced motion
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReduced) {
    return;
  }

  // Debounce consecutive triggers (e.g. visibility + focus simultaneously)
  const now = Date.now();
  if (now - lastTriggerTime < 500) {
    return;
  }
  lastTriggerTime = now;

  // Clean up any ongoing animation first
  stopPlasmaRestore();

  const origin = forcedOrigin ?? pickRandomOrigin();
  const root = document.documentElement;
  root.classList.add("app--restoring");
  root.setAttribute("data-plasma-origin", origin);

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

  const particles = createPlasmaParticles(origin, width, height, 55);
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
  lastTriggerTime = 0;
}

/**
 * Initializes listeners for window minimize/restore and focus events.
 */
export function initPlasmaRestore(): void {
  let wasInactive = false;

  // Track document visibility (minimized window causes document to be hidden)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
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
    wasInactive = true;
  });

  window.addEventListener("focus", () => {
    if (wasInactive) {
      wasInactive = false;
      triggerPlasmaRestore();
    }
  });

  // If running inside Tauri, hook window focus events for unminimize
  if (isTauri()) {
    try {
      const appWindow = getCurrentWindow();
      appWindow
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) {
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
