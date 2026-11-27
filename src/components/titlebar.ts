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
import { setOptimisticMaximized, subscribeWindowMode } from "@/lib/window-mode";

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
          createNavControls(),
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

/** Maximize/restore button that stays in sync with window state without duplicate IPC polling. */
function createMaximizeButton(appWindow: WindowHandle | null): HTMLElement {
  let currentMax = false;
  const btn = el("button", {
    className: "titlebar__window-btn",
    html: icon("maximize"),
    attrs: { "aria-label": "Maximize", title: "Maximize" },
    onClick: async () => {
      if (!appWindow) return;
      await leaveFullscreen(appWindow);
      const nextMax = !currentMax;
      applyButtonState(nextMax);
      setOptimisticMaximized(nextMax);
      await appWindow.toggleMaximize();
    },
  });

  const applyButtonState = (isMax: boolean) => {
    currentMax = isMax;
    btn.innerHTML = icon(isMax ? "restore" : "maximize");
    const label = isMax ? "Restore" : "Maximize";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  };

  if (appWindow) {
    subscribeWindowMode(({ maximized }) => applyButtonState(maximized));
  }

  return btn;
}

/** Back, forward, and refresh buttons wired to router history state. */
function createNavControls(): HTMLElement {
  const backBtn = el("button", {
    className: "titlebar__nav-btn",
    html: icon("chevronLeft"),
    attrs: {
      type: "button",
      "aria-label": "Go back",
      title: "Go back",
    },
    onClick: () => router.back(),
  }) as HTMLButtonElement;

  const forwardBtn = el("button", {
    className: "titlebar__nav-btn",
    html: icon("chevronRight"),
    attrs: {
      type: "button",
      "aria-label": "Go forward",
      title: "Go forward",
    },
    onClick: () => router.forward(),
  }) as HTMLButtonElement;

  const refreshBtn = el("button", {
    className: "titlebar__nav-btn titlebar__nav-btn--refresh",
    html: icon("refresh"),
    attrs: {
      type: "button",
      "aria-label": "Refresh",
      title: "Refresh from YouTube Music",
    },
    onClick: (e) => {
      const btn = e.currentTarget as HTMLElement;
      const anims = typeof btn.getAnimations === "function" ? btn.getAnimations() : [];
      if (btn.classList.contains("is-spinning") && anims.length > 0) {
        anims.forEach((anim) => {
          anim.currentTime = 0;
          anim.play();
        });
      } else {
        btn.classList.remove("is-spinning");
        requestAnimationFrame(() => btn.classList.add("is-spinning"));
      }
      catalog.clearCache();
      router.refresh();
    },
  });

  const nav = el("div", {
    className: "titlebar__nav",
    children: [backBtn, forwardBtn, refreshBtn],
  });

  let wasConnected = false;
  let unsubNav: (() => void) | null = null;
  const syncNavButtons = () => {
    if (wasConnected && !nav.isConnected) {
      unsubNav?.();
      unsubNav = null;
      return;
    }
    if (nav.isConnected) wasConnected = true;
    backBtn.disabled = !router.canGoBack;
    forwardBtn.disabled = !router.canGoForward;
  };

  syncNavButtons();
  unsubNav = router.onNavigate(syncNavButtons);
  return nav;
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
  input.value = searchQuery.value;

  const clearBtn = el("button", {
    className: "titlebar__search-clear",
    html: icon("close"),
    attrs: {
      type: "button",
      "aria-label": "Clear search",
      title: "Clear search",
    },
  }) as HTMLButtonElement;

  const container = el("label", {
    className: "titlebar__search",
    children: [
      el("span", { className: "titlebar__search-icon", html: icon("search") }),
      input,
      clearBtn,
      el("kbd", { className: "titlebar__search-hint", text: "Ctrl K", attrs: { "aria-hidden": "true" } }),
    ],
  });

  const syncClearState = () => {
    const hasValue = input.value.length > 0;
    clearBtn.hidden = !hasValue;
    container.classList.toggle("titlebar__search--has-value", hasValue);
  };
  syncClearState();

  input.addEventListener("input", () => {
    syncClearState();
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

  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = "";
    syncClearState();
    searchQuery.set("");
    input.focus();
  });

  let wasConnected = false;
  let unsubChange: (() => void) | null = null;
  let unsubFocus: (() => void) | null = null;

  const cleanupIfDetached = (): boolean => {
    if (wasConnected && !container.isConnected) {
      unsubChange?.();
      unsubFocus?.();
      unsubChange = null;
      unsubFocus = null;
      return true;
    }
    if (container.isConnected) wasConnected = true;
    return false;
  };

  // Reflect queries set elsewhere (e.g. Explore's mood cards)
  unsubChange = searchQuery.on("change", (query) => {
    if (cleanupIfDetached()) return;
    if (input.value.trim() !== query) input.value = query;
    syncClearState();
  });

  unsubFocus = searchQuery.on("focusRequest", () => {
    if (cleanupIfDetached()) return;
    input.focus();
    input.select();
  });

  return container;
}
