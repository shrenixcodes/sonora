import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
  return {
    invokeMock: vi.fn(),
    isTauriMock: vi.fn(() => false),
  };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    isTauri: isTauriMock,
    invoke: invokeMock,
  };
});

import { createPlayer } from "../src/components/player";
import { router } from "../src/lib/router";
import { DEFAULT_SETTINGS, storage } from "../src/lib/storage";
import { renderLibrary } from "../src/views/library";
import { parseThemeImport, pickThemeSettings, renderSettings } from "../src/views/settings";

describe("UI navigation, dialogs, theme scoping, and player keyboard accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("sonora:discord_rpc_migrated", "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    window.location.hash = "#/";
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.body.classList.remove("density-compact");
    isTauriMock.mockReturnValue(false);
    invokeMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows live app version from Tauri and lists Ctrl+K in Settings", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_info") return { name: "Sonora", version: "0.7.1" };
      if (cmd === "get_platform_info") return { os: "windows", arch: "x64" };
      return null;
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSettings(host);

    expect(host.textContent).toContain("Ctrl + K");
    expect(host.textContent).toContain("Focus search");

    await vi.waitFor(() => {
      expect(host.textContent).toContain("Version 0.7.1 (Windows x64 Native)");
    });
    expect(host.textContent).not.toContain("Version 0.1.0");
  });

  it("scopes Export Theme JSON and Import Theme to appearance settings only", () => {
    storage.saveSettings({
      theme: "light",
      accentColor: "#10B981",
      density: "compact",
      volume: 0.25,
      autoPlayNext: false,
      enableDiscordRpc: false,
      normalizeVolume: false,
    });

    const exported = pickThemeSettings(storage.getSettings());
    expect(exported).toEqual({
      theme: "light",
      accentColor: "#10B981",
      ambientMode: DEFAULT_SETTINGS.ambientMode,
      ambientFpsLimit: DEFAULT_SETTINGS.ambientFpsLimit,
      ambientIntensity: DEFAULT_SETTINGS.ambientIntensity,
      density: "compact",
      lyricsFontSize: DEFAULT_SETTINGS.lyricsFontSize,
    });
    expect("volume" in exported).toBe(false);
    expect("autoPlayNext" in exported).toBe(false);
    expect("enableDiscordRpc" in exported).toBe(false);
    expect("normalizeVolume" in exported).toBe(false);

    // Even if a JSON payload attempts to overwrite non-theme settings, parseThemeImport strips them.
    const patch = parseThemeImport({
      theme: "dark",
      density: "comfortable",
      volume: 1.0,
      autoPlayNext: true,
      enableDiscordRpc: true,
      normalizeVolume: true,
    });
    const next = storage.saveSettings(patch);
    expect(next.theme).toBe("dark");
    expect(next.density).toBe("comfortable");
    expect(next.volume).toBe(0.25);
    expect(next.autoPlayNext).toBe(false);
    expect(next.enableDiscordRpc).toBe(false);
    expect(next.normalizeVolume).toBe(false);
  });

  it("shows a styled modal dialog instead of alert on invalid theme import", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSettings(host);

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, "files", {
        configurable: true,
        value: [{ text: async () => "not json" }],
      });
      this.onchange?.(new Event("change"));
    });

    const importBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Import Theme")!;
    importBtn.click();

    await vi.waitFor(() => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog.sonora-dialog");
      expect(dialog?.hasAttribute("open")).toBe(true);
      expect(dialog?.textContent).toContain("Could not import theme");
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it("uses a styled dialog instead of prompt() when creating a playlist", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/playlists";
    renderLibrary(host);

    const newBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("New Playlist"))!;
    newBtn.click();

    expect(promptSpy).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLDialogElement>("dialog.sonora-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.hasAttribute("open")).toBe(true);

    // Submitting blank shows inline validation error without closing dialog
    const form = dialog.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(dialog.querySelector(".sonora-dialog__error")?.textContent).toContain("Please enter a playlist title");
    expect(storage.getPlaylists()).toHaveLength(0);

    // Submitting a real name creates the playlist and closes the dialog
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    input.value = "Night Drive";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(document.querySelector("dialog.sonora-dialog")).toBeNull();
    expect(storage.getPlaylists().map((p) => p.title)).toEqual(["Night Drive"]);
  });

  it("allows keyboard activation of player artwork and title with Enter and Space", () => {
    const navigate = vi.spyOn(router, "navigate").mockImplementation(() => {});
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    try {
      const bar = createPlayer();
      document.body.appendChild(bar);
      const artwork = bar.querySelector<HTMLElement>(".player__artwork")!;
      const title = bar.querySelector<HTMLElement>(".player__title")!;

      expect(artwork.getAttribute("tabindex")).toBe("0");
      expect(title.getAttribute("tabindex")).toBe("0");

      artwork.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(navigate).toHaveBeenCalledWith("/now-playing");

      navigate.mockClear();
      title.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      expect(navigate).toHaveBeenCalledWith("/now-playing");
      expect(shortcut).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", shortcut);
    }
  });
});
