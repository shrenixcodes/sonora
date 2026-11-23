/**
 * YouTube Music account status.
 *
 * Follows the signed-in flag the YouTube Music page reports with its playback
 * state, and loads the signed-in Google account's name and picture. `null`
 * means the page hasn't reported yet.
 */

import { EventEmitter } from "@/lib/events";
import { ytmBridge, type YtmState } from "@/lib/playback/ytm-bridge";
import { catalog, type AccountProfile } from "@/lib/ytm/catalog";

export type { AccountProfile };

type Listen = (handler: (state: YtmState) => void) => Promise<unknown>;
type LoadProfile = () => Promise<AccountProfile | null>;

export class AccountStatus extends EventEmitter<{
  change: boolean;
  profile: AccountProfile | null;
  /** A sign-in the user started from Sonora has just finished. */
  signInComplete: void;
}> {
  private signedIn: boolean | null = null;
  private currentProfile: AccountProfile | null = null;
  private signInStarted = false;
  private profileRequest = 0;

  constructor(
    listen: Listen | null,
    private readonly loadProfile: LoadProfile | null = null,
  ) {
    super();
    listen?.((state) => this.update(state.signedIn)).catch((err) =>
      console.error("[account] could not follow YouTube Music sign-in:", err),
    );
  }

  get isSignedIn(): boolean | null {
    return this.signedIn;
  }

  get profile(): AccountProfile | null {
    return this.currentProfile;
  }

  /** Call when opening the sign-in window, so its completion can be confirmed. */
  beginSignIn(): void {
    this.signInStarted = true;
  }

  /** Public for tests. */
  update(signedIn: boolean): void {
    if (signedIn === this.signedIn) return;
    this.signedIn = signedIn;
    this.emit("change", signedIn);
    this.refreshProfile();
    if (signedIn && this.signInStarted) {
      this.signInStarted = false;
      this.emit("signInComplete", undefined);
    }
  }

  private refreshProfile(): void {
    const request = ++this.profileRequest;
    this.setProfile(null);
    if (!this.signedIn || !this.loadProfile) return;
    this.loadProfile()
      .then((profile) => {
        if (request === this.profileRequest) this.setProfile(profile);
      })
      .catch((err) => console.warn("[account] could not load the account profile:", err));
  }

  private setProfile(profile: AccountProfile | null): void {
    if (profile === this.currentProfile) return;
    this.currentProfile = profile;
    this.emit("profile", profile);
  }
}

export const account = ytmBridge.available
  ? new AccountStatus((h) => ytmBridge.onState(h), () => catalog.getAccountProfile())
  : new AccountStatus(null);
