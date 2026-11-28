/**
 * Application metadata and runtime platform helpers backed by Tauri commands.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
}

export interface PlatformInfo {
  os: string;
  arch: string;
}

export const FALLBACK_APP_INFO: AppInfo = {
  name: "Sonora",
  version: "0.7.53",
};

export const FALLBACK_PLATFORM_INFO: PlatformInfo = {
  os: "windows",
  arch: "x64",
};

export async function getAppRuntimeInfo(): Promise<{ app: AppInfo; platform: PlatformInfo }> {
  if (!isTauri()) {
    return { app: { ...FALLBACK_APP_INFO }, platform: { ...FALLBACK_PLATFORM_INFO } };
  }
  try {
    const [app, platform] = await Promise.all([
      invoke<AppInfo>("get_app_info"),
      invoke<PlatformInfo>("get_platform_info"),
    ]);
    return {
      app: app ?? { ...FALLBACK_APP_INFO },
      platform: platform ?? { ...FALLBACK_PLATFORM_INFO },
    };
  } catch {
    return { app: { ...FALLBACK_APP_INFO }, platform: { ...FALLBACK_PLATFORM_INFO } };
  }
}

export function formatVersionSummary(app: AppInfo, platform: PlatformInfo): string {
  const osLabel = platform.os === "windows" ? "Windows" : platform.os;
  const nativeSuffix = platform.os === "windows" ? " Native" : "";
  return `Version ${app.version} (${osLabel} ${platform.arch}${nativeSuffix})`;
}
