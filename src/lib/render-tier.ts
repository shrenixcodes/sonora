/**
 * Rendering tier: does this machine composite on a GPU, or in software?
 *
 * Without a usable GPU (no graphics driver, Microsoft Basic Render Driver,
 * remote desktop, a VM), Chromium falls back to software compositing, where
 * every scaled or blurred layer is redrawn by the CPU each frame. Animations
 * that are free on a GPU then drop frames, so effects pick a lighter variant
 * on the "software" tier.
 */

export type RenderTier = "gpu" | "software";

const SOFTWARE_RENDERERS = /swiftshader|basic render|llvmpipe|softpipe|software|warp|mesa offscreen/i;

let cached: RenderTier | null = null;

/** Classifies a WebGL renderer string. */
export function tierForRenderer(renderer: string | null | undefined): RenderTier {
  return renderer && !SOFTWARE_RENDERERS.test(renderer) ? "gpu" : "software";
}

function detect(): RenderTier {
  if (typeof document === "undefined") return "software";
  try {
    const canvas = document.createElement("canvas");
    // The browser refuses this context when WebGL would run in software.
    const gl = canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
    if (!gl) return "software";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return tierForRenderer(renderer);
  } catch {
    return "software";
  }
}

/** The machine's rendering tier, detected once. */
export function renderTier(): RenderTier {
  cached ??= detect();
  return cached;
}

/** Exposes the tier to CSS, which swaps glass blurs for solid tints on "software". */
export function markRenderTier(root: HTMLElement = document.documentElement): RenderTier {
  const tier = renderTier();
  root.dataset.renderTier = tier;
  return tier;
}
