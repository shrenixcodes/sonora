import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showLaunchSplash } from "../src/lib/visuals/splash-screen";
import { icon } from "../src/icons";

describe("Sonora logo and launch splash screen", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exports unique Sonora brand logo SVG", () => {
    const logoSvg = icon("sonoraLogo");
    expect(logoSvg).toBeDefined();
    expect(logoSvg).toContain("<svg");
    expect(logoSvg).toContain("sonora-grad-icon");
    expect(logoSvg).toContain("</svg>");
  });

  it("mounts splash screen with 3D canvas and brand typography", async () => {
    const splashPromise = showLaunchSplash({ force: true, duration: 1000 });

    const overlay = document.querySelector(".splash-overlay");
    expect(overlay).not.toBeNull();

    const canvas = overlay?.querySelector("canvas.splash-canvas");
    expect(canvas).not.toBeNull();

    const title = overlay?.querySelector(".splash-title");
    expect(title?.textContent).toBe("Sonora");

    // Advance timers so splash completes and unmounts
    vi.advanceTimersByTime(1200);
    await splashPromise;

    expect(document.querySelector(".splash-overlay")).toBeNull();
  });

  it("dismisses immediately on user click or key press", async () => {
    const splashPromise = showLaunchSplash({ force: true, duration: 3000 });

    const overlay = document.querySelector(".splash-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();

    // User clicks anywhere to skip
    overlay.click();

    vi.advanceTimersByTime(500);
    await splashPromise;

    expect(document.querySelector(".splash-overlay")).toBeNull();
  });

  it("bypasses splash if prefers-reduced-motion is active", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      addEventListener() {},
    }));

    await showLaunchSplash({ force: true });
    expect(document.querySelector(".splash-overlay")).toBeNull();
  });
});
