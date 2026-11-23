import { describe, it, expect } from "vitest";
import { collectRegions, modeFor } from "../src/lib/window-mode";

describe("modeFor", () => {
  it("uses the floating layout only at normal size", () => {
    expect(modeFor({ maximized: false, fullscreen: false })).toBe("floating");
    expect(modeFor({ maximized: true, fullscreen: false })).toBe("full");
    expect(modeFor({ maximized: false, fullscreen: true })).toBe("full");
  });
});

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
});
