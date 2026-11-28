import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error -- a plain Node script without type declarations
import { TARGETS, isValidVersion, setVersion } from "../scripts/bump-version.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("version bump script", () => {
  it("changes exactly one line in every versioned file", () => {
    for (const [file, pattern] of TARGETS as [string, RegExp][]) {
      const before = readFileSync(path.join(root, file), "utf8");
      const after = setVersion(before, pattern, "9.8.7");
      const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
      expect(changed, file).toHaveLength(1);
      expect(changed[0], file).toContain("9.8.7");
    }
  });

  it("only touches Sonora's own entry in Cargo.lock", () => {
    const lock = readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8");
    const pattern = (TARGETS as [string, RegExp][]).find(([file]) => file === "src-tauri/Cargo.lock")![1];
    const after = setVersion(lock, pattern, "9.8.7");
    expect(after).toMatch(/name = "sonora"\r?\nversion = "9\.8\.7"/);
    expect(after.match(/9\.8\.7/g)).toHaveLength(1);
  });

  it("accepts release and pre-release versions only", () => {
    expect(isValidVersion("0.8.19")).toBe(true);
    expect(isValidVersion("1.0.0-beta.2")).toBe(true);
    expect(isValidVersion("v0.8.19")).toBe(false);
    expect(isValidVersion("0.8")).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
  });
});
