import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FALLBACK_APP_INFO } from "../src/lib/app-info";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("app version", () => {
  it("keeps the frontend fallback in sync with every release manifest", () => {
    const packageVersion = JSON.parse(read("package.json")).version;
    const tauriVersion = JSON.parse(read("src-tauri/tauri.conf.json")).version;
    const cargoVersion = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];

    expect(tauriVersion).toBe(packageVersion);
    expect(cargoVersion).toBe(packageVersion);
    expect(FALLBACK_APP_INFO.version).toBe(packageVersion);
  });
});
