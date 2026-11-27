import { describe, it, expect, vi } from "vitest";
import { AmbientArtwork, applyAmbience, applyArtworkAccent, syncShellAccent } from "../src/lib/ambience";
import type { ArtworkPalette } from "../src/lib/visuals/color-extractor";

const palette: ArtworkPalette = {
  dominant: "#223344",
  vibrant: "#ff5500",
  secondary: "#88aa00",
  darkMuted: "#111111",
  lightMuted: "#eeeeee",
  rgbDominant: [34, 51, 68],
  rgbVibrant: [255, 85, 0],
  rgbSecondary: [136, 170, 0],
};

describe("applyAmbience", () => {
  it("maps artwork colors onto the backdrop variables", () => {
    const root = document.createElement("div");
    applyAmbience(palette, root);

    expect(root.style.getPropertyValue("--ambience-1")).toBe("#ff5500");
    expect(root.style.getPropertyValue("--ambience-2")).toBe("#223344");
    expect(root.style.getPropertyValue("--ambience-3")).toBe("#88aa00");
  });

  it("falls back to the theme default when cleared", () => {
    const root = document.createElement("div");
    applyAmbience(palette, root);
    applyAmbience(null, root);

    expect(root.style.getPropertyValue("--ambience-1")).toBe("");
    expect(root.getAttribute("style") ?? "").not.toContain("--ambience");
  });
});

describe("AmbientArtwork", () => {
  it("fades a new artwork in over the old one and clears on null", () => {
    vi.useFakeTimers();
    const art = new AmbientArtwork();
    art.set("https://example.com/a.jpg");
    art.set("https://example.com/a.jpg");
    expect(art.element.querySelectorAll("img")).toHaveLength(1);

    const first = art.element.querySelector("img")!;
    first.dispatchEvent(new Event("load"));
    expect(first.classList.contains("is-visible")).toBe(true);

    art.set("https://example.com/b.jpg");
    expect(first.classList.contains("is-visible")).toBe(false);
    expect(art.element.querySelectorAll("img")).toHaveLength(2);

    art.set(null);
    vi.runAllTimers();
    expect(art.element.querySelectorAll("img")).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("applyArtworkAccent", () => {
  it("takes a readable accent from the artwork and restores the theme's when cleared", () => {
    const shell = document.createElement("div");
    applyArtworkAccent(palette, "dark", shell);
    const accent = shell.style.getPropertyValue("--color-accent");
    expect(accent).toMatch(/^#[0-9A-F]{6}$/);
    expect(shell.style.getPropertyValue("--color-hover")).toContain(accent);

    applyArtworkAccent(null, "dark", shell);
    expect(shell.style.getPropertyValue("--color-accent")).toBe("");
    expect(shell.style.getPropertyValue("--color-on-accent")).toBe("");
    expect(shell.style.getPropertyValue("--color-hover")).toBe("");
  });

  it("clears shell overrides when a custom accent color is chosen and restores them on default", () => {
    const shell = document.createElement("div");
    syncShellAccent(palette, "dark", shell, null);
    expect(shell.style.getPropertyValue("--color-accent")).toMatch(/^#[0-9A-F]{6}$/);
    expect(shell.style.getPropertyValue("--color-on-accent")).toMatch(/^#(17151C|FFFFFF)$/);

    syncShellAccent(palette, "dark", shell, "#3B82F6");
    expect(shell.style.getPropertyValue("--color-accent")).toBe("");
    expect(shell.style.getPropertyValue("--color-on-accent")).toBe("");
    expect(shell.style.getPropertyValue("--color-hover")).toBe("");

    syncShellAccent(palette, "dark", shell, null);
    expect(shell.style.getPropertyValue("--color-accent")).toMatch(/^#[0-9A-F]{6}$/);
  });
});
