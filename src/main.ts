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
import { applyAmbience } from "@/lib/ambience";
import { initWindowMode } from "@/lib/window-mode";
import { searchQuery } from "@/lib/search-query";
import { account } from "@/lib/ytm/account";
import { showSignInConfirmation } from "@/components/sign-in-confirm";

// Views
import { renderHome } from "@/views/home";
import { renderExplore } from "@/views/explore";
import { renderSearch } from "@/views/search";
import { renderLibrary } from "@/views/library";
import { renderSettings } from "@/views/settings";
import { renderNowPlaying } from "@/views/now-playing";

import { themeManager } from "@/lib/theme";
import { applyAccent } from "@/lib/accent";

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
  const player = createPlayer();

  app.appendChild(titlebar);
  app.appendChild(sidebar);
  app.appendChild(main);
  app.appendChild(createQueuePanel());
  app.appendChild(player);
  queuePanel.init();

  // Floating vs full layout; also reveals the window after first paint
  initWindowMode().catch((err) => console.error("[main] window mode setup failed:", err));

  // Register routes
  router
    .route("/", renderHome)
    .route("/explore", renderExplore)
    .route("/search", renderSearch)
    .route("/library", renderLibrary)
    .route("/liked", renderLibrary)
    .route("/playlists", renderLibrary)
    .route("/albums", renderLibrary)
    .route("/artists", renderLibrary)
    .route("/history", renderLibrary)
    .route("/settings", renderSettings)
    .route("/now-playing", renderNowPlaying);

  // Start the router
  router.start(main);

  // Tint the shell with the current artwork
  playerEngine.on("paletteChange", (palette) => applyAmbience(palette));

  // Confirm which Google account a sign-in from Settings ended up using
  account.on("signInComplete", showSignInConfirmation);

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

    // Avoid capturing keys when user is typing in a text field
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
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
          window.history.back();
        } else {
          router.navigate("/now-playing");
        }
        break;
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
