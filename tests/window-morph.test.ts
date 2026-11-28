import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  boxTrack,
  cubicBezier,
  MORPH_MS,
  LIVE_CLASS,
  parseRadius,
  playMorph,
  cornersAt,
  SurfaceMorph,
  rebase,
  rideOutline,
  slideFlip,
  stretchFlip,
  type Box,
  type LayoutSnapshot,
  type Surface,
} from "../src/lib/window-morph";

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

function snapshot(
  mode: "floating" | "full",
  screen: { x: number; y: number },
  parts: LayoutSnapshot["parts"],
  app: Box,
): LayoutSnapshot {
  return { mode, screen, app, stage: mode === "floating" && parts.main ? parts.main : app, queueOpen: false, parts };
}

describe("window morph geometry", () => {
  it("rebases a box between two window positions so it stays put on screen", () => {
    const floating = snapshot("floating", { x: 300, y: 200 }, {}, box(0, 0, 1000, 700));
    const full = snapshot("full", { x: 0, y: 0 }, {}, box(0, 0, 1920, 1040));
    expect(rebase(box(40, 60, 100, 38), floating, full)).toEqual(box(340, 260, 100, 38));
  });

  it("stretches a box exactly onto the source box", () => {
    expect(stretchFlip(box(100, 50, 800, 500), box(0, 0, 1600, 1000))).toBe("translate(100px, 50px) scale(0.5, 0.5)");
  });

  it("solves the easing curve", () => {
    expect(cubicBezier([0.2, 0, 0, 1], 0)).toBe(0);
    expect(cubicBezier([0.2, 0, 0, 1], 1)).toBe(1);
    // Emphasized deceleration: well past halfway by the middle of the time.
    expect(cubicBezier([0.2, 0, 0, 1], 0.5)).toBeGreaterThan(0.75);
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3);
  });

  it("counter-scales contents so they keep their size at every frame", () => {
    const track = boxTrack(box(0, 0, 1600, 900), box(100, 50, 400, 600), box(0, 0, 1600, 900));
    expect(track.outer).toHaveLength(track.inner.length);
    const scale = (t: string) => t.match(/scale\(([^,]+), ([^)]+)\)/)!.slice(1).map(Number);
    track.outer.forEach((frame, i) => {
      const [sx, sy] = scale(frame.transform as string);
      const [ix, iy] = scale(track.inner[i].transform as string);
      expect(sx * ix).toBeCloseTo(1, 2);
      expect(sy * iy).toBeCloseTo(1, 2);
      expect(track.inner[i].offset).toBe(frame.offset);
    });
    expect(track.outer[0].transform).toBe(stretchFlip(box(100, 50, 400, 600), box(0, 0, 1600, 900)));
    expect(track.outer.at(-1)!.transform).toBe("translate(0px, 0px) scale(1, 1)");
  });

  it("slides without scaling", () => {
    expect(slideFlip(box(0, 0, 100, 40), box(100, 100, 300, 40))).toBe("translate(-200px, -100px)");
  });
});

describe("morph animations", () => {
  let calls: Array<{ node: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions }>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <div class="main"><section class="view"></section></div>
        <div class="sidebar"><nav></nav></div>
        <div class="queue-panel"></div>
      </div>`;
    calls = [];
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = vi.fn(function (
      this: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      calls.push({ node: this, keyframes, options });
      return { finished: Promise.resolve(), cancel() {} };
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  const floating = snapshot(
    "floating",
    { x: 300, y: 200 },
    { main: box(84, 64, 800, 500), sidebar: box(14, 64, 56, 400) },
    box(0, 0, 1000, 700),
  );
  const full = snapshot(
    "full",
    { x: 0, y: 0 },
    { main: box(250, 60, 1650, 900), sidebar: box(10, 60, 230, 900), queue: box(1600, 60, 300, 900) },
    box(0, 0, 1920, 1040),
  );
  const only = (cls: string) => calls.filter((c) => c.node.classList.contains(cls));
  const transformsOnly = () => {
    for (const call of calls) {
      for (const frame of call.keyframes) {
        expect(Object.keys(frame).every((k) => k === "transform" || k === "opacity" || k === "offset")).toBe(true);
      }
    }
  };

  it("starts every panel exactly on its old screen box, in step with the stage", async () => {
    const morph = playMorph(floating, full);
    const main = only("main")[0];
    // The old main box sat at (384, 264) on screen.
    expect(main.keyframes[0].transform).toBe(stretchFlip(box(384, 264, 800, 500), full.parts.main!));
    expect(main.keyframes.at(-1)!.transform).toBe("translate(0px, 0px) scale(1, 1)");
    const stage = calls.find((c) => c.options.pseudoElement === "::before")!;
    expect(stage.keyframes[0].transform).toBe(stretchFlip(box(384, 264, 800, 500), full.stage));
    // Stage and panel share the sampled timeline.
    expect(stage.keyframes.map((k) => k.offset)).toEqual(main.keyframes.map((k) => k.offset));
    transformsOnly();
    await morph.finished;
  });

  it("fades panel contents in during the move", async () => {
    const morph = playMorph(floating, full);
    const view = calls.find((c) => c.node.classList.contains("view") && c.keyframes[0].opacity !== undefined)!;
    expect(view.keyframes[0].opacity).toBeLessThan(1);
    expect(view.keyframes.at(-1)!.opacity).toBe(1);
    await morph.finished;
  });

  it("fades in panels that only exist in the new layout", async () => {
    const morph = playMorph(floating, full);
    expect(only("queue-panel")[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    await morph.finished;
  });

  it("grows the window background out of the old stage when maximizing", async () => {
    const morph = playMorph(floating, full);
    const backdrop = document.querySelector<HTMLElement>(".window-morph-backdrop")!;
    expect(backdrop.nextElementSibling?.id).toBe("app");
    const anim = calls.find((c) => c.node === backdrop)!;
    expect(anim.keyframes[0]).toMatchObject({ transform: stretchFlip(box(384, 264, 800, 500), full.app), opacity: 0 });
    expect(anim.keyframes.at(-1)).toMatchObject({ transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 });
    await morph.finished;
    expect(document.querySelector(".window-morph-backdrop")).toBeNull();
  });

  it("keeps large surfaces still in lite mode: small pieces slide, nothing scales", async () => {
    const morph = playMorph(floating, full, document, { lite: true });
    expect(only("sidebar")[0].keyframes[0].transform).toMatch(/^translate\([^)]*\)$/);
    expect(only("main")[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    for (const call of calls) {
      for (const frame of call.keyframes) expect(String(frame.transform ?? "")).not.toContain("scale");
    }
    await morph.finished;
  });


  const look = (radius: string, color: string): Surface => ({ image: "none", color, radius, border: "0px none", shadow: "none" });

  it("live morph: the real panels ride their outlines at their real size", async () => {
    vi.useFakeTimers();
    try {
      const app = document.getElementById("app")!;
      const mainNode = document.querySelector<HTMLElement>(".main")!;
      const morph = new SurfaceMorph(floating, full, {
        before: { main: look("26px", "rgb(1, 1, 1)"), sidebar: look("28px", "rgb(2, 2, 2)") },
        after: { main: look("16px", "rgb(3, 3, 3)"), sidebar: look("16px", "rgb(4, 4, 4)"), queue: look("16px", "rgb(5, 5, 5)") },
      });
      // The fills sit under #app; the interface itself is never hidden.
      expect(app.previousElementSibling?.classList.contains("window-morph-layer")).toBe(true);
      expect(document.documentElement.classList.contains(LIVE_CLASS)).toBe(true);
      expect(calls.some((c) => c.node === app)).toBe(false);

      // The real page only moves: no scale, so its pictures are never redrawn at a new size.
      const panel = calls.filter((c) => c.node === mainNode);
      const move = panel.find((c) => c.keyframes[0].transform !== undefined)!;
      expect(move.keyframes).toEqual([{ transform: "translate(-166px, 4px)" }, { transform: "none" }]);
      for (const call of calls) {
        if (call.keyframes.some((k) => String(k.transform ?? "").includes("scale"))) {
          expect(call.node.classList.contains("window-morph-surface")).toBe(true);
        }
      }
      // Growing, it is cut down to its outline, and the clip is its own animation.
      const clip = panel.find((c) => c.keyframes[0].clipPath !== undefined)!;
      expect(clip.keyframes[0].clipPath).toBe("inset(0px 850px 400px 0px round 26px 26px 26px 26px)");
      expect(clip.keyframes.at(-1)!.clipPath).toBe("inset(0px 0px 0px 0px round 16px 16px 16px 16px)");
      expect(clip.keyframes.every((k) => k.transform === undefined)).toBe(true);

      // Its fill travels as an exact box, turning from the old look into the new one.
      const ghost = document.querySelector<HTMLElement>(".window-morph-surface--main")!;
      expect([ghost.style.left, ghost.style.width]).toEqual(["250px", "1650px"]);
      expect(calls.find((c) => c.node === ghost)!.keyframes[0].transform).toBe(stretchFlip(box(84, 64, 800, 500), box(250, 60, 1650, 900)));
      const skins = ghost.querySelectorAll<HTMLElement>(".window-morph-skin");
      expect(Array.from(skins, (s) => s.style.backgroundColor)).toEqual(["rgb(1, 1, 1)", "rgb(3, 3, 3)"]);

      // A panel new to the layout fades in where it lands.
      const queue = document.querySelector<HTMLElement>(".queue-panel")!;
      expect(calls.find((c) => c.node === queue)!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);

      // Landing: the fills go and the panels take their own back, in one go.
      vi.advanceTimersByTime(MORPH_MS);
      expect(document.querySelector(".window-morph-surface--main")).toBeNull();
      expect(document.documentElement.classList.contains(LIVE_CLASS)).toBe(false);
      // The window background stays until the morph ends.
      expect(document.querySelector(".window-morph-surface--backdrop")).not.toBeNull();

      vi.advanceTimersByTime(1000);
      await morph.finished;
      expect(document.querySelector(".window-morph-layer")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("live morph: shrinking, a panel is never clipped and only follows its outline", async () => {
    vi.useFakeTimers();
    try {
      const morph = new SurfaceMorph(full, floating, {
        before: { main: look("16px", "rgb(3, 3, 3)"), sidebar: look("16px", "rgb(4, 4, 4)") },
        after: { main: look("26px", "rgb(1, 1, 1)"), sidebar: look("9999px", "rgb(2, 2, 2)") },
      });
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      expect(calls.filter((c) => c.node === sidebar).every((c) => c.keyframes[0].clipPath === undefined)).toBe(true);
      // The capsule lands with half its 56px width as radius, not 9999px.
      const skins = document.querySelectorAll<HTMLElement>(".window-morph-surface--sidebar .window-morph-skin");
      expect(skins[1].style.borderRadius).toBe("28px");
      // The queue, gone from the floating layout, fades where it was.
      const queue = document.querySelector<HTMLElement>(".window-morph-surface--queue")!;
      expect(calls.find((c) => c.node === queue)!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
      vi.advanceTimersByTime(2000);
      await morph.finished;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("live morph geometry", () => {
  it("reads computed radii per corner", () => {
    const b = box(0, 0, 200, 64);
    expect(parseRadius("26px", b)).toEqual([26, 26, 26, 26]);
    expect(parseRadius("0px 16px", b)).toEqual([0, 16, 0, 16]);
    expect(parseRadius("1px 2px 3px", b)).toEqual([1, 2, 3, 2]);
    expect(parseRadius("50%", b)).toEqual([32, 32, 32, 32]);
    expect(parseRadius("", b)).toEqual([0, 0, 0, 0]);
  });

  it("divides corners by the scale they are drawn at, so they stay round on screen", () => {
    expect(cornersAt([20, 20, 0, 0], 4, 2)).toBe("5px 5px 0px 0px / 10px 10px 0px 0px");
  });

  it("puts a panel's anchor on its outline's and clips only what sticks out", () => {
    const panel = box(0, 0, 1000, 80);
    // A capsule-sized outline in the middle of the screen, anchored at its middle.
    const ride = rideOutline(panel, box(300, 10, 400, 60), [0.5, 0.5]);
    expect([ride.dx, ride.dy]).toEqual([0, 0]);
    expect(ride.inset).toEqual([10, 300, 10, 300]);
    // Anchored top-left: the clip comes off the right and bottom only.
    expect(rideOutline(panel, box(50, 20, 400, 60), [0, 0])).toEqual({ dx: 50, dy: 20, inset: [0, 600, 20, 0] });
    // A bigger outline never clips.
    expect(rideOutline(panel, box(0, 0, 1200, 100), [0, 0]).inset).toEqual([0, 0, 0, 0]);
  });
});
