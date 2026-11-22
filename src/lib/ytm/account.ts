/**
 * YouTube Music account status.
 *
 * Follows the signed-in flag the YouTube Music page reports with its playback
 * state. `null` means the page hasn't reported yet.
 */

import { EventEmitter } from "@/lib/events";
import { ytmBridge, type YtmState } from "@/lib/playback/ytm-bridge";

type Listen = (handler: (state: YtmState) => void) => Promise<unknown>;

export class AccountStatus extends EventEmitter<{ change: boolean }> {
  private signedIn: boolean | null = null;

  constructor(listen: Listen | null) {
    super();
    listen?.((state) => this.update(state.signedIn)).catch((err) =>
      console.error("[account] could not follow YouTube Music sign-in:", err),
    );
  }

  get isSignedIn(): boolean | null {
    return this.signedIn;
  }

  /** Public for tests. */
  update(signedIn: boolean): void {
    if (signedIn === this.signedIn) return;
    this.signedIn = signedIn;
    this.emit("change", signedIn);
  }
}

export const account = new AccountStatus(ytmBridge.available ? (h) => ytmBridge.onState(h) : null);
