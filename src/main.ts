/**
 * Sonora — Application entry point.
 *
 * Assembles the shell (titlebar, sidebar, main content, player),
 * initializes the router, applies user preferences, and registers global keyboard shortcuts.
 */

import { createTitlebar } from "@/components/titlebar";
import { createSidebar } from "@/components/sidebar";
import { createPlayer } from "@/components/player";
import { createQueuePanel, queuePanel } from "@/components/queue-panel";
import { router } from "@/lib/router";
import { el } from "@/lib/dom";
import { storage } from "@/lib/storage";
import { playerEngine } from "@/lib/playback/engine";
import { AmbientArtwork, applyAmbience, applyArtworkAccent } from "@/lib/ambience";
import { initWindowMode } from "@/lib/window-mode";
import { discordRpc } from "@/lib/discord-rpc";
import { searchQuery } from "@/lib/search-query";
import { account } from "@/lib/ytm/account";
import { catalog } from "@/lib/ytm/catalog";
import { showAboutPopup } from "@/components/about-popup";
import { showSignInConfirmation } from "@/components/sign-in-confirm";
import { describeUpdateSnapshot, updater } from "@/lib/updater";

// Views
import { renderHome } from "@/views/home";
import { renderExplore } from "@/views/explore";
import { renderSearch } from "@/views/search";
import { renderLibrary } from "@/views/library";
import { renderCollection } from "@/views/collection";
import { renderArtist } from "@/views/artist";
import { renderSettings } from "@/views/settings";
import { renderNowPlaying } from "@/views/now-playing";

import { themeManager } from "@/lib/theme";
import { applyAccent } from "@/lib/accent";
import type { ArtworkPalette } from "@/lib/visuals/color-extractor";
import { initRestoreAnimation, setLiquidPalette, triggerRestoreAnimation, type RevealMode } from "@/lib/visuals/symbiote";
import { initRubberbandUX } from "@/lib/rubberband";
import { prepareLaunchSplash, showLaunchSplash } from "@/lib/visuals/splash-screen";

const ARTWORK_PLACEHOLDER = "/artwork-placeholder.svg";

function init(): void {
  const app = document.getElementById("app");
  if (!app) return;

  // Apply saved appearance preferences
  const settings = storage.getSettings();
  applyAccent(settings.accentColor, themeManager.theme);
  themeManager.onChange((theme) => applyAccent(storage.getSettings().accentColor, theme));
  if (settings.density === "compact") {
    document.body.classList.add("density-compact");
  }

  // Build the application shell
  const titlebar = createTitlebar();
  const sidebar = createSidebar();
  const main = el("main", { className: "main" });
  const mainContent = el("div", { className: "main__scroll-content" });
  main.appendChild(mainContent);
  const player = createPlayer();

  // Artwork of the playing track sits behind every panel
  const ambientArtwork = new AmbientArtwork();
  app.appendChild(ambientArtwork.element);
  app.appendChild(titlebar);
  app.appendChild(sidebar);
  app.appendChild(main);
  app.appendChild(createQueuePanel());
  app.appendChild(player);
  queuePanel.init();
  discordRpc.init();
  initRestoreAnimation();
  initRubberbandUX();
  initLaunchAutoUpdater();

  // Manual animation preview shortcuts: F8 = Splash, F9 = Taskbar restore
  window.addEventListener("keydown", (e) => {
    if (e.key === "F8") {
      e.preventDefault();
      showLaunchSplash({ force: true }).catch(() => {});
    } else if (e.key === "F9") {
      e.preventDefault();
      triggerRestoreAnimation({ force: true });
    }
  });

  // Developer / test hooks
  (window as unknown as Record<string, unknown>).__sonora_test_splash = () =>
    showLaunchSplash({ force: true });
  (window as unknown as Record<string, unknown>).__sonora_test_restore = (mode?: RevealMode) =>
    triggerRestoreAnimation({ force: true, mode });

  // Floating vs full layout; also reveals the window after first paint.
  // The shell stays hidden until then, and the launch builds it once the window is up.
  const launching = prepareLaunchSplash();
  initWindowMode()
    .catch((err) => console.error("[main] window mode setup failed:", err))
    .finally(() => {
      if (launching) showLaunchSplash().catch((err) => console.error("[main] launch animation failed:", err));
    });

  // Register routes
  router
    .route("/", renderHome)
    .route("/explore", renderExplore)
    .route("/search", renderSearch)
    .route("/liked", renderLibrary)
    .route("/playlists", renderLibrary)
    .route("/albums", renderLibrary)
    .route("/artists", renderLibrary)
    .route("/history", renderLibrary)
    .route("/playlist", renderCollection)
    .route("/artist", renderArtist)
    .route("/settings", renderSettings)
    .route("/now-playing", renderNowPlaying);

  // Start the router
  router.start(mainContent);

  // Tint the shell with the current artwork
  // The shell, its buttons and floating pieces all adapt to the artwork's colors
  let palette: ArtworkPalette | null = playerEngine.currentPalette;
  setLiquidPalette(palette);
  playerEngine.on("paletteChange", (next) => {
    palette = next;
    setLiquidPalette(next);
    applyAmbience(next);
    applyArtworkAccent(next, themeManager.theme, app);
  });
  themeManager.onChange((theme) => applyArtworkAccent(palette, theme, app));
  playerEngine.on("trackChange", (track) => ambientArtwork.set(track?.artworkUrl || null));
  ambientArtwork.set(playerEngine.currentTrack?.artworkUrl || null);

  // Artwork that fails to load shows the placeholder instead of a broken image
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img.closest(".ambient-art")) return;
      if (img.getAttribute("src") === ARTWORK_PLACEHOLDER) return;
      img.src = ARTWORK_PLACEHOLDER;
    },
    true,
  );

  // Confirm which Google account a sign-in from Settings ended up using
  account.on("signInComplete", showSignInConfirmation);

  // Sync liked tracks to YouTube Music when liked in Sonora
  storage.on("likeChange", ({ trackId, isLiked }) => {
    catalog.rateTrack(trackId, isLiked);
  });

  // Register desktop keyboard shortcuts
  setupGlobalShortcuts();
}

function setupGlobalShortcuts(): void {
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    // Ctrl+K reaches search from anywhere, including other text fields
    if (e.ctrlKey && e.code === "KeyK") {
      e.preventDefault();
      searchQuery.requestFocus();
      return;
    }

    // Avoid capturing keys when user is typing in a text field or navigating a dropdown
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        (active as HTMLElement).isContentEditable)
    ) {
      return;
    }

    switch (e.code) {
      case "Space":
        e.preventDefault();
        playerEngine.togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        playerEngine.seekTo(playerEngine.currentState.currentTime - 5);
        break;
      case "ArrowRight":
        e.preventDefault();
        playerEngine.seekTo(playerEngine.currentState.currentTime + 5);
        break;
      case "ArrowUp":
        e.preventDefault();
        playerEngine.setVolume(playerEngine.currentState.volume + 0.05);
        break;
      case "ArrowDown":
        e.preventDefault();
        playerEngine.setVolume(playerEngine.currentState.volume - 0.05);
        break;
      case "KeyM":
        playerEngine.toggleMute();
        break;
      case "KeyL": {
        const track = playerEngine.currentTrack;
        if (track) {
          storage.toggleLike(track);
        }
        break;
      }
      case "KeyF":
        if (window.location.hash === "#/now-playing") {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            router.navigate("/");
          }
        } else {
          router.navigate("/now-playing");
        }
        break;
    }
  });
}

// Initialize when DOM is ready
function initLaunchAutoUpdater(): void {
  let toast: HTMLElement | null = null;
  let dismissed = false;

  const renderToast = () => {
    const snap = updater.state;
    const active = snap.status === "available" || snap.status === "downloading" || snap.status === "installing";
    if (!active || dismissed) {
      toast?.remove();
      toast = null;
      return;
    }

    const { label } = describeUpdateSnapshot(snap);
    if (!toast) {
      const textEl = el("span", { className: "update-toast__text", text: label });
      const actionBtn = el("button", {
        className: "update-toast__action",
        text: "Details",
        attrs: { type: "button" },
        onClick: () => { void showAboutPopup(); },
      });
      const dismissBtn = el("button", {
        className: "update-toast__close",
        text: "×",
        attrs: { type: "button", "aria-label": "Dismiss update notice" },
        onClick: () => {
          dismissed = true;
          toast?.remove();
          toast = null;
        },
      });
      toast = el("div", {
        className: "update-toast",
        attrs: { role: "status", "aria-live": "polite" },
        children: [textEl, actionBtn, dismissBtn],
      });
      document.body.appendChild(toast);
    } else {
      const textEl = toast.querySelector<HTMLElement>(".update-toast__text");
      if (textEl) textEl.textContent = label;
    }
  };

  updater.on("change", renderToast);
  void updater.autoUpdateOnLaunch();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
