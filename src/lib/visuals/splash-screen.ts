/**
 * Sonora Launch Splash Screen — 3D Cube Transformation & Acoustic Ripple Effector.
 *
 * Visual sequence:
 * 1. Cubes sample the current screen layout blocks (titlebar, sidebar, main stage, player).
 * 2. Cubes elevate in 3D isometric perspective and dynamically transform into Sonora brand colors.
 * 3. The Sonora brand insignia and typography materialize in the center.
 * 4. An acoustic shockwave ripple expands outward from the center, dispersing the cubes.
 * 5. The splash smoothly dissolves, revealing the live Sonora homepage.
 */

import { icon } from "@/icons";

export interface SplashOptions {
  duration?: number;
  force?: boolean;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface IsometricCube {
  cx: number;
  cy: number;
  size: number;
  elevation: number;
  targetElevation: number;
  initTop: RGB;
  initLeft: RGB;
  initRight: RGB;
  targetTop: RGB;
  targetLeft: RGB;
  targetRight: RGB;
  distance: number;
  phase: number;
  alpha: number;
  scale: number;
}

const BRAND_PALETTE: { top: RGB; left: RGB; right: RGB }[] = [
  { top: { r: 56, g: 189, b: 248 }, left: { r: 79, g: 70, b: 229 }, right: { r: 67, g: 56, b: 202 } }, // Cyan to indigo
  { top: { r: 129, g: 140, b: 248 }, left: { r: 99, g: 102, b: 241 }, right: { r: 79, g: 70, b: 229 } }, // Resonant indigo
  { top: { r: 192, g: 132, b: 252 }, left: { r: 147, g: 51, b: 234 }, right: { r: 126, g: 34, b: 206 } }, // Radiant violet
  { top: { r: 168, g: 85, b: 247 }, left: { r: 124, g: 58, b: 237 }, right: { r: 109, g: 40, b: 217 } }, // Deep purple
];

function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpColor(c1: RGB, c2: RGB, t: number): string {
  const r = Math.round(lerp(c1.r, c2.r, t));
  const g = Math.round(lerp(c1.g, c2.g, t));
  const b = Math.round(lerp(c1.b, c2.b, t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Samples the initial screen block color based on screen coordinates */
function sampleScreenBlockColor(x: number, y: number, width: number, height: number): {
  top: RGB;
  left: RGB;
  right: RGB;
} {
  // Titlebar region
  if (y < height * 0.1) {
    return { top: hexToRgb("#201c2b"), left: hexToRgb("#181522"), right: hexToRgb("#13101c") };
  }
  // Sidebar region
  if (x < width * 0.14) {
    return { top: hexToRgb("#262235"), left: hexToRgb("#1c1828"), right: hexToRgb("#161220") };
  }
  // Player bar region
  if (y > height * 0.88) {
    return { top: hexToRgb("#241f32"), left: hexToRgb("#1a1626"), right: hexToRgb("#14111e") };
  }
  // Main stage with cards
  const isCardArea = Math.sin(x * 0.02) * Math.cos(y * 0.02) > 0.2;
  if (isCardArea) {
    return { top: hexToRgb("#352e47"), left: hexToRgb("#292338"), right: hexToRgb("#1f1a2c") };
  }
  return { top: hexToRgb("#2b253c"), left: hexToRgb("#1e192c"), right: hexToRgb("#171322") };
}

let activeSplashPromise: Promise<void> | null = null;

/**
 * Mounts and executes the Sonora launch splash animation sequence.
 */
export function showLaunchSplash(options: SplashOptions = {}): Promise<void> {
  if (activeSplashPromise) return activeSplashPromise;

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Only run once per session unless forced
  const hasShown = typeof sessionStorage !== "undefined" && sessionStorage.getItem("sonora_splash_seen");
  if ((hasShown && !options.force) || prefersReduced) {
    return Promise.resolve();
  }

  activeSplashPromise = new Promise<void>((resolve) => {
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem("sonora_splash_seen", "true");
      } catch {}
    }

    const overlay = document.createElement("div");
    overlay.className = "splash-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.setAttribute("aria-label", "Sonora launch splash screen");

    const canvas = document.createElement("canvas");
    canvas.className = "splash-canvas";
    overlay.appendChild(canvas);

    const brand = document.createElement("div");
    brand.className = "splash-brand";
    brand.innerHTML = `
      <div class="splash-logo" aria-hidden="true">${icon("sonoraLogo")}</div>
      <h1 class="splash-title">Sonora</h1>
      <p class="splash-tagline">Resonant Sound · Pure Clarity</p>
    `;
    overlay.appendChild(brand);

    const skipHint = document.createElement("span");
    skipHint.className = "splash-skip-hint";
    skipHint.textContent = "Click or press any key to enter";
    overlay.appendChild(skipHint);

    document.body.appendChild(overlay);

    const width = window.innerWidth || 1024;
    const height = window.innerHeight || 768;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    const centerX = width / 2;
    const centerY = height / 2;

    // Generate 3D Voxel Cubes Grid
    const cubeSize = Math.max(38, Math.min(54, width / 22));
    const stepX = cubeSize * 1.5;
    const stepY = cubeSize * 0.88;
    const cols = Math.ceil(width / stepX) + 2;
    const rows = Math.ceil(height / stepY) + 2;

    const cubes: IsometricCube[] = [];
    for (let r = -1; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        // Stagger every other row for isometric packing
        const cx = c * stepX + (r % 2 === 0 ? 0 : stepX * 0.5);
        const cy = r * stepY;
        const dist = Math.hypot(cx - centerX, cy - centerY);

        const initColors = sampleScreenBlockColor(cx, cy, width, height);
        const targetPalette = BRAND_PALETTE[Math.floor(Math.random() * BRAND_PALETTE.length)];

        cubes.push({
          cx,
          cy,
          size: cubeSize,
          elevation: 0,
          targetElevation: 18 + Math.sin(cx * 0.02 + cy * 0.02) * 12,
          initTop: initColors.top,
          initLeft: initColors.left,
          initRight: initColors.right,
          targetTop: targetPalette.top,
          targetLeft: targetPalette.left,
          targetRight: targetPalette.right,
          distance: dist,
          phase: (dist / 800) * 0.4 + (Math.random() * 0.1),
          alpha: 1,
          scale: 1,
        });
      }
    }

    let isDismissed = false;
    let rafId: number | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (isDismissed) return;
      isDismissed = true;

      window.removeEventListener("keydown", onKeyDown);
      overlay.removeEventListener("click", onDismiss);

      if (rafId !== null) cancelAnimationFrame(rafId);
      if (safetyTimer !== null) clearTimeout(safetyTimer);

      overlay.classList.add("is-exiting");
      setTimeout(() => {
        overlay.remove();
        activeSplashPromise = null;
        resolve();
      }, 450);
    };

    const onDismiss = () => cleanup();
    const onKeyDown = () => cleanup();

    overlay.addEventListener("click", onDismiss);
    window.addEventListener("keydown", onKeyDown);

    // If context is unavailable (e.g. testing in jsdom), complete cleanly
    if (!ctx) {
      setTimeout(cleanup, 200);
      return;
    }

    const startTime = performance.now();
    const TOTAL_DURATION = options.duration ?? 2800;

    function renderFrame(currentTime: number): void {
      if (isDismissed) return;

      const elapsed = currentTime - startTime;
      if (elapsed >= TOTAL_DURATION) {
        cleanup();
        return;
      }

      ctx?.clearRect(0, 0, width, height);

      // Phase 1: 0 - 700ms: Elevation
      // Phase 2: 500 - 1400ms: Color transformation
      // Phase 3: 1100 - 1800ms: Brand reveal
      // Phase 4: 1800 - 2700ms: Acoustic ripple effector

      if (elapsed >= 1100 && !brand.classList.contains("is-revealed")) {
        brand.classList.add("is-revealed");
      }

      if (elapsed >= 1850 && !brand.classList.contains("is-rippling")) {
        brand.classList.add("is-rippling");
      }

      const rippleRadius = elapsed >= 1800 ? (elapsed - 1800) * 1.5 : 0;

      for (const cube of cubes) {
        // Individual delayed progress
        const localT = Math.max(0, (elapsed - cube.phase * 600) / 700);
        const elevProgress = Math.min(1, localT);
        cube.elevation = cube.targetElevation * elevProgress;

        // Color transition
        const colorT = Math.max(0, Math.min(1, (elapsed - 500 - cube.phase * 400) / 700));
        const colTop = lerpColor(cube.initTop, cube.targetTop, colorT);
        const colLeft = lerpColor(cube.initLeft, cube.targetLeft, colorT);
        const colRight = lerpColor(cube.initRight, cube.targetRight, colorT);

        // Acoustic Ripple Effector
        if (rippleRadius > 0 && cube.distance <= rippleRadius + 150) {
          const waveDiff = rippleRadius - cube.distance;
          if (waveDiff >= 0 && waveDiff < 220) {
            const wave = Math.sin(waveDiff * 0.05) * Math.exp(-waveDiff * 0.015) * 38;
            cube.elevation += wave;
            cube.scale = Math.max(0, 1 - waveDiff / 240);
            cube.alpha = Math.max(0, 1 - waveDiff / 200);
          }
        }

        if (cube.alpha <= 0.01 || cube.scale <= 0.01) continue;

        // Draw Isometric Cube
        const hw = (cube.size / 2) * cube.scale;
        const hh = (cube.size / 3.4) * cube.scale;
        const d = (cube.size * 0.55 + cube.elevation) * cube.scale;
        const cx = cube.cx;
        const cy = cube.cy;

        ctx!.globalAlpha = cube.alpha;

        // Top Face
        ctx!.beginPath();
        ctx!.moveTo(cx, cy - hh - d);
        ctx!.lineTo(cx + hw, cy - d);
        ctx!.lineTo(cx, cy + hh - d);
        ctx!.lineTo(cx - hw, cy - d);
        ctx!.closePath();
        ctx!.fillStyle = colTop;
        ctx!.fill();

        // Left Face
        ctx!.beginPath();
        ctx!.moveTo(cx - hw, cy - d);
        ctx!.lineTo(cx, cy + hh - d);
        ctx!.lineTo(cx, cy + hh);
        ctx!.lineTo(cx - hw, cy);
        ctx!.closePath();
        ctx!.fillStyle = colLeft;
        ctx!.fill();

        // Right Face
        ctx!.beginPath();
        ctx!.moveTo(cx, cy + hh - d);
        ctx!.lineTo(cx + hw, cy - d);
        ctx!.lineTo(cx + hw, cy);
        ctx!.lineTo(cx, cy + hh);
        ctx!.closePath();
        ctx!.fillStyle = colRight;
        ctx!.fill();
      }

      ctx!.globalAlpha = 1;

      // Draw acoustic wave ring overlay during ripple
      if (rippleRadius > 0 && rippleRadius < Math.hypot(width, height)) {
        ctx!.beginPath();
        ctx!.arc(centerX, centerY, rippleRadius, 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx!.lineWidth = 3;
        ctx!.stroke();

        ctx!.beginPath();
        ctx!.arc(centerX, centerY, Math.max(0, rippleRadius - 30), 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(168, 85, 247, 0.25)";
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
      }

      rafId = requestAnimationFrame(renderFrame);
    }

    rafId = requestAnimationFrame(renderFrame);

    // Fallback safety timeout
    safetyTimer = setTimeout(cleanup, TOTAL_DURATION + 300);
  });

  return activeSplashPromise;
}
