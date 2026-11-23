import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PLASMA_ORIGINS,
  pickRandomOrigin,
  triggerPlasmaRestore,
  stopPlasmaRestore,
  initPlasmaRestore,
  recordWindowOrigin,
  checkOriginAwareness,
  resolveOriginWithAwareness,
  RESTORE_DURATION_MS,
  type PlasmaOrigin,
} from "../src/lib/visuals/plasma-restore";

describe("plasma-restore", () => {
  beforeEach(() => {
    stopPlasmaRestore();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-plasma-origin");
    document.body.innerHTML = `
      <div id="app">
        <div class="titlebar"></div>
        <div class="sidebar"></div>
        <div class="main"></div>
        <div class="player">
          <div class="player__artwork"></div>
        </div>
      </div>
    `;
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    stopPlasmaRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("includes all required edge and corner origins", () => {
    const required: PlasmaOrigin[] = [
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "all",
    ];
    for (const origin of required) {
      expect(PLASMA_ORIGINS).toContain(origin);
    }
  });

  it("randomly picks an origin from the defined origins list", () => {
    const picked = pickRandomOrigin();
    expect(PLASMA_ORIGINS).toContain(picked);
  });

  it("applies restoring class, origin attribute, and mounts overlay canvas", () => {
    triggerPlasmaRestore("top-left");

    expect(document.documentElement.classList.contains("app--restoring")).toBe(true);
    expect(document.documentElement.getAttribute("data-plasma-origin")).toBe("top-left");

    const canvas = document.querySelector<HTMLCanvasElement>("canvas.plasma-canvas");
    expect(canvas).not.toBeNull();
  });

  it("cleans up classes and removes canvas after restore duration finishes", () => {
    triggerPlasmaRestore("right");

    expect(document.documentElement.classList.contains("app--restoring")).toBe(true);
    expect(document.querySelector("canvas.plasma-canvas")).not.toBeNull();

    // Advance beyond the animation duration
    vi.advanceTimersByTime(RESTORE_DURATION_MS + 100);

    expect(document.documentElement.classList.contains("app--restoring")).toBe(false);
    expect(document.documentElement.getAttribute("data-plasma-origin")).toBeNull();
    expect(document.querySelector("canvas.plasma-canvas")).toBeNull();
  });

  it("respects prefers-reduced-motion by bypassing restore animation", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener() {},
    }));

    triggerPlasmaRestore("bottom");

    expect(document.documentElement.classList.contains("app--restoring")).toBe(false);
    expect(document.querySelector("canvas.plasma-canvas")).toBeNull();
  });

  it("triggers restore animation on window visibility change after being hidden", () => {
    initPlasmaRestore();

    // Simulate minimize (hidden)
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Fast-forward past any initial debounce window
    vi.advanceTimersByTime(1000);

    // Simulate unminimize/restore (visible)
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(document.documentElement.classList.contains("app--restoring")).toBe(true);
    expect(document.querySelector("canvas.plasma-canvas")).not.toBeNull();
  });

  it("checks origin awareness and applies screen geometry and taskbar properties", () => {
    const originState = recordWindowOrigin();
    expect(originState).toBeDefined();
    expect(originState.taskbarEdge).toBeDefined();
    expect(PLASMA_ORIGINS).toContain(originState.nearestScreenEdge);

    const checked = checkOriginAwareness();
    expect(checked).toEqual(originState);

    const resolved = resolveOriginWithAwareness({ preferTaskbar: true });
    expect(resolved.origin).toBe(originState.taskbarEdge);

    triggerPlasmaRestore(undefined, { originAware: true });

    expect(document.documentElement.classList.contains("app--restoring")).toBe(true);
    expect(document.documentElement.getAttribute("data-plasma-origin-aware")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--plasma-taskbar")).toBe(
      originState.taskbarEdge,
    );
  });
});
