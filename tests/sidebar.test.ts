import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSidebar } from "../src/components/sidebar";
import { router } from "../src/lib/router";
import { storage } from "../src/lib/storage";

describe("Sidebar tap jiggle and playlists", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "#/";
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

    // Repeated tap restarts via Web Animations API without forcing a layout reflow.
    const play = vi.fn();
    sidebar.getAnimations = () => [{ currentTime: 100, play } as unknown as Animation];
    navLink.click();
    expect(play).toHaveBeenCalledTimes(1);
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

  it("populates sidebar playlists, reacts to playlist changes, and opens the selected playlist", () => {
    const navigate = vi.spyOn(router, "navigate");
    storage.savePlaylist({
      id: "pl_1",
      title: "Road Trip",
      trackCount: 1,
      tracks: [{ id: "trk1", title: "Drive", artist: "Artist", duration: 120, artworkUrl: "https://example.com/art.jpg" }],
      isCustom: true,
    });

    const sidebar = createSidebar();
    document.body.appendChild(sidebar);

    const items = sidebar.querySelectorAll<HTMLAnchorElement>(".sidebar__playlist-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Road Trip");
    expect(items[0].querySelector("img")?.getAttribute("src")).toBe("https://example.com/art.jpg");

    items[0].click();
    expect(navigate).toHaveBeenCalledWith("/playlist?source=local&id=pl_1");

    // Adding and deleting playlists updates the sidebar list automatically
    storage.savePlaylist({ id: "pl_2", title: "Chill", trackCount: 0, tracks: [], isCustom: true });
    expect(sidebar.querySelectorAll(".sidebar__playlist-item")).toHaveLength(2);

    storage.deletePlaylist("pl_1");
    storage.deletePlaylist("pl_2");
    expect(sidebar.querySelector(".sidebar__playlists")?.children).toHaveLength(0);
  });
});
