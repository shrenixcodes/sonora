import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showLaunchSplash, resetLaunchSplashFlag, prepareLaunchSplash } from "../src/lib/visuals/splash-screen";
import { icon } from "../src/icons";

describe("Sonora logo and launch splash", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"><div class="main"></div></div>';
    resetLaunchSplashFlag();
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    resetLaunchSplashFlag();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exports unique Sonora brand logo SVG", () => {
    const logoSvg = icon("sonoraLogo");
    expect(logoSvg).toContain("<svg");
    expect(logoSvg).toContain("viewBox");
    expect(logoSvg).toContain("</svg>");
  });

  it("plays the liquid launch with the Sonora logo and cleans up", async () => {
    expect(prepareLaunchSplash()).toBe(true);
    const done = showLaunchSplash();
    expect(document.querySelector(".symbiote-flyer--logo")).not.toBeNull();

    vi.advanceTimersByTime(3000);
    await done;
    expect(document.querySelector(".symbiote-flyer--logo")).toBeNull();
  });

  it("is skipped with reduced motion unless forced", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {} }));
    expect(prepareLaunchSplash()).toBe(false);
    await showLaunchSplash();
    expect(document.querySelector(".symbiote-flyer")).toBeNull();

    void showLaunchSplash({ force: true });
    expect(document.querySelector(".symbiote-flyer--logo")).not.toBeNull();
  });
});
