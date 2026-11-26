import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
  return {
    invokeMock: vi.fn(),
    isTauriMock: vi.fn(() => true),
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

import { showAboutPopup } from "../src/components/about-popup";
import { updater, type ReleaseCheckResult } from "../src/lib/updater";

const availableRelease: ReleaseCheckResult = {
  currentVersion: "0.6.8",
  latestVersion: "0.7.0",
  updateAvailable: true,
  releaseName: "Sonora v0.7.0",
  releaseUrl: "https://github.com/shrenixcodes/sonora/releases/tag/v0.7.0",
  installerUrl: "https://github.com/shrenixcodes/sonora/releases/download/v0.7.0/Sonora_0.7.0_x64-setup.exe",
  assetName: "Sonora_0.7.0_x64-setup.exe",
  assetSizeBytes: 12 * 1024 * 1024,
};

describe("Launch auto-update and About popup update checker", () => {
  beforeEach(() => {
    updater.resetForTest();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockReset();
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("checks once at launch and automatically downloads/installs available updates", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "check_for_updates") return availableRelease;
      if (cmd === "install_update") return null;
      return null;
    });

    await updater.autoUpdateOnLaunch();
    await updater.autoUpdateOnLaunch();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "check_for_updates");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "install_update", {
      installerUrl: availableRelease.installerUrl,
      version: "0.7.0",
    });
    expect(updater.state.status).toBe("installing");
  });

  it("shows update availability and lets the user check and install from the About popup", async () => {
    const upToDate: ReleaseCheckResult = {
      currentVersion: "0.6.8",
      latestVersion: "0.6.8",
      updateAvailable: false,
      releaseUrl: "https://github.com/shrenixcodes/sonora/releases/latest",
    };

    let checks = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_info") return { name: "Sonora", version: "0.6.8" };
      if (cmd === "get_platform_info") return { os: "windows", arch: "x64" };
      if (cmd === "check_for_updates") {
        checks += 1;
        return checks === 1 ? upToDate : availableRelease;
      }
      if (cmd === "install_update") return null;
      return null;
    });

    await showAboutPopup();

    const dialog = document.querySelector<HTMLDialogElement>("dialog.about-popup")!;
    expect(dialog).not.toBeNull();
    const updateBtn = dialog.querySelector<HTMLButtonElement>(".about-popup__update-btn")!;

    await vi.waitFor(() => {
      expect(dialog.querySelector(".about-popup__update-status")?.textContent).toBe("Up to date");
    });

    // Clicking Check for Updates re-queries and reveals the available update
    updateBtn.click();
    await vi.waitFor(() => {
      expect(dialog.querySelector(".about-popup__update-status")?.textContent).toBe("Update available: v0.7.0");
      expect(updateBtn.textContent).toBe("Update to v0.7.0");
    });

    // Clicking Install triggers native installer download
    updateBtn.click();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("install_update", {
        installerUrl: availableRelease.installerUrl,
        version: "0.7.0",
      });
    });
  });

  it("surfaces errors and offers retry when GitHub check fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_info") return { name: "Sonora", version: "0.6.8" };
      if (cmd === "get_platform_info") return { os: "windows", arch: "x64" };
      if (cmd === "check_for_updates") throw new Error("Network offline");
      return null;
    });

    await showAboutPopup();

    const dialog = document.querySelector<HTMLDialogElement>("dialog.about-popup")!;
    await vi.waitFor(() => {
      expect(dialog.querySelector(".about-popup__update-status")?.textContent).toBe("Update check failed");
      expect(dialog.querySelector(".about-popup__update-detail")?.textContent).toContain("Network offline");
    });
    expect(dialog.querySelector<HTMLButtonElement>(".about-popup__update-btn")?.textContent).toBe("Retry Check");
  });
});
