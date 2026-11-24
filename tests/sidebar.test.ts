import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSidebar } from "../src/components/sidebar";

describe("Sidebar tap jiggle", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.querySelector(".about-popup")?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("triggers a tap jiggle when clicking navigation or brand buttons and clears on animationend", () => {
    const sidebar = createSidebar();
    document.body.appendChild(sidebar);

    const navLink = sidebar.querySelector<HTMLElement>(".sidebar__link")!;
    navLink.click();
    expect(sidebar.classList.contains("sidebar--jiggle")).toBe(true);

    const endEvent = new Event("animationend", { bubbles: false }) as AnimationEvent;
    Object.defineProperty(endEvent, "animationName", { value: "sidebarTapJiggle" });
    sidebar.dispatchEvent(endEvent);
    expect(sidebar.classList.contains("sidebar--jiggle")).toBe(false);

    const brand = sidebar.querySelector<HTMLElement>(".sidebar__brand")!;
    brand.click();
    expect(sidebar.classList.contains("sidebar--jiggle")).toBe(true);
  });

  it("does not jiggle on wheel events or when reduced motion is preferred", () => {
    const sidebar = createSidebar();
    document.body.appendChild(sidebar);

    sidebar.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }));
    expect(sidebar.classList.contains("sidebar--jiggle")).toBe(false);

    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {} }));
    sidebar.querySelector<HTMLElement>(".sidebar__link")!.click();
    expect(sidebar.classList.contains("sidebar--jiggle")).toBe(false);
  });
});
