import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARTWORK_CANVAS_SIZE,
  ARTWORK_FILTER,
  AmbientArtwork,
  applyAmbience,
  applyArtworkAccent,
  syncShellAccent,
} from "../src/lib/ambience";
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
  function setup() {
    const drawn: unknown[][] = [];
    const ctx = { filter: "", drawImage: (...args: unknown[]) => drawn.push(args) };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const pending = new Map<string, (image: { width: number; height: number }) => void>();
    const load = vi.fn(
      (url: string) => new Promise<{ width: number; height: number }>((resolve) => pending.set(url, resolve)),
    );
    const art = new AmbientArtwork(document, load as never);
    return { art, ctx, drawn, pending, load };
  }

  afterEach(() => vi.restoreAllMocks());

  it("fades a new artwork in over the old one and clears on null", async () => {
    const { art, pending } = setup();
    art.set("https://example.com/a.jpg");
    art.set("https://example.com/a.jpg");
    expect(art.element.querySelectorAll("canvas")).toHaveLength(1);

    const first = art.element.querySelector("canvas")!;
    pending.get("https://example.com/a.jpg")!({ width: 544, height: 544 });
    await vi.waitFor(() => expect(first.classList.contains("is-visible")).toBe(true));

    vi.useFakeTimers();
    art.set("https://example.com/b.jpg");
    expect(first.classList.contains("is-visible")).toBe(false);
    expect(art.element.querySelectorAll("canvas")).toHaveLength(2);

    art.set(null);
    vi.runAllTimers();
    expect(art.element.querySelectorAll("canvas")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("blurs the artwork once into a small canvas instead of with a live CSS filter", async () => {
    const { art, ctx, drawn, pending } = setup();
    art.set("https://example.com/wide.jpg");
    pending.get("https://example.com/wide.jpg")!({ width: 800, height: 600 });
    const layer = art.element.querySelector("canvas")!;
    await vi.waitFor(() => expect(layer.classList.contains("is-visible")).toBe(true));

    // The whole image at its own shape, so object-fit: cover crops it as before.
    expect([layer.width, layer.height]).toEqual([ARTWORK_CANVAS_SIZE, 96]);
    expect(ctx.filter).toBe(ARTWORK_FILTER);
    expect(drawn[0].slice(1)).toEqual([0, 0, ARTWORK_CANVAS_SIZE, 96]);

    const css = readFileSync(path.resolve(import.meta.dirname, "../src/styles/global.css"), "utf8");
    const layerRule = css.slice(css.indexOf(".ambient-art__layer {"), css.indexOf("}", css.indexOf(".ambient-art__layer {")));
    expect(layerRule).not.toMatch(/filter:/);
  });

  it("drops a layer whose artwork never loads", async () => {
    const drawn = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const art = new AmbientArtwork(document, () => Promise.reject(new Error("404")));
    art.set("https://example.com/missing.jpg");
    await vi.waitFor(() => expect(art.element.querySelectorAll("canvas")).toHaveLength(0));
    expect(drawn).not.toHaveBeenCalled();
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
