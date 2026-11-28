/**
 * Application update checker and launch auto-updater.
 *
 * Uses Tauri Rust commands so GitHub API requests and installer downloads obey
 * the WebView CSP and run natively on desktop launches.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { FALLBACK_APP_INFO } from "@/lib/app-info";
import { EventEmitter } from "@/lib/events";

export interface ReleaseCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseName?: string | null;
  releaseNotes?: string | null;
  releaseUrl: string;
  installerUrl?: string | null;
  assetName?: string | null;
  assetSizeBytes?: number | null;
  publishedAt?: string | null;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdaterSnapshot {
  status: UpdateStatus;
  info: ReleaseCheckResult | null;
  error: string | null;
  lastCheckedAt: number | null;
}

interface UpdaterEvents {
  change: UpdaterSnapshot;
}

const FALLBACK_VERSION = FALLBACK_APP_INFO.version;
export const SONORA_REPO_URL = "https://github.com/shrenixcodes/sonora";
const LATEST_RELEASE_URL = `${SONORA_REPO_URL}/releases/latest`;

/** Open an external URL in the user's default browser across desktop and web contexts. */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("plugin:shell|open", { path: url }).catch(() => {
      window.open?.(url, "_blank", "noopener,noreferrer");
    });
    return;
  }
  window.open?.(url, "_blank", "noopener,noreferrer");
}

export function formatBytes(bytes?: number | null): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function describeUpdateSnapshot(snapshot: UpdaterSnapshot): { label: string; detail: string } {
  const { status, info, error } = snapshot;
  switch (status) {
    case "checking":
      return { label: "Checking for updates…", detail: "Connecting to GitHub Releases" };
    case "up-to-date": {
      const ver = info?.currentVersion ?? FALLBACK_VERSION;
      return { label: "Up to date", detail: `Sonora v${ver} is the latest release` };
    }
    case "available": {
      const ver = info?.latestVersion ?? "latest";
      const size = formatBytes(info?.assetSizeBytes);
      return {
        label: `Update available: v${ver}`,
        detail: size ? `${info?.assetName ?? "Installer"} · ${size}` : "Ready to download from GitHub Releases",
      };
    }
    case "downloading":
      return {
        label: `Downloading v${info?.latestVersion ?? "update"}…`,
        detail: "Preparing installer package",
      };
    case "installing":
      return {
        label: `Installing v${info?.latestVersion ?? "update"}…`,
        detail: "Launching Sonora installer",
      };
    case "error":
      return {
        label: "Update check failed",
        detail: error ?? "Check your internet connection and try again",
      };
    default:
      return { label: "Automatic updates enabled", detail: "Checks for new releases on launch" };
  }
}

export class UpdaterService extends EventEmitter<UpdaterEvents> {
  private snapshot: UpdaterSnapshot = {
    status: "idle",
    info: null,
    error: null,
    lastCheckedAt: null,
  };
  private inFlightCheck: Promise<ReleaseCheckResult | null> | null = null;
  private inFlightInstall: Promise<void> | null = null;
  private launchChecked = false;

  get state(): UpdaterSnapshot {
    return { ...this.snapshot };
  }

  private setState(next: Partial<UpdaterSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    this.emit("change", this.state);
  }

  /** Resets in-memory updater state (primarily for unit tests). */
  resetForTest(): void {
    this.snapshot = { status: "idle", info: null, error: null, lastCheckedAt: null };
    this.inFlightCheck = null;
    this.inFlightInstall = null;
    this.launchChecked = false;
  }

  async checkForUpdates(options?: { force?: boolean }): Promise<ReleaseCheckResult | null> {
    if (this.inFlightCheck) return this.inFlightCheck;

    if (!options?.force && this.snapshot.info && (this.snapshot.status === "available" || this.snapshot.status === "downloading" || this.snapshot.status === "installing")) {
      return this.snapshot.info;
    }

    const run = (async (): Promise<ReleaseCheckResult | null> => {
      if (!isTauri()) {
        const result: ReleaseCheckResult = {
          currentVersion: FALLBACK_VERSION,
          latestVersion: FALLBACK_VERSION,
          updateAvailable: false,
          releaseUrl: LATEST_RELEASE_URL,
        };
        this.setState({
          status: "up-to-date",
          info: result,
          error: null,
          lastCheckedAt: Date.now(),
        });
        return result;
      }

      this.setState({ status: "checking", error: null });
      try {
        const result = await invoke<ReleaseCheckResult>("check_for_updates");
        this.setState({
          status: result.updateAvailable ? "available" : "up-to-date",
          info: result,
          error: null,
          lastCheckedAt: Date.now(),
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || "Unable to reach update server.");
        this.setState({
          status: "error",
          error: message,
          lastCheckedAt: Date.now(),
        });
        return null;
      }
    })();

    this.inFlightCheck = run;
    try {
      return await run;
    } finally {
      this.inFlightCheck = null;
    }
  }

  async installUpdate(): Promise<void> {
    if (this.inFlightInstall) return this.inFlightInstall;
    const currentInfo = this.snapshot.info;
    if (!currentInfo || !currentInfo.updateAvailable) return;

    const run = (async (): Promise<void> => {
      if (!currentInfo.installerUrl || !isTauri()) {
        await openExternalUrl(currentInfo.releaseUrl);
        return;
      }

      this.setState({ status: "downloading", error: null });
      try {
        await invoke("install_update", {
          installerUrl: currentInfo.installerUrl,
          version: currentInfo.latestVersion,
        });
        this.setState({ status: "installing", error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || "Update installation failed.");
        this.setState({ status: "error", error: message });
      }
    })();

    this.inFlightInstall = run;
    try {
      await run;
    } finally {
      this.inFlightInstall = null;
    }
  }

  /** Checks once on desktop startup and automatically triggers the update if available. */
  async autoUpdateOnLaunch(): Promise<void> {
    if (this.launchChecked) return;
    this.launchChecked = true;
    const result = await this.checkForUpdates();
    if (result?.updateAvailable && result.installerUrl && isTauri()) {
      await this.installUpdate();
    }
  }
}

export const updater = new UpdaterService();
