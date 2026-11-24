import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderNowPlaying } from "../src/views/now-playing";
import { router } from "../src/lib/router";

describe("Now Playing fullscreen presentation", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.immersive;
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    delete document.documentElement.dataset.immersive;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resets parent scroll offset and toggles immersive state via button and Escape", () => {
    const main = document.createElement("main");
    main.className = "main";
    main.scrollTop = 320;
    const container = document.createElement("div");
    main.appendChild(container);
    document.body.appendChild(main);

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;

    window.location.hash = "#/now-playing";
    router.route("/now-playing", renderNowPlaying);
    router.route("/", () => {});
    router.start(container);

    expect(main.scrollTop).toBe(0);

    const fsBtn = container.querySelector<HTMLButtonElement>(".now-playing__fs-btn")!;
    expect(fsBtn).not.toBeNull();
    expect(fsBtn.getAttribute("aria-pressed")).toBe("false");

    fsBtn.click();
    expect(document.documentElement.hasAttribute("data-immersive")).toBe(true);
    expect(fsBtn.getAttribute("aria-pressed")).toBe("true");
    expect(fsBtn.getAttribute("aria-label")).toBe("Leave fullscreen lyrics");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.documentElement.hasAttribute("data-immersive")).toBe(false);
    expect(fsBtn.getAttribute("aria-pressed")).toBe("false");
    expect(fsBtn.getAttribute("aria-label")).toBe("Fullscreen lyrics");

    // Leaves immersive mode cleanly when navigating away
    fsBtn.click();
    expect(document.documentElement.hasAttribute("data-immersive")).toBe(true);
    router.navigate("/");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.documentElement.hasAttribute("data-immersive")).toBe(false);
  });

  it("clears ancestor transforms and floating layout overrides in immersive CSS", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../src/styles/now-playing.css"), "utf8");
    expect(css).toContain("html[data-immersive] .main");
    expect(css).toContain("transform: none !important;");
    expect(css).toContain("html[data-immersive][data-window] #app");
    expect(css).toContain("transform-origin: left center;");
  });
});
