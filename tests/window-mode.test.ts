import { describe, it, expect, vi } from "vitest";
import {
  centeredFrame,
  clampFrame,
  collectRegions,
  resizeFrame,
  setOptimisticMaximized,
  subscribeWindowMode,
  toggleMaximizeAnimated,
  widthBands,
} from "../src/lib/window-mode";

describe("collectRegions", () => {
  function part(className: string, rect: Partial<DOMRect>): HTMLElement {
    const node = document.createElement("div");
    node.className = className;
    node.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect }) as DOMRect;
    return node;
  }

  it("reports visible panels rounded outward and skips hidden ones", () => {
    const root = document.createElement("div");
    root.append(
      part("main", { left: 70.4, top: 58.6, right: 900.2, bottom: 640.1, width: 829.8, height: 581.5 }),
      part("queue-panel", {}),
      part("player", { left: 200, top: 660, right: 800, bottom: 724, width: 600, height: 64 }),
    );

    expect(collectRegions(root)).toEqual([
      { x: 70, y: 58, width: 831, height: 583 },
      { x: 200, y: 660, width: 600, height: 64 },
    ]);
  });

  it("includes open dialog elements in interactive click regions", () => {
    const root = document.createElement("div");
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    dialog.getBoundingClientRect = () =>
      ({ left: 300, top: 200, right: 680, bottom: 500, width: 380, height: 300 }) as DOMRect;
    root.appendChild(dialog);

    expect(collectRegions(root)).toEqual([{ x: 300, y: 200, width: 380, height: 300 }]);
  });

  it("keeps an open song menu clickable in floating mode", () => {
    const root = document.createElement("div");
    root.append(part("song-context-menu", { left: 420, top: 500, right: 628, bottom: 700, width: 208, height: 200 }));
    expect(collectRegions(root)).toEqual([{ x: 420, y: 500, width: 208, height: 200 }]);
  });

  it("keeps the titlebar and resize handles interactive in the floating layout", () => {
    const root = document.createElement("div");
    root.append(
      part("titlebar", { left: 70, top: 10, right: 900, bottom: 54, width: 830, height: 44 }),
      part("window-resize-handle", { left: 0, top: 14, right: 8, bottom: 700, width: 8, height: 686 }),
    );
    expect(collectRegions(root)).toEqual([
      { x: 70, y: 10, width: 830, height: 44 },
      { x: 0, y: 14, width: 8, height: 686 },
    ]);
  });

  it("updates window mode dataset and subscribers immediately on optimistic maximize", () => {
    const spy = vi.fn();
    const unsub = subscribeWindowMode(spy);
    try {
      setOptimisticMaximized(true);
      expect(document.documentElement.dataset.window).toBe("full");
      setOptimisticMaximized(false);
      expect(document.documentElement.dataset.window).toBe("floating");
      expect(spy).toHaveBeenLastCalledWith({ mode: "floating", maximized: false });
    } finally {
      unsub();
    }
  });
});

describe("floating frame geometry", () => {
  const screen = { width: 1920, height: 1040 };

  it("centers the default floating window", () => {
    expect(centeredFrame(screen)).toEqual({ x: 370, y: 130, width: 1180, height: 780 });
  });

  it("keeps the frame at least its minimum size and inside the screen", () => {
    expect(clampFrame({ x: -50, y: 900, width: 500, height: 300 }, screen)).toEqual({ x: 0, y: 440, width: 940, height: 600 });
    expect(clampFrame({ x: 100, y: 100, width: 4000, height: 3000 }, screen)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it("resizes from any edge, holding the opposite edges", () => {
    const start = { x: 400, y: 200, width: 1000, height: 700 };
    expect(resizeFrame(start, "East", 120, 0, screen)).toEqual({ x: 400, y: 200, width: 1120, height: 700 });
    expect(resizeFrame(start, "NorthWest", -50, -40, screen)).toEqual({ x: 350, y: 160, width: 1050, height: 740 });
    // Never below the minimum: the right edge stays at 1400.
    expect(resizeFrame(start, "West", 500, 0, screen)).toEqual({ x: 460, y: 200, width: 940, height: 700 });
    // Never past the screen edge.
    expect(resizeFrame(start, "SouthEast", 2000, 2000, screen)).toEqual({ x: 400, y: 200, width: 1520, height: 840 });
  });

  it("maps frame widths to the bands that replaced the viewport media queries", () => {
    expect(widthBands(1180)).toEqual(["fw-max-1200", "fw-min-1040"]);
    expect(widthBands(700)).toEqual(["fw-max-700", "fw-max-720", "fw-max-820", "fw-max-1100", "fw-max-1200"]);
    expect(widthBands(1920)).toEqual(["fw-min-1040"]);
  });
});

describe("toggleMaximizeAnimated", () => {
  it("switches the layout in the page without touching the OS window", async () => {
    setOptimisticMaximized(false);
    const appWindow = { toggleMaximize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn() };
    await toggleMaximizeAnimated(appWindow);
    expect(document.documentElement.dataset.window).toBe("full");
    await toggleMaximizeAnimated(appWindow);
    expect(document.documentElement.dataset.window).toBe("floating");
    expect(appWindow.toggleMaximize).not.toHaveBeenCalled();
    expect(appWindow.maximize).not.toHaveBeenCalled();
  });

  it("places the floating layout in the frame through CSS variables", () => {
    setOptimisticMaximized(false);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--frame-w")).toMatch(/px$/);
    setOptimisticMaximized(true);
    expect(style.getPropertyValue("--frame-w")).toBe("");
  });
});
