/**
 * Sonora — Application entry point.
 *
 * Assembles the shell (titlebar, sidebar, main content, player)
 * and initializes the router.
 */

import { createTitlebar } from "@/components/titlebar";
import { createSidebar } from "@/components/sidebar";
import { createPlayer } from "@/components/player";
import { router } from "@/lib/router";
import { el } from "@/lib/dom";

// Views
import { renderHome } from "@/views/home";
import { renderExplore } from "@/views/explore";
import { renderSearch } from "@/views/search";
import { renderLibrary } from "@/views/library";
import { renderSettings } from "@/views/settings";
import { renderNowPlaying } from "@/views/now-playing";

// Initialize the theme system (side-effect import)
import "@/lib/theme";

function init(): void {
  const app = document.getElementById("app");
  if (!app) return;

  // Build the application shell
  const titlebar = createTitlebar();
  const sidebar = createSidebar();
  const main = el("main", { className: "main" });
  const player = createPlayer();

  app.appendChild(titlebar);
  app.appendChild(sidebar);
  app.appendChild(main);
  app.appendChild(player);

  // Register routes
  router
    .route("/", renderHome)
    .route("/explore", renderExplore)
    .route("/search", renderSearch)
    .route("/library", renderLibrary)
    .route("/liked", renderLibrary) // shares library view for now
    .route("/playlists", renderLibrary)
    .route("/albums", renderLibrary)
    .route("/artists", renderLibrary)
    .route("/history", renderLibrary)
    .route("/settings", renderSettings)
    .route("/now-playing", renderNowPlaying);

  // Start the router
  router.start(main);

  // Update greeting based on time of day
  updateGreeting();
}

function updateGreeting(): void {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const hash = window.location.hash;
  if (hash === "" || hash === "#/") {
    const title = document.querySelector(".page-header__title");
    if (title) {
      title.textContent = greeting;
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
