import { describe, it, expect, vi, afterEach } from "vitest";
import { AmbientVisualRenderer } from "../src/lib/visuals/ambient-renderer";

/**
 * jsdom has no WebGL, so the renderer runs with a null context: it schedules
 * and skips frames exactly as it would on screen, but draws nothing. That is
 * all these tests look at.
 */
function renderer() {
  // jsdom has no matchMedia; the renderer reads it for the reduced-motion setting.
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  const canvas = document.createElement("canvas");
  return new AmbientVisualRenderer(canvas);
}

/** Stands in for a high refresh rate display, and counts what it is asked for. */
function fakeDisplay(hz: number) {
  let frames = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames += 1;
    return setTimeout(() => cb(performance.now()), 1000 / hz) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  return () => frames;
}

describe("AmbientVisualRenderer frame scheduling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("wakes at its target rate, not at the display's", () => {
    vi.useFakeTimers();
    const frames = fakeDisplay(144);
    const visuals = renderer();

    visuals.setFpsLimit(30);
    visuals.resume();
    vi.advanceTimersByTime(1000);
    visuals.pause();

    // One second at 30 FPS, with room for scheduling slack either way.
    expect(frames()).toBeGreaterThan(20);
    expect(frames()).toBeLessThan(45);
  });

  it("asks for nothing more once paused", () => {
    vi.useFakeTimers();
    const frames = fakeDisplay(144);
    const visuals = renderer();

    visuals.resume();
    vi.advanceTimersByTime(200);
    visuals.pause();
    const atPause = frames();

    vi.advanceTimersByTime(2000);
    expect(frames()).toBe(atPause);
  });

  it("stops waking once static shader modes converge on their target palette", () => {
    vi.useFakeTimers();
    const frames = fakeDisplay(60);
    const visuals = renderer();

    const drawArrays = vi.fn();
    (visuals as unknown as {
      gl: Record<string, unknown>;
      currentProgram: Record<string, unknown>;
      setShaderSource: (s: string) => void;
    }).gl = {
      COLOR_BUFFER_BIT: 0x4000,
      TRIANGLES: 4,
      clearColor: vi.fn(),
      clear: vi.fn(),
      useProgram: vi.fn(),
      uniform1f: vi.fn(),
      uniform3fv: vi.fn(),
      drawArrays,
    };
    (visuals as unknown as { currentProgram: Record<string, unknown> }).currentProgram = {};
    (visuals as unknown as { setShaderSource: (s: string) => void }).setShaderSource = vi.fn();

    visuals.setMode("minimal");
    vi.advanceTimersByTime(500);
    const afterSettle = frames();

    vi.advanceTimersByTime(3000);
    expect(frames()).toBe(afterSettle);
    expect(drawArrays).toHaveBeenCalledTimes(1);

    // Updating artwork palette wakes static mode back up briefly to converge
    visuals.setPalette({
      dominant: "#ff0000",
      vibrant: "#00ff00",
      secondary: "#0000ff",
      darkMuted: "#110000",
      lightMuted: "#ffffff",
      rgbDominant: [255, 0, 0],
      rgbVibrant: [0, 255, 0],
      rgbSecondary: [0, 0, 255],
    });
    vi.advanceTimersByTime(200);
    expect(frames()).toBeGreaterThan(afterSettle);
  });
});
