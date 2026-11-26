/**
 * Per-application audio output device enumeration and routing service.
 *
 * Defaults to the system's current desktop output device and lets the user
 * steer only Sonora's audio stream to any connected playback device (wired,
 * wireless, or Bluetooth) without modifying Windows' global default endpoint.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { audioDeviceIconName, type AudioDeviceIconType, type AudioTransportIconType, type IconName } from "@/icons";
import { EventEmitter } from "@/lib/events";
import { storage } from "@/lib/storage";

export type AudioDeviceType = AudioDeviceIconType;
export type AudioTransport = AudioTransportIconType;

export interface AudioOutputDevice {
  id: string;
  name: string;
  description: string;
  deviceType: AudioDeviceType;
  transport: AudioTransport;
  isDefault: boolean;
}

export interface AudioOutputSnapshot {
  devices: AudioOutputDevice[];
  selectedDeviceId: string | null;
  effectiveDeviceId: string | null;
  canRoutePerApp: boolean;
}

export interface AudioOutputState {
  devices: AudioOutputDevice[];
  selectedDeviceId: string | null;
  effectiveDeviceId: string | null;
  canRoutePerApp: boolean;
  busy: boolean;
  error: string | null;
}

interface AudioOutputEvents {
  change: AudioOutputState;
}

export const FALLBACK_OUTPUT_DEVICE: AudioOutputDevice = {
  id: "default",
  name: "System Speakers",
  description: "Desktop default audio output",
  deviceType: "speaker",
  transport: "wired",
  isDefault: true,
};

const TYPE_LABELS: Record<AudioDeviceType, string> = {
  speaker: "Speaker",
  headphones: "Headphones",
  headset: "Headset",
  earbuds: "Earbuds",
  monitor: "Display Audio",
  dac: "Audio Interface",
  handset: "Handset",
  generic: "Audio Device",
};

const TRANSPORT_LABELS: Record<AudioTransport, string> = {
  wired: "Wired",
  wireless: "Wireless",
  bluetooth: "Bluetooth",
};

export function iconNameForDevice(device: Pick<AudioOutputDevice, "deviceType" | "transport">): IconName {
  return audioDeviceIconName(device.deviceType, device.transport);
}

export function formatDeviceKind(device: Pick<AudioOutputDevice, "deviceType" | "transport">): string {
  return `${TRANSPORT_LABELS[device.transport]} ${TYPE_LABELS[device.deviceType]}`;
}

export function transportBadgeText(transport: AudioTransport): string {
  return TRANSPORT_LABELS[transport];
}

export class AudioDeviceController extends EventEmitter<AudioOutputEvents> {
  private state: AudioOutputState = {
    devices: [FALLBACK_OUTPUT_DEVICE],
    selectedDeviceId: null,
    effectiveDeviceId: FALLBACK_OUTPUT_DEVICE.id,
    canRoutePerApp: false,
    busy: false,
    error: null,
  };
  private initialized = false;
  private listenersAttached = false;

  get snapshot(): AudioOutputState {
    return {
      ...this.state,
      devices: [...this.state.devices],
    };
  }

  get activeDevice(): AudioOutputDevice {
    const { devices, effectiveDeviceId } = this.state;
    return (
      devices.find((d) => d.id === effectiveDeviceId) ??
      devices.find((d) => d.isDefault) ??
      devices[0] ??
      FALLBACK_OUTPUT_DEVICE
    );
  }

  get defaultDevice(): AudioOutputDevice {
    return this.state.devices.find((d) => d.isDefault) ?? this.state.devices[0] ?? FALLBACK_OUTPUT_DEVICE;
  }

  get activeIcon(): IconName {
    return iconNameForDevice(this.activeDevice);
  }

  resetForTest(): void {
    this.initialized = false;
    this.state = {
      devices: [FALLBACK_OUTPUT_DEVICE],
      selectedDeviceId: null,
      effectiveDeviceId: FALLBACK_OUTPUT_DEVICE.id,
      canRoutePerApp: false,
      busy: false,
      error: null,
    };
  }

  private setState(patch: Partial<AudioOutputState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("change", this.snapshot);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.attachHardwareListeners();

    await this.refresh();
    const savedId = storage.getSettings().audioOutputDeviceId ?? null;
    if (savedId && isTauri() && this.state.devices.some((d) => d.id === savedId)) {
      await this.select(savedId);
    }
  }

  private attachHardwareListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => {
        void this.refresh();
      });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => {
        if (this.initialized && isTauri()) {
          void this.refresh();
        }
      });
    }
  }

  async refresh(): Promise<AudioOutputState> {
    if (!isTauri()) {
      const savedId = storage.getSettings().audioOutputDeviceId ?? null;
      const valid = savedId && this.state.devices.some((d) => d.id === savedId) ? savedId : null;
      const fallbackDefault = this.defaultDevice.id;
      this.setState({
        selectedDeviceId: valid,
        effectiveDeviceId: valid ?? fallbackDefault,
        error: null,
      });
      return this.snapshot;
    }

    try {
      const snap = await invoke<AudioOutputSnapshot>("get_audio_output_devices");
      const devices = snap.devices.length > 0 ? snap.devices : [FALLBACK_OUTPUT_DEVICE];
      this.setState({
        devices,
        selectedDeviceId: snap.selectedDeviceId,
        effectiveDeviceId: snap.effectiveDeviceId ?? devices[0]?.id ?? null,
        canRoutePerApp: snap.canRoutePerApp,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || "Unable to list audio devices.");
      this.setState({ error: message });
    }
    return this.snapshot;
  }

  async select(deviceId: string | null): Promise<boolean> {
    const target = deviceId && deviceId !== "default" ? deviceId : null;

    if (!isTauri()) {
      const exists = target ? this.state.devices.some((d) => d.id === target) : true;
      const chosen = exists ? target : null;
      storage.saveSettings({ audioOutputDeviceId: chosen });
      this.setState({
        selectedDeviceId: chosen,
        effectiveDeviceId: chosen ?? this.defaultDevice.id,
        error: null,
      });
      return true;
    }

    this.setState({ busy: true, error: null });
    try {
      const snap = await invoke<AudioOutputSnapshot>("set_audio_output_device", {
        deviceId: target,
      });
      const devices = snap.devices.length > 0 ? snap.devices : [FALLBACK_OUTPUT_DEVICE];
      storage.saveSettings({ audioOutputDeviceId: snap.selectedDeviceId });
      this.setState({
        devices,
        selectedDeviceId: snap.selectedDeviceId,
        effectiveDeviceId: snap.effectiveDeviceId ?? devices[0]?.id ?? null,
        canRoutePerApp: snap.canRoutePerApp,
        busy: false,
        error: null,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || "Failed switching audio device.");
      this.setState({ busy: false, error: message });
      return false;
    }
  }
}

export const audioDevices = new AudioDeviceController();
