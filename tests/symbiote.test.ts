import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DIRECTIONS,
  REVEAL_MODES,
  SEQUENCE_MAX_MS,
  detectTaskbarEdge,
  edgeSpawn,
  initRestoreAnimation,
  inwardVector,
  isPlausibleGeometry,
  isSymbioteAnimating,
  liquidColors,
  nearestDirection,
  oppositeDirection,
  parseColor,
  pickMode,
  planReveal,
  playLaunchAnimation,
  prepareMinimize,
  primeLaunch,
  resetSymbioteState,
  screenBoundsInWindow,
  setLiquidPalette,
  taskbarAnchor,
  triggerRestoreAnimation,
  type Rect,
  type ScreenGeometry,
} from "../src/lib/visuals/symbiote";

/** Deterministic rng for plan tests. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const viewport = { width: 1600, height: 900 };
const shell: Rect[] = [
  { x: 8, y: 0, width: 160, height: 40 }, // titlebar left
  { x: 600, y: 0, width: 400, height: 40 }, // search
  { x: 1450, y: 0, width: 142, height: 40 }, // window controls
  { x: 8, y: 48, width: 240, height: 760 }, // sidebar
  { x: 256, y: 48, width: 1336, height: 760 }, // main
];

const geometry = (overrides: Partial<ScreenGeometry> = {}): ScreenGeometry => ({
  screenX: 0,
  screenY: 0,
  innerWidth: 1600,
  innerHeight: 900,
  screenWidth: 1920,
  screenHeight: 1080,
  availLeft: 0,
  availTop: 0,
  availWidth: 1920,
  availHeight: 1032,
  monitorLeft: 0,
  monitorTop: 0,
  ...overrides,
});

describe("symbiote — geometry", () => {
  it("finds the taskbar on every side of the monitor", () => {
    expect(detectTaskbarEdge(geometry())).toBe("bottom");
    expect(detectTaskbarEdge(geometry({ availTop: 48 }))).toBe("top");
    expect(detectTaskbarEdge(geometry({ availHeight: 1080, availWidth: 1872, availLeft: 48 }))).toBe("left");
    expect(detectTaskbarEdge(geometry({ availHeight: 1080, availWidth: 1872 }))).toBe("right");
  });

  it("works on a secondary monitor without knowing the monitor origin", () => {
    const unknown = { monitorLeft: undefined, monitorTop: undefined };
    expect(detectTaskbarEdge(geometry({ availLeft: 1920, ...unknown }))).toBe("bottom");
    expect(detectTaskbarEdge(geometry({ availLeft: 1920, availTop: 48, ...unknown }))).toBe("top");
  });

  it("anchors the art flight at the taskbar, relative to the window", () => {
    const anchor = taskbarAnchor(geometry({ screenX: 160, screenY: 90 }));
    expect(anchor.edge).toBe("bottom");
    expect(anchor.x).toBe(960 - 160);
    expect(anchor.y).toBe(1056 - 90);
  });

  it("follows the window wherever it was dragged", () => {
    const before = taskbarAnchor(geometry({ screenX: 100, screenY: 50 }));
    const after = taskbarAnchor(geometry({ screenX: 400, screenY: 20 }));
    expect(after.x - before.x).toBe(-300);
    expect(after.y - before.y).toBe(30);
  });

  it("maps the whole screen into window coordinates, also on other monitors", () => {
    expect(screenBoundsInWindow(geometry({ screenX: 300, screenY: 120 }))).toEqual({
      left: -300,
      top: -120,
      right: 1620,
      bottom: 960,
    });
    const second = geometry({ screenX: 2000, screenY: 100, availLeft: 1920, monitorLeft: 1920 });
    expect(screenBoundsInWindow(second).left).toBe(-80);
  });

  it("spawns tendrils on the screen edges, not the window edges", () => {
    const screen = { left: -300, top: -120, right: 1620, bottom: 960 };
    const target = { x: 400, y: 300 };
    expect(edgeSpawn("left", target, screen, 30).x).toBe(-330);
    expect(edgeSpawn("right", target, screen, 30).x).toBe(1650);
    expect(edgeSpawn("top", target, screen, 30).y).toBe(-150);
    expect(edgeSpawn("bottom", target, screen, 30).y).toBe(990);
    for (let i = 0; i < 20; i++) {
      const p = edgeSpawn("bottom-right", target, screen, 30);
      expect(p.x).toBeGreaterThanOrEqual(1620 - 1920 * 0.15);
      expect(p.y).toBeGreaterThanOrEqual(960 - 1080 * 0.15);
    }
  });

  it("ignores the parked position Windows reports while minimized", () => {
    expect(isPlausibleGeometry(geometry())).toBe(true);
    expect(isPlausibleGeometry(geometry({ screenX: -32000, screenY: -32000 }))).toBe(false);
  });

  it("names the edge or corner a panel sits against", () => {
    expect(nearestDirection(shell[3], viewport)).toBe("left");
    expect(nearestDirection(shell[0], viewport)).toBe("top-left");
    expect(nearestDirection(shell[2], viewport)).toBe("top-right");
    expect(nearestDirection(shell[1], viewport)).toBe("top");
  });

  it("has an inward unit vector and an opposite for every direction", () => {
    for (const d of DIRECTIONS) {
      const v = inwardVector(d);
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
      expect(oppositeDirection(oppositeDirection(d))).toBe(d);
      const o = inwardVector(oppositeDirection(d));
      expect(o.x).toBeCloseTo(-v.x);
      expect(o.y).toBeCloseTo(-v.y);
    }
  });
});

describe("symbiote — plans", () => {
  it("never repeats the previous mode", () => {
    const rng = seeded(7);
    let previous = pickMode(null, rng);
    for (let i = 0; i < 50; i++) {
      const next = pickMode(previous, rng);
      expect(REVEAL_MODES).toContain(next);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it("plans every piece once, with a valid edge and staggered timing", () => {
    for (const mode of REVEAL_MODES) {
      const plans = planReveal(shell, viewport, mode, seeded(3));
      expect(plans.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
      for (const plan of plans) {
        expect(plan.from.length).toBeGreaterThan(0);
        plan.from.forEach((d) => expect(DIRECTIONS).toContain(d));
        expect(plan.start).toBeGreaterThan(0);
        expect(plan.travel).toBeGreaterThan(250);
      }
      expect(new Set(plans.map((p) => p.start)).size).toBe(plans.length);
    }
  });

  it("starts after a given moment (once the album art is on screen)", () => {
    const plans = planReveal(shell, viewport, "scatter", seeded(4), 400);
    plans.forEach((p) => expect(p.start).toBeGreaterThanOrEqual(400));
  });

  it("natural mode brings panels in from their own edge; crossfire from the opposite one", () => {
    const natural = planReveal(shell, viewport, "natural", seeded(1));
    const crossfire = planReveal(shell, viewport, "crossfire", seeded(1));
    expect(natural[3].from).toEqual(["left"]);
    expect(crossfire[3].from).toEqual(["right"]);
  });

  it("sweep mode sends everything from one edge", () => {
    const plans = planReveal(shell, viewport, "sweep", seeded(11));
    const edge = plans[0].from[0];
    plans.forEach((p) => expect(p.from).toEqual([edge]));
  });

  it("swarm mode converges several distinct edges on each panel", () => {
    const plans = planReveal(shell, viewport, "swarm", seeded(5));
    for (const plan of plans) {
      expect(plan.from.length).toBeGreaterThanOrEqual(2);
      expect(new Set(plan.from).size).toBe(plan.from.length);
    }
  });

  it("varies from one restore to the next", () => {
    const a = planReveal(shell, viewport, "scatter", seeded(1));
    const b = planReveal(shell, viewport, "scatter", seeded(2));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("symbiote — liquid colors", () => {
  it("parses hex and rgb colors", () => {
    expect(parseColor("#ff8800")).toEqual([255, 136, 0]);
    expect(parseColor("#f80")).toEqual([255, 136, 0]);
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseColor("nope")).toBeNull();
  });

  it("is a black symbiote when nothing is playing", () => {
    const colors = liquidColors(null, "#123456");
    colors.fills.forEach((c) => expect(Math.max(...c)).toBeLessThan(20));
    expect(colors.rim).toBe("#123456");
  });

  it("takes the hues of the playing artwork, deep enough to read as liquid", () => {
    const colors = liquidColors({ vibrant: "#ff2d55", dominant: "#1e90ff", secondary: "#ffd60a" });
    const [red, blue, yellow] = colors.fills;
    expect(red[0]).toBeGreaterThan(red[1] + 30);
    expect(blue[2]).toBeGreaterThan(blue[0] + 30);
    expect(yellow[0]).toBeGreaterThan(yellow[2] + 30);
    colors.fills.forEach((c) => expect(Math.max(...c)).toBeLessThan(170));
    expect(parseColor(colors.rim)![0]).toBeGreaterThan(200);
  });
});

describe("symbiote restore — runtime", () => {
  beforeEach(() => {
    resetSymbioteState();
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
    document.body.innerHTML = `
      <div id="app">
        <div class="titlebar"><div class="titlebar__left"></div><div class="titlebar__right"></div></div>
        <div class="sidebar"></div>
        <div class="main"></div>
        <div class="player"><div class="player__artwork"><img src="/cover.jpg"></div></div>
      </div>`;
  });

  afterEach(() => {
    resetSymbioteState();
    setLiquidPalette(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("flies a copy of the current album art and cleans up afterwards", () => {
    setLiquidPalette({ vibrant: "#ff2d55", dominant: "#1e90ff", secondary: "#ffd60a" });
    expect(triggerRestoreAnimation({ mode: "natural" })).toBe(true);
    expect(isSymbioteAnimating()).toBe(true);
    expect(document.documentElement.classList.contains("app--restoring")).toBe(true);
    expect(document.documentElement.dataset.symbioteMode).toBe("natural");
    expect(document.querySelector(".symbiote-flyer--disc img")?.getAttribute("src")).toBe("/cover.jpg");

    vi.advanceTimersByTime(SEQUENCE_MAX_MS + 100);
    expect(isSymbioteAnimating()).toBe(false);
    expect(document.querySelector(".symbiote-flyer")).toBeNull();
    expect(document.querySelector(".symbiote-canvas")).toBeNull();
    expect(document.documentElement.classList.contains("app--restoring")).toBe(false);
  });

  it("falls back to the Sonora logo when nothing is playing", () => {
    document.querySelector(".player__artwork")!.innerHTML = "";
    triggerRestoreAnimation({ force: true });
    expect(document.querySelector(".symbiote-flyer--disc img")?.getAttribute("src")).toBe("/sonora-logo.svg");
  });

  it("ignores a second trigger for the same restore", () => {
    expect(triggerRestoreAnimation()).toBe(true);
    expect(triggerRestoreAnimation()).toBe(false);
    expect(triggerRestoreAnimation({ force: true })).toBe(true);
  });

  it("respects reduced motion and never leaves the shell hidden", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {} }));
    document.documentElement.classList.add("symbiote-primed");
    expect(triggerRestoreAnimation()).toBe(false);
    expect(document.querySelector(".symbiote-flyer")).toBeNull();
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(false);
  });

  it("skips to the finished interface on a click", () => {
    triggerRestoreAnimation({ force: true });
    window.dispatchEvent(new Event("pointerdown"));
    expect(isSymbioteAnimating()).toBe(false);
  });

  it("fades the shell out before minimizing, then plays on the way back", async () => {
    initRestoreAnimation();
    const ready = prepareMinimize();
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(true);
    vi.advanceTimersByTime(200);
    await ready;
    window.dispatchEvent(new Event("focus"));
    expect(isSymbioteAnimating()).toBe(true);
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(false);
  });

  it("plays after a minimize, but not on plain focus changes", () => {
    initRestoreAnimation();

    // Alt+Tab away and back: no replay
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(isSymbioteAnimating()).toBe(false);

    // Minimized: the shell is hidden ahead of the restore
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(true);

    vi.advanceTimersByTime(1000);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isSymbioteAnimating()).toBe(true);
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(false);

    // The focus that follows the same restore does not start it again
    const art = document.querySelector(".symbiote-flyer");
    window.dispatchEvent(new Event("focus"));
    expect(document.querySelector(".symbiote-flyer")).toBe(art);
  });
});

describe("symbiote launch", () => {
  beforeEach(() => {
    resetSymbioteState();
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
    document.body.innerHTML = `
      <div id="app">
        <div class="sidebar"><span class="sidebar__brand-icon"></span></div>
        <div class="main"></div>
        <div class="player"><div class="player__artwork"></div></div>
      </div>`;
  });

  afterEach(() => {
    resetSymbioteState();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hides the shell until the window is up, then flies the logo in", async () => {
    expect(primeLaunch()).toBe(true);
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(true);

    const done = playLaunchAnimation();
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(false);
    expect(document.documentElement.dataset.symbiote).toBe("launch");
    expect(document.querySelector(".symbiote-flyer--logo svg")).not.toBeNull();

    vi.advanceTimersByTime(SEQUENCE_MAX_MS + 100);
    await done;
    expect(isSymbioteAnimating()).toBe(false);
    expect(document.querySelector(".symbiote-flyer")).toBeNull();
  });

  it("plays once per launch unless forced", async () => {
    const first = playLaunchAnimation();
    vi.advanceTimersByTime(SEQUENCE_MAX_MS + 100);
    await first;
    expect(primeLaunch()).toBe(false);
    await playLaunchAnimation();
    expect(isSymbioteAnimating()).toBe(false);
    void playLaunchAnimation({ force: true });
    expect(isSymbioteAnimating()).toBe(true);
  });

  it("skips to the finished interface on a click", async () => {
    const done = playLaunchAnimation();
    window.dispatchEvent(new Event("pointerdown"));
    await done;
    expect(isSymbioteAnimating()).toBe(false);
    expect(document.querySelector(".symbiote-canvas")).toBeNull();
  });

  it("never leaves the shell hidden if the window is never presented", () => {
    primeLaunch();
    vi.advanceTimersByTime(6000);
    expect(document.documentElement.classList.contains("symbiote-primed")).toBe(false);
  });
});
