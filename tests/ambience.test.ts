import { describe, it, expect } from "vitest";
import { applyAmbience } from "../src/lib/ambience";
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
