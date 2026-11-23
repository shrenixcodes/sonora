/**
 * Launch splash — the liquid launch sequence from symbiote.ts.
 *
 * Kept as its own module so callers (startup, About, Settings, F8) have one
 * name for "the launch animation" regardless of how it is drawn.
 */

import { playLaunchAnimation, primeLaunch, resetSymbioteState } from "./symbiote";

export interface SplashOptions {
  /** Play again even if it already ran, or motion is reduced (previews). */
  force?: boolean;
}

/** Hides the interface ahead of the first paint; returns whether the launch will play. */
export function prepareLaunchSplash(): boolean {
  return primeLaunch();
}

/** Plays the launch sequence. Resolves when it has finished or been skipped. */
export function showLaunchSplash(options: SplashOptions = {}): Promise<void> {
  return playLaunchAnimation(options);
}

/** Resets the once-per-launch flag (tests). */
export function resetLaunchSplashFlag(): void {
  resetSymbioteState();
}
