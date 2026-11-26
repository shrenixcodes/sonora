import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
});

import { storage, DEFAULT_SETTINGS } from "../src/lib/storage";
import { formatAudioTelemetry, formatCompactQualityBadge, sanitizeAudioEnhancement, sanitizeAudioQuality } from "../src/lib/audio-quality";
import { playerEngine } from "../src/lib/playback/engine";
import { renderSettings } from "../src/views/settings";
import { renderNowPlaying } from "../src/views/now-playing";
import { router } from "../src/lib/router";

describe("Audio quality, Lossless mode, and Enhancement settings", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sanitizes stored or imported audio settings safely", () => {
    expect(sanitizeAudioQuality("lossless")).toBe("lossless");
    expect(sanitizeAudioQuality("invalid-mode")).toBe("high");
    expect(sanitizeAudioEnhancement("clarity")).toBe("clarity");
    expect(sanitizeAudioEnhancement("bogus")).toBe("off");

    localStorage.setItem(
      "sonora:settings",
      JSON.stringify({ audioQuality: "ultra-fake", audioEnhancement: "unknown", normalizeVolume: 0 }),
    );
    const loaded = storage.getSettings();
    expect(loaded.audioQuality).toBe(DEFAULT_SETTINGS.audioQuality);
    expect(loaded.audioEnhancement).toBe(DEFAULT_SETTINGS.audioEnhancement);
    expect(loaded.normalizeVolume).toBe(false);
  });

  it("formats telemetry and compact badges for active stream states", () => {
    const text = formatAudioTelemetry(
      { audioQuality: "lossless", audioEnhancement: "clarity", normalizeVolume: true },
      { codec: "Opus", bitrateKbps: 256, sampleRate: 48000, dspActive: true, dspSampleRate: 48000, normalizedGainDb: -3.2 },
    );
    expect(text).toContain("Lossless Studio");
    expect(text).toContain("Opus");
    expect(text).toContain("256 kbps");
    expect(text).toContain("48.0 kHz");
    expect(text).toContain("DSP Active");
    expect(text).toContain("Gain -3.2 dB");

    expect(
      formatCompactQualityBadge(
        { audioQuality: "lossless", audioEnhancement: "off" },
        { codec: "Opus", bitrateKbps: 256, dspActive: true },
      ),
    ).toBe("Lossless · 256 kbps");
    expect(
      formatCompactQualityBadge(
        { audioQuality: "lossless", audioEnhancement: "off" },
        { codec: "Opus", bitrateKbps: 160, dspActive: true, effectiveQuality: "high", fallbackUsed: true },
      ),
    ).toBe("Best · 160 kbps");
    expect(
      formatAudioTelemetry(
        { audioQuality: "lossless", audioEnhancement: "off", normalizeVolume: true },
        { codec: "Opus", bitrateKbps: 160, dspActive: true, effectiveQuality: "high", fallbackUsed: true },
      ),
    ).toContain("Best Available (High Quality)");
    expect(formatCompactQualityBadge({ audioQuality: "balanced", audioEnhancement: "off" }, null)).toBeNull();
  });

  it("exposes Lossless quality, enhancement profiles, and live telemetry in Settings", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/settings";
    router.route("/settings", renderSettings);
    router.route("/", () => {});
    router.start(host);

    const losslessBtn = host.querySelector<HTMLButtonElement>('[data-audio-quality="lossless"]');
    expect(losslessBtn).not.toBeNull();
    expect(losslessBtn?.textContent).toBe("Lossless");

    losslessBtn?.click();
    expect(storage.getSettings().audioQuality).toBe("lossless");
    expect(losslessBtn?.classList.contains("settings__seg-btn--active")).toBe(true);
    expect(losslessBtn?.getAttribute("aria-checked")).toBe("true");

    const profileSelect = host.querySelector<HTMLSelectElement>('select[aria-label="Audio Enhancement Profile"]');
    expect(profileSelect).not.toBeNull();
    profileSelect!.value = "clarity";
    profileSelect!.dispatchEvent(new Event("change"));
    expect(storage.getSettings().audioEnhancement).toBe("clarity");

    const statusTag = Array.from(host.querySelectorAll<HTMLElement>(".settings__tag")).find((el) =>
      el.textContent?.includes("Lossless"),
    );
    expect(statusTag).toBeDefined();

    // Emitting bridge audio telemetry updates the status row live
    playerEngine.emit("stateChange", {
      ...playerEngine.currentState,
      audioInfo: { codec: "AAC", bitrateKbps: 256, sampleRate: 44100, dspActive: true, dspSampleRate: 48000 },
    });
    const statusRow = statusTag!.closest(".settings__row")!;
    expect(statusRow.querySelector(".settings__row-description")?.textContent).toContain("256 kbps");
  });

  it("shows a Lossless quality badge in Now Playing and updates when settings change", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    storage.saveSettings({ audioQuality: "balanced", audioEnhancement: "off" });
    window.location.hash = "#/now-playing";
    router.route("/now-playing", renderNowPlaying);
    router.route("/settings", () => {});
    router.start(host);

    const badge = host.querySelector<HTMLButtonElement>(".now-playing__quality-badge")!;
    expect(badge.hasAttribute("hidden")).toBe(true);

    storage.saveSettings({ audioQuality: "lossless" });
    expect(badge.hasAttribute("hidden")).toBe(false);
    expect(badge.textContent).toContain("Lossless");
    expect(badge.classList.contains("now-playing__quality-badge--lossless")).toBe(true);
  });
});
