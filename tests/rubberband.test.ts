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
    expect(el.classList.contains("is-stretching")).toBe(true);

    // Advance idle timer to trigger rebound
    vi.advanceTimersByTime(120);
    expect(controller.offset.y).toBe(0);
    expect(el.classList.contains("is-stretching")).toBe(false);
    expect(el.classList.contains("is-rebounding")).toBe(true);

    // Interrupting a rebound with a new scroll clears is-rebounding immediately
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 30 }));
    expect(controller.offset.y).toBeLessThan(0);
    expect(el.classList.contains("is-rebounding")).toBe(false);
    expect(el.classList.contains("is-stretching")).toBe(true);

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

  it("pulls continuously while scrolling in the middle and rebounds on idle", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollTop", { value: 200, writable: true });
    Object.defineProperty(el, "clientHeight", { value: 400 });
    Object.defineProperty(el, "scrollHeight", { value: 1000 });
    document.body.appendChild(el);

    const controller = attachRubberband(el, { axis: "vertical", maxOffset: 12 });

    // Scrolling upwards mid-list pulls downwards (+y)
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 }));
    expect(controller.offset.y).toBeGreaterThan(0);
    expect(controller.offset.y).toBeLessThanOrEqual(12);

    // Scrolling downwards pulls upwards (-y)
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    expect(controller.offset.y).toBeLessThan(0);

    // Rebounds to 0 after stopping
    vi.advanceTimersByTime(120);
    expect(controller.offset.y).toBe(0);

    controller.destroy();
    el.remove();
  });

  it("initializes across main scroll containers, avoids queue double-bounce, and syncs floating stage", () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="ambient-art"></div>
        <main class="main"><div class="main__scroll-content"></div></main>
        <nav class="sidebar"></nav>
        <div class="queue-panel"><div class="queue-panel__list"><div class="queue-panel__list-content"></div></div></div>
        <div class="shelf__scroll"></div>
      </div>
    `;

    initRubberbandUX(document.body);

    const app = document.querySelector<HTMLElement>("#app")!;
    const main = document.querySelector<HTMLElement>("main.main")!;
    const sidebar = document.querySelector(".sidebar");
    const queuePanel = document.querySelector<HTMLElement>(".queue-panel")!;
    const queueList = document.querySelector<HTMLElement>(".queue-panel__list")!;
    const shelf = document.querySelector(".shelf__scroll");

    expect(main.classList.contains("rubberband-target")).toBe(true);
    expect(sidebar?.classList.contains("rubberband-target")).toBe(false);
    expect(queuePanel.classList.contains("rubberband-target")).toBe(true);
    expect(queueList.classList.contains("rubberband-target")).toBe(false);
    expect(shelf?.classList.contains("rubberband-target")).toBe(true);

    // Queue list scrolling stretches only the outer .queue-panel shell (never .queue-panel__list)
    Object.defineProperty(queueList, "scrollTop", { value: 100, writable: true });
    Object.defineProperty(queueList, "clientHeight", { value: 300 });
    Object.defineProperty(queueList, "scrollHeight", { value: 800 });
    queueList.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }));
    expect(queuePanel.classList.contains("is-stretching")).toBe(true);
    expect(queueList.classList.contains("is-stretching")).toBe(false);

    // Main stage mirrors stretch/rebound state onto #app so floating frame moves in lockstep
    Object.defineProperty(main, "scrollTop", { value: 100, writable: true });
    Object.defineProperty(main, "clientHeight", { value: 400 });
    Object.defineProperty(main, "scrollHeight", { value: 1200 });
    main.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }));
    expect(main.classList.contains("is-stretching")).toBe(true);
    expect(app.classList.contains("is-stage-stretching")).toBe(true);
    expect(app.style.getPropertyValue("--stage-rubberband-y")).not.toBe("");

    vi.advanceTimersByTime(120);
    expect(app.classList.contains("is-stage-stretching")).toBe(false);
    expect(app.classList.contains("is-stage-rebounding")).toBe(true);

    vi.advanceTimersByTime(400);
    expect(app.classList.contains("is-stage-rebounding")).toBe(false);

    // Main stage ignores wheel rubberband when Now Playing is mounted
    const np = document.createElement("div");
    np.className = "now-playing";
    main.appendChild(np);
    main.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }));
    expect(main.classList.contains("is-stretching")).toBe(false);
  });
});
