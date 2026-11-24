import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateRubberbandOffset,
  attachRubberband,
  initRubberbandUX,
} from "../src/lib/rubberband";

describe("rubberband UX", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("calculates damped elastic offset", () => {
    const step1 = calculateRubberbandOffset(10, 0, 50, 0.5) - 0;
    expect(step1).toBeGreaterThan(0);
    expect(step1).toBeLessThanOrEqual(5);

    // As offset accumulates, resistance increases so incremental step is smaller
    const step2 = calculateRubberbandOffset(10, 30, 50, 0.5) - 30;
    expect(step2).toBeLessThan(step1);
  });

  it("attaches to element, responds to boundary overscroll, and rebounds on idle", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(el, "clientHeight", { value: 400 });
    Object.defineProperty(el, "scrollHeight", { value: 1000 });
    document.body.appendChild(el);

    const controller = attachRubberband(el, { axis: "vertical" });
    expect(el.classList.contains("rubberband-target")).toBe(true);

    // Overscroll top with wheel (deltaY < 0, pulling downwards)
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -25 }));
    expect(controller.offset.y).toBeGreaterThan(0);

    // Advance idle timer to trigger rebound
    vi.advanceTimersByTime(120);
    expect(controller.offset.y).toBe(0);
    expect(el.classList.contains("is-rebounding")).toBe(true);

    // After animation timeout, rebounding class is removed
    vi.advanceTimersByTime(400);
    expect(el.classList.contains("is-rebounding")).toBe(false);

    controller.destroy();
    expect(el.classList.contains("rubberband-target")).toBe(false);
    el.remove();
  });

  it("initializes across main scroll containers", () => {
    document.body.innerHTML = `
      <main class="main"><div class="main__scroll-content"></div></main>
      <nav class="sidebar"></nav>
      <div class="queue-panel"><div class="queue-panel__list"><div class="queue-panel__list-content"></div></div></div>
      <div class="shelf__scroll"></div>
    `;

    initRubberbandUX(document.body);

    const main = document.querySelector("main.main");
    const sidebar = document.querySelector(".sidebar");
    const shelf = document.querySelector(".shelf__scroll");

    expect(main?.classList.contains("rubberband-target")).toBe(true);
    expect(sidebar?.classList.contains("rubberband-target")).toBe(false);
    expect(document.querySelector(".queue-panel")?.classList.contains("rubberband-target")).toBe(true);
    expect(document.querySelector(".queue-panel__list")?.classList.contains("rubberband-target")).toBe(false);
    expect(shelf?.classList.contains("rubberband-target")).toBe(true);
  });
});
