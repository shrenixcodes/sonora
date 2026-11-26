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

import { createPlayer } from "../src/components/player";
import { audioDeviceIconName, icon, icons, type AudioDeviceIconType, type AudioTransportIconType, type IconName } from "../src/icons";
import { audioDevices, type AudioOutputDevice, type AudioOutputSnapshot } from "../src/lib/audio-devices";
import { storage } from "../src/lib/storage";

function normalizedSvg(name: IconName): string {
  const probe = document.createElement("span");
  probe.innerHTML = icon(name);
  return probe.innerHTML;
}

const speakers: AudioOutputDevice = {
  id: "{0.0.0.00000000}.{speakers}",
  name: "Realtek Speakers",
  description: "Realtek Audio",
  deviceType: "speaker",
  transport: "wired",
  isDefault: true,
};

const btHeadphones: AudioOutputDevice = {
  id: "{0.0.0.00000000}.{bt-xm5}",
  name: "WH-1000XM5 Stereo",
  description: "Bluetooth Audio",
  deviceType: "headphones",
  transport: "bluetooth",
  isDefault: false,
};

const wiredHeadset: AudioOutputDevice = {
  id: "{0.0.0.00000000}.{usb-headset}",
  name: "HyperX Wired Headset",
  description: "USB Audio",
  deviceType: "headset",
  transport: "wired",
  isDefault: false,
};

const wirelessEarbuds: AudioOutputDevice = {
  id: "{0.0.0.00000000}.{buds}",
  name: "Galaxy Buds2 Pro",
  description: "Bluetooth",
  deviceType: "earbuds",
  transport: "bluetooth",
  isDefault: false,
};

describe("Microphone lyrics button and per-app audio output device switcher", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("sonora:discord_rpc_migrated", "true");
    audioDevices.resetForTest();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockReset();
  });

  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("provides a distinct icon for every device type and wired/wireless/bluetooth combination", () => {
    const types: AudioDeviceIconType[] = [
      "speaker",
      "headphones",
      "headset",
      "earbuds",
      "monitor",
      "dac",
      "handset",
      "generic",
    ];
    const transports: AudioTransportIconType[] = ["wired", "wireless", "bluetooth"];

    const seenNames = new Set<string>();
    const seenSvgs = new Set<string>();
    for (const type of types) {
      for (const transport of transports) {
        const key = audioDeviceIconName(type, transport);
        expect(seenNames.has(key)).toBe(false);
        seenNames.add(key);
        const svg = icons[key];
        expect(svg).toContain("<svg");
        expect(seenSvgs.has(svg)).toBe(false);
        seenSvgs.add(svg);
      }
    }
    expect(seenNames.size).toBe(24);
  });

  it("renders microphone lyrics button, removes the redundant maximize button, and defaults to system output", async () => {
    const initial: AudioOutputSnapshot = {
      devices: [speakers, btHeadphones, wirelessEarbuds],
      selectedDeviceId: null,
      effectiveDeviceId: speakers.id,
      canRoutePerApp: true,
    };
    invokeMock.mockResolvedValue(initial);

    const player = createPlayer();
    document.body.appendChild(player);

    const lyricsBtn = player.querySelector<HTMLButtonElement>('button[aria-label="Lyrics"]')!;
    expect(lyricsBtn).not.toBeNull();
    expect(lyricsBtn.innerHTML).toBe(normalizedSvg("lyrics"));
    expect(icons.lyrics).not.toBe(icons.microphone);
    expect(player.querySelector('button[aria-label="Now Playing"]')).toBeNull();

    const deviceBtn = player.querySelector<HTMLButtonElement>(".player__device-btn")!;
    await vi.waitFor(() => {
      expect(deviceBtn.innerHTML).toBe(normalizedSvg("deviceSpeakerWired"));
      expect(deviceBtn.getAttribute("aria-label")).toContain("System Default — Realtek Speakers");
    });
  });

  it("lets the user steer only Sonora to a Bluetooth or wired device and switch back to System Default", async () => {
    let selectedId: string | null = null;
    const allDevices = [speakers, btHeadphones, wiredHeadset];
    invokeMock.mockImplementation(async (cmd: string, args?: { deviceId?: string | null }) => {
      if (cmd === "get_audio_output_devices") {
        return {
          devices: allDevices,
          selectedDeviceId: selectedId,
          effectiveDeviceId: selectedId ?? speakers.id,
          canRoutePerApp: true,
        };
      }
      if (cmd === "set_audio_output_device") {
        selectedId = args?.deviceId ?? null;
        return {
          devices: allDevices,
          selectedDeviceId: selectedId,
          effectiveDeviceId: selectedId ?? speakers.id,
          canRoutePerApp: true,
        };
      }
      return null;
    });

    const player = createPlayer();
    document.body.appendChild(player);

    const deviceBtn = player.querySelector<HTMLButtonElement>(".player__device-btn")!;
    await vi.waitFor(() => {
      expect(deviceBtn.innerHTML).toBe(normalizedSvg("deviceSpeakerWired"));
    });

    // Open menu
    deviceBtn.click();
    const menu = document.querySelector<HTMLElement>(".audio-device-menu")!;
    expect(menu.textContent).toContain("Sonora app only");

    // Switch to Bluetooth Headphones
    const btOption = menu.querySelector<HTMLButtonElement>(`button[data-device-id="${btHeadphones.id}"]`)!;
    expect(btOption.innerHTML).toContain(normalizedSvg("deviceHeadphonesBluetooth"));
    btOption.click();

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_audio_output_device", { deviceId: btHeadphones.id });
      expect(deviceBtn.innerHTML).toBe(normalizedSvg("deviceHeadphonesBluetooth"));
      expect(deviceBtn.classList.contains("player__extra-btn--active")).toBe(true);
    });
    expect(storage.getSettings().audioOutputDeviceId).toBe(btHeadphones.id);
    expect(document.querySelector(".audio-device-menu")).toBeNull();

    // Reopen and switch back to System Default
    deviceBtn.click();
    const defaultOption = document.querySelector<HTMLButtonElement>('.audio-device-menu button[data-device-id="default"]')!;
    defaultOption.click();

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_audio_output_device", { deviceId: null });
      expect(deviceBtn.innerHTML).toBe(normalizedSvg("deviceSpeakerWired"));
      expect(deviceBtn.classList.contains("player__extra-btn--active")).toBe(false);
    });
    expect(storage.getSettings().audioOutputDeviceId).toBeNull();
  });

  it("throttles redundant audio enumeration across rapid window focus events", async () => {
    invokeMock.mockResolvedValue({
      devices: [speakers],
      selectedDeviceId: null,
      effectiveDeviceId: speakers.id,
      canRoutePerApp: true,
    });

    await audioDevices.init();
    const initialCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_audio_output_devices").length;

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    const afterFocusCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_audio_output_devices").length;
    expect(afterFocusCalls).toBe(initialCalls);
  });
});
