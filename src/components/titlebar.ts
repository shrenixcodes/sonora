/**
 * Custom window titlebar.
 *
 * Provides drag-to-move (via data-tauri-drag-region), back/forward/refresh navigation,
 * the app-wide search field, and minimize/maximize/close controls.
 */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowHandle = ReturnType<typeof getCurrentWindow>;
import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { catalog } from "@/lib/ytm/catalog";
import { prepareMinimize } from "@/lib/visuals/symbiote";

const GRIP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;

/**
 * A window in fullscreen ignores maximize and minimizes badly, which left these
 * buttons looking broken after Now Playing had been opened fullscreen. Fullscreen
 * is a mode of its own, so step out of it before working the window.
 */
async function leaveFullscreen(appWindow: WindowHandle): Promise<void> {
  try {
    if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false);
  } catch (err) {
    console.error("[titlebar] could not leave fullscreen:", err);
  }
}

export function createTitlebar(): HTMLElement {
  // Window controls need the Tauri runtime; in a plain browser (UI development) they do nothing.
  const appWindow = isTauri() ? getCurrentWindow() : null;

  const startWindowDrag = (e: MouseEvent) => {
    if (e.button === 0 && appWindow) {
      appWindow.startDragging().catch((err) => {
        console.error("[titlebar] startDragging failed:", err);
      });
    }
  };

  const titlebar = el("header", {
    className: "titlebar",
    // Tauri only starts a window drag when the pressed element itself carries this attribute.
    attrs: { "data-tauri-drag-region": "" },
    children: [
      // Left: navigation buttons
      el("div", {
        className: "titlebar__left",
        attrs: { "data-tauri-drag-region": "" },
        children: [
          // Drag handle for the floating layout, where the gaps around panels are click-through.
          el("span", {
            className: "titlebar__grip",
            attrs: { "data-tauri-drag-region": "", title: "Drag to move", "aria-hidden": "true" },
            html: GRIP_ICON,
          }),
          el("div", {
            className: "titlebar__nav",
            children: [
              el("button", {
                className: "titlebar__nav-btn",
                html: icon("chevronLeft"),
                attrs: {
                  "aria-label": "Go back",
                  title: "Go back",
                },
                onClick: () => window.history.back(),
              }),
              el("button", {
                className: "titlebar__nav-btn",
                html: icon("chevronRight"),
                attrs: {
                  "aria-label": "Go forward",
                  title: "Go forward",
                },
                onClick: () => window.history.forward(),
              }),
              el("button", {
                className: "titlebar__nav-btn titlebar__nav-btn--refresh",
                html: icon("refresh"),
                attrs: {
                  "aria-label": "Refresh",
                  title: "Refresh from YouTube Music",
                },
                onClick: (e) => {
                  const btn = e.currentTarget as HTMLElement;
                  btn.classList.remove("is-spinning");
                  void btn.offsetWidth; // restart the spin on repeated clicks
                  btn.classList.add("is-spinning");
                  catalog.clearCache();
                  router.refresh();
                },
              }),
            ],
          }),
        ],
      }),

      // Center: search
      el("div", {
        className: "titlebar__center",
        attrs: { "data-tauri-drag-region": "" },
        children: [createSearchField()],
      }),

      // Right: window controls
      el("div", {
        className: "titlebar__right",
        children: [
          el("button", {
            className: "titlebar__window-btn",
            html: icon("minimize"),
            attrs: { "aria-label": "Minimize", title: "Minimize" },
            onClick: async () => {
              if (!appWindow) return;
              await appWindow.setIgnoreCursorEvents(false).catch(() => {});
              await leaveFullscreen(appWindow);
              // Fade the shell out first, so restoring never flashes the old frame
              await prepareMinimize();
              await appWindow.minimize();
            },
          }),
          createMaximizeButton(appWindow),
          el("button", {
            className: "titlebar__window-btn titlebar__window-btn--close",
            html: icon("close"),
            attrs: { "aria-label": "Close", title: "Close" },
            onClick: () => appWindow?.close(),
          }),
        ],
      }),
    ],
  });

  titlebar.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0 || !appWindow) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, input, select, textarea, a, .no-drag")) return;
    if (target.closest("[data-tauri-drag-region]") || target === titlebar) {
      startWindowDrag(e);
    }
  });

  return titlebar;
}

/** Maximize/restore button that stays in sync with window state. */
function createMaximizeButton(appWindow: WindowHandle | null): HTMLElement {
  const btn = el("button", {
    className: "titlebar__window-btn",
    html: icon("maximize"),
    attrs: { "aria-label": "Maximize", title: "Maximize" },
    onClick: async () => {
      if (!appWindow) return;
      await leaveFullscreen(appWindow);
      await appWindow.toggleMaximize();
      await updateState();
    },
  });

  const updateState = async () => {
    if (!appWindow) return;
    try {
      const isMax = await appWindow.isMaximized();
      btn.innerHTML = icon(isMax ? "restore" : "maximize");
      const label = isMax ? "Restore" : "Maximize";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
    } catch (err) {
      console.error("[titlebar] failed to check maximized state:", err);
    }
  };

  if (appWindow) {
    void updateState();
    appWindow.onResized(() => void updateState()).catch(() => {});
  }

  return btn;
}

/** The app's single search field; typing opens the search view with live results. */
function createSearchField(): HTMLElement {
  const input = el("input", {
    className: "titlebar__search-input",
    attrs: {
      type: "search",
      placeholder: "What do you want to play?",
      "aria-label": "Search songs, albums and artists",
      autocomplete: "off",
      spellcheck: "false",
    },
  }) as HTMLInputElement;

  input.addEventListener("input", () => {
    searchQuery.set(input.value.trim());
    if (router.current !== "/search") router.navigate("/search");
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Chromium clears search fields on Escape without an input event; keep the text in sync instead.
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Enter" && router.current !== "/search") router.navigate("/search");
  });

  // Reflect queries set elsewhere (e.g. Explore's mood cards)
  searchQuery.on("change", (query) => {
    if (input.value.trim() !== query) input.value = query;
  });

  searchQuery.on("focusRequest", () => {
    input.focus();
    input.select();
  });

  return el("label", {
    className: "titlebar__search",
    children: [
      el("span", { className: "titlebar__search-icon", html: icon("search") }),
      input,
      el("kbd", { className: "titlebar__search-hint", text: "Ctrl K", attrs: { "aria-hidden": "true" } }),
    ],
  });
}
