import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPlayer } from "../src/components/player";
import { playerEngine } from "../src/lib/playback/engine";
import { storage } from "../src/lib/storage";
import type { PlaybackState, Track } from "../src/types/music";

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "vid-1",
    title: "Short Title",
    artist: "Short Artist",
    artistId: "UC_ARTIST",
    album: "Test Album",
    albumId: "MPREb_test",
    duration: 210,
    artworkUrl: "https://example.com/art.jpg",
    ...overrides,
  };
}

function sampleState(track: Track | null, overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    currentTrack: track,
    status: track ? "playing" : "idle",
    currentTime: 0,
    duration: track?.duration ?? 0,
    volume: 1,
    isMuted: false,
    repeat: "off",
    shuffle: false,
    isAd: false,
    error: null,
    ...overrides,
  };
}

function setBoxWidth(el: HTMLElement, prop: "clientWidth" | "scrollWidth", value: number): void {
  Object.defineProperty(el, prop, {
    configurable: true,
    get: () => value,
  });
}

describe("Player responsive CSS & metadata marquee", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalMatchMedia = window.matchMedia;
  let resizeCallback: ResizeObserverCallback | null = null;
  let observedElements: Element[] = [];
  let reduceMotionMatches = false;

  beforeEach(() => {
    document.body.innerHTML = "";
    resizeCallback = null;
    observedElements = [];
    reduceMotionMatches = false;
    vi.restoreAllMocks();

    globalThis.ResizeObserver = class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb;
      }
      observe(target: Element): void {
        observedElements.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduceMotionMatches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    window.matchMedia = originalMatchMedia;
  });

  it("uses fluid grid sizing and narrow breakpoints instead of a rigid 400px controls floor", () => {
    const playerCss = fs.readFileSync(path.resolve("src/styles/player.css"), "utf8");
    const floatingCss = fs.readFileSync(path.resolve("src/styles/floating.css"), "utf8");

    expect(playerCss).not.toContain("min-width: 400px");
    expect(playerCss).toContain("minmax(0, 1.15fr) auto minmax(0, 0.85fr)");
    expect(playerCss).toMatch(/\.player__controls\s*\{[^}]*min-width:\s*0;[^}]*clamp\(/s);
    expect(playerCss).toContain("@media (max-width: 820px)");
    expect(playerCss).toContain("@container player (max-width: 780px)");
    expect(playerCss).toContain(".player__volume-slider");
    expect(playerCss).toContain("@keyframes player-marquee-bounce");
    expect(floatingCss).toContain("gap: var(--space-2)");
  });

  it("keeps short metadata static and enables marquee only when overflowing", () => {
    const track = sampleTrack();
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(track);
    vi.spyOn(playerEngine, "currentState", "get").mockReturnValue(sampleState(track));

    const bar = createPlayer();
    document.body.appendChild(bar);

    const meta = bar.querySelector<HTMLElement>(".player__meta")!;
    const titleEl = bar.querySelector<HTMLElement>(".player__title")!;
    const artistBtn = bar.querySelector<HTMLButtonElement>(".player__artist")!;
    const titleViewport = titleEl.querySelector<HTMLElement>(".player__marquee-viewport")!;
    const titleText = titleEl.querySelector<HTMLElement>(".player__marquee-text")!;
    const artistViewport = artistBtn.querySelector<HTMLElement>(".player__marquee-viewport")!;
    const artistText = artistBtn.querySelector<HTMLElement>(".player__marquee-text")!;

    expect(observedElements).toContain(meta);
    expect(titleEl.getAttribute("role")).toBe("button");
    expect(titleEl.textContent).toBe("Short Title");
    expect(artistBtn.textContent).toBe("Short Artist");

    // Simulate short widths: no overflow -> static
    setBoxWidth(titleViewport, "clientWidth", 180);
    setBoxWidth(titleText, "scrollWidth", 90);
    setBoxWidth(artistViewport, "clientWidth", 180);
    setBoxWidth(artistText, "scrollWidth", 85);
    resizeCallback?.([], {} as ResizeObserver);

    expect(titleViewport.classList.contains("is-scrolling")).toBe(false);
    expect(artistViewport.classList.contains("is-scrolling")).toBe(false);

    // Narrow the viewport / load a long title: overflows -> marquee enabled
    const longTrack = sampleTrack({
      id: "vid-2",
      title: "An Extraordinarily Long Song Title Featuring Multiple Featured Artists",
      artist: "First Artist, Second Artist & Third Featured Vocalist",
    });
    setBoxWidth(titleViewport, "clientWidth", 160);
    setBoxWidth(titleText, "scrollWidth", 340);
    setBoxWidth(artistViewport, "clientWidth", 160);
    setBoxWidth(artistText, "scrollWidth", 300);

    playerEngine.emit("trackChange", longTrack);

    expect(titleEl.textContent).toBe(longTrack.title);
    expect(artistBtn.textContent).toBe(longTrack.artist);
    expect(titleViewport.classList.contains("is-scrolling")).toBe(true);
    expect(artistViewport.classList.contains("is-scrolling")).toBe(true);
    expect(titleViewport.style.getPropertyValue("--marquee-shift")).toBe("-180px");
    expect(titleViewport.style.getPropertyValue("--marquee-duration")).toBe("6.43s");
    expect(artistViewport.style.getPropertyValue("--marquee-shift")).toBe("-140px");
    expect(artistViewport.style.getPropertyValue("--marquee-duration")).toBe("5s");

    // Widening the container removes scrolling cleanly
    setBoxWidth(titleViewport, "clientWidth", 360);
    setBoxWidth(artistViewport, "clientWidth", 320);
    resizeCallback?.([], {} as ResizeObserver);

    expect(titleViewport.classList.contains("is-scrolling")).toBe(false);
    expect(titleViewport.style.getPropertyValue("--marquee-shift")).toBe("");
    expect(artistViewport.classList.contains("is-scrolling")).toBe(false);
  });

  it("updates marquee for status messages and disables scrolling under reduced motion", () => {
    const track = sampleTrack({
      title: "Regular Title",
      artist: "Long Multi-Artist Credit Line That Exceeds The Player Bar Width",
    });
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(track);
    vi.spyOn(playerEngine, "currentState", "get").mockReturnValue(sampleState(track));

    const bar = createPlayer();
    document.body.appendChild(bar);

    const artistViewport = bar.querySelector<HTMLElement>(".player__artist .player__marquee-viewport")!;
    const artistText = bar.querySelector<HTMLElement>(".player__artist .player__marquee-text")!;
    setBoxWidth(artistViewport, "clientWidth", 140);
    setBoxWidth(artistText, "scrollWidth", 260);

    // Status line during ad triggers marquee recomputation
    playerEngine.emit("stateChange", sampleState(track, { isAd: true }));
    expect(artistText.textContent).toBe("Ad · your song plays after this");
    expect(artistViewport.classList.contains("is-scrolling")).toBe(true);
    expect(artistViewport.style.getPropertyValue("--marquee-shift")).toBe("-120px");

    // Enabling reduced motion immediately turns off scrolling
    reduceMotionMatches = true;
    storage.emit("settingsChange", storage.getSettings());
    expect(artistViewport.classList.contains("is-scrolling")).toBe(false);
    expect(artistViewport.style.getPropertyValue("--marquee-shift")).toBe("");
  });

  it("populates artwork, duration, and like state when a restored track is already loaded on mount", () => {
    const track = sampleTrack({ id: "restored-1", duration: 248, artworkUrl: "https://example.com/restored.jpg" });
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(track);
    vi.spyOn(playerEngine, "currentState", "get").mockReturnValue(sampleState(track, { status: "paused" }));
    vi.spyOn(storage, "isLiked").mockReturnValue(true);

    const bar = createPlayer();
    document.body.appendChild(bar);

    expect(bar.querySelector(".player__title")?.textContent).toBe("Short Title");
    expect(bar.querySelector(".player__artist")?.textContent).toBe("Short Artist");
    expect(bar.querySelectorAll(".player__time")[1]?.textContent).toBe("4:08");
    expect(bar.querySelector<HTMLImageElement>(".player__artwork-img")?.src).toBe("https://example.com/restored.jpg");
    expect(bar.querySelector<HTMLButtonElement>(".player__like-btn")?.getAttribute("aria-pressed")).toBe("true");
  });
});
