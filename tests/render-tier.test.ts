import { describe, it, expect } from "vitest";
import { tierForRenderer } from "../src/lib/render-tier";

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
