import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { markRenderTier, tierForRenderer } from "../src/lib/render-tier";

describe("tierForRenderer", () => {
  it("recognises software renderers", () => {
    for (const name of [
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)",
      "Google SwiftShader",
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      null,
      "",
    ]) {
      expect(tierForRenderer(name)).toBe("software");
    }
  });

  it("treats real graphics hardware, integrated included, as GPU", () => {
    for (const name of [
      "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ]) {
      expect(tierForRenderer(name)).toBe("gpu");
    }
  });
});

describe("software rendering", () => {
  it("marks the document so CSS can drop blurs", () => {
    // jsdom has no WebGL, which is exactly what a machine without a GPU reports.
    const root = document.createElement("html");
    expect(markRenderTier(root)).toBe("software");
    expect(root.dataset.renderTier).toBe("software");
  });

  it("swaps every glass blur and the blurred artwork for solid tints", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../src/styles/global.css"), "utf8");
    const block = css.slice(css.indexOf('html[data-render-tier="software"] {'));
    for (const token of ["--glass-backdrop-thin", "--glass-backdrop:", "--glass-backdrop-strong", "--glass-backdrop-deep"]) {
      expect(block).toMatch(new RegExp(`${token}\\s*:?\\s*none`));
    }
    expect(css).toMatch(/html\[data-render-tier="software"\] \.ambient-art \{\s*display: none;/);
  });
});
