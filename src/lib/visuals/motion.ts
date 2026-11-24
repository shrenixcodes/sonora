import { isTauri } from "@tauri-apps/api/core";
import { storage } from "@/lib/storage";

/**
 * Determines whether animations and rich motion effects should be reduced.
 *
 * In the desktop app (Tauri), Sonora's custom voxel splash and magnetic restore
 * animations are signature features of the client and run smoothly by default.
 * Users can explicitly disable them via Settings if desired.
 *
 * In web and automated testing environments, standard CSS prefers-reduced-motion
 * queries are respected.
 */
export function shouldReduceMotion(): boolean {
  if (isTauri()) {
    try {
      const settings = storage.getSettings();
      if (
        settings &&
        "enableMotionEffects" in settings &&
        (settings as unknown as { enableMotionEffects?: boolean }).enableMotionEffects === false
      ) {
        return true;
      }
    } catch {
      // Storage unavailable during early bootstrap
    }
    return false;
  }

  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}
