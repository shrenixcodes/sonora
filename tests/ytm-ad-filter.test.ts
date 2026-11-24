import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = readFileSync(path.resolve(import.meta.dirname, "../src-tauri/src/ytm_ad_filter.js"), "utf8");

function page(host = "music.youtube.com") {
  const context = vm.createContext({ location: { hostname: host } });
  vm.runInContext("globalThis.window = globalThis; window.top = window;", context);
  vm.runInContext(source, context);
  return context;
}

describe("YouTube Music player ad filtering", () => {
  it("removes inline ad data while preserving track information", () => {
    const result = vm.runInContext(`JSON.parse('{"videoDetails":{"title":"Song"},"streamingData":{"formats":[1]},"adPlacements":[{}],"adSlots":[{}],"playerAds":[{}]}')`, page());
    expect(result).toMatchObject({ videoDetails: { title: "Song" }, streamingData: { formats: [1] } });
    expect(result).not.toHaveProperty("adPlacements");
    expect(result).not.toHaveProperty("adSlots");
    expect(result).not.toHaveProperty("playerAds");
  });

  it("preserves JSON parse errors and reviver behavior", () => {
    const context = page();
    expect(() => vm.runInContext(`JSON.parse("invalid")`, context)).toThrow();
    expect(vm.runInContext(`JSON.parse('{"value":2}', (key, value) => key === "value" ? value * 2 : value).value`, context)).toBe(4);
    expect(() => vm.runInContext(`JSON.parse('{"videoDetails":{},"adSlots":[]}', (key, value) => key === "" ? Object.freeze(value) : value)`, context)).not.toThrow();
  });

  it("filters player data returned by Response.json", async () => {
    const context = vm.createContext({ location: { hostname: "music.youtube.com" } });
    vm.runInContext(`globalThis.window = globalThis; window.top = window; globalThis.Response = class { json() { return Promise.resolve({videoDetails: {title: "Song"}, playerAds: [1]}); } };`, context);
    vm.runInContext(source, context);
    const result = await vm.runInContext("new Response().json()", context);
    expect(result.videoDetails.title).toBe("Song");
    expect(result).not.toHaveProperty("playerAds");
  });

  it("handles wrapped player responses without changing unrelated JSON", () => {
    const context = page();
    const result = vm.runInContext(`JSON.parse('{"playerResponse":{"playabilityStatus":{"status":"OK"},"adPlacements":[{}]},"adSlots":["other"]}')`, context);
    expect(result.playerResponse).not.toHaveProperty("adPlacements");
    expect(result.adSlots).toEqual(["other"]);
    expect(vm.runInContext(`JSON.parse('{"adSlots":[1]}')`, context).adSlots).toEqual([1]);
    expect(vm.runInContext(`JSON.parse('{"videoDetails":{},"playerAds":[1]}')`, page("accounts.google.com"))).toHaveProperty("playerAds");
  });
});
