import { describe, it, expect } from "vitest";
import { applyAccent, contrastRatio, onAccentColor, readableAccent } from "../src/lib/accent";

const BONE = "#F0EBDD";
const CHARCOAL = "#17151C";

describe("readableAccent", () => {
  it("keeps accents that already read well", () => {
    expect(readableAccent("#A78BFA", "dark")).toBe("#A78BFA");
    expect(readableAccent("#315E48", "light")).toBe("#315E48");
  });

  it("darkens a pale accent on the light theme until text passes AA", () => {
    const adjusted = readableAccent("#A78BFA", "light");
    expect(adjusted).not.toBe("#A78BFA");
    expect(contrastRatio(adjusted, BONE)).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens a deep accent on the dark theme until text passes AA", () => {
    const adjusted = readableAccent("#315E48", "dark");
    expect(contrastRatio(adjusted, CHARCOAL)).toBeGreaterThanOrEqual(4.5);
  });

  it("only moves as far as needed", () => {
    const adjusted = readableAccent("#F472B6", "light");
    expect(contrastRatio(adjusted, BONE)).toBeLessThan(5.2);
  });
});

describe("applyAccent", () => {
  it("clears the override so the theme accent shows when nothing is chosen", () => {
    const root = document.createElement("div");
    applyAccent("#3B82F6", "dark", root);
    applyAccent(null, "dark", root);
    expect(root.style.getPropertyValue("--color-accent")).toBe("");
  });

  it("ignores values that are not hex colors", () => {
    const root = document.createElement("div");
    applyAccent("red; background: url(x)", "dark", root);
    expect(root.style.getPropertyValue("--color-accent")).toBe("");
  });

  it("sets readable foreground ink on bright and dark accents via --color-on-accent", () => {
    const root = document.createElement("div");
    applyAccent("#A78BFA", "dark", root);
    expect(root.style.getPropertyValue("--color-on-accent")).toBe("#17151C");

    applyAccent("#315E48", "light", root);
    expect(root.style.getPropertyValue("--color-on-accent")).toBe("#FFFFFF");
    expect(onAccentColor("#3B82F6")).toBe("#17151C");

    applyAccent(null, "dark", root);
    expect(root.style.getPropertyValue("--color-on-accent")).toBe("");
  });
});
