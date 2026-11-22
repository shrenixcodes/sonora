/**
 * Client for the YouTube Music bridge (src-tauri/src/ytm.rs).
 *
 * Playback runs in the official music.youtube.com web app inside a hidden
 * window; this module sends it commands and receives its playback state.
 * Only available inside the desktop app.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrors `YtmState` in ytm.rs. */
export interface YtmState {
  reason: string;
  videoId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** True while YouTube plays an ad; metadata then describes the ad. */
  ad: boolean;
  /** YouTube Music's own signed-in flag. */
  signedIn: boolean;
}

/** Mirrors `YtmCommand` in ytm.rs. */
export type YtmCommand =
  | { action: "play" | "pause" | "toggle" | "next" | "previous" }
  | { action: "seek"; value: number }
  | { action: "volume"; value: number }
  | { action: "load"; value: string };

export const ytmBridge = {
  get available(): boolean {
    return isTauri();
  },

  control(command: YtmCommand): Promise<void> {
    return invoke("ytm_control", { command });
  },

  onState(handler: (state: YtmState) => void): Promise<UnlistenFn> {
    return listen<YtmState>("ytm://state", (event) => handler(event.payload));
  },

  /** Clears the YouTube Music window's sign-in and reloads it signed out. */
  signOut(): Promise<void> {
    return invoke("ytm_sign_out");
  },

  /** Shows the YouTube Music window so the user can sign in, or hides it. */
  setSignInVisible(visible: boolean): Promise<void> {
    return invoke("ytm_set_signin_visible", { visible });
  },
};
