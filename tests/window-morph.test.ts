import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  boxTrack,
  cubicBezier,
  playMorph,
  SurfaceMorph,
  rebase,
  slideFlip,
  stretchFlip,
  type Box,
  type LayoutSnapshot,
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


  it("surface morph: stand-ins take the panels' look, travel as exact boxes, then hand back", async () => {
    vi.useFakeTimers();
    try {
      const app = document.getElementById("app")!;
      const morph = new SurfaceMorph(floating, full, {});
      const layers = document.querySelectorAll(".window-morph-layer");
      expect(layers).toHaveLength(2);
      // Back layer under #app (the window background), front layer over it.
      expect(app.previousElementSibling?.classList.contains("window-morph-layer--back")).toBe(true);
      const main = document.querySelector<HTMLElement>(".window-morph-surface--main")!;
      expect([main.style.left, main.style.width]).toEqual(["84px", "800px"]);
      // The real interface fades out, then stays fully hidden (and undrawn) while the surfaces travel.
      expect(calls.find((c) => c.node === app)!.keyframes.at(-1)).toEqual({ opacity: 0 });

      vi.advanceTimersByTime(100);
      await morph.ready;
      morph.travel();
      expect(app.style.opacity).toBe("0");
      expect([main.style.left, main.style.width]).toEqual(["250px", "1650px"]);
      const move = calls.filter((c) => c.node === main).at(-1)!;
      expect(move.keyframes).toEqual([{ transform: stretchFlip(box(84, 64, 800, 500), box(250, 60, 1650, 900)) }, { transform: "none" }]);
      // Panels that only exist in the new layout appear as a stand-in too.
      expect(document.querySelector(".window-morph-surface--queue")).not.toBeNull();
      // Nothing that holds images is scaled: only stand-ins and #app opacity animate.
      for (const call of calls) {
        if (call.keyframes.some((k) => String(k.transform ?? "").includes("scale"))) {
          expect(call.node.classList.contains("window-morph-surface")).toBe(true);
        }
      }

      vi.advanceTimersByTime(1000);
      await morph.finished;
      expect(document.querySelector(".window-morph-layer")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

