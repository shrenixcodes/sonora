/**
 * Custom window titlebar.
 *
 * Provides drag-to-move (via data-tauri-drag-region), back/forward navigation,
 * the app-wide search field, and minimize/maximize/close controls.
 */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";

export function createTitlebar(): HTMLElement {
  // Window controls need the Tauri runtime; in a plain browser (UI development) they do nothing.
  const appWindow = isTauri() ? getCurrentWindow() : null;

  const titlebar = el("header", {
    className: "titlebar",
    // Tauri only starts a window drag when the pressed element itself carries this attribute.
    attrs: { "data-tauri-drag-region": "" },
    children: [
      // Left: navigation buttons
      el("div", {
        className: "titlebar__left",
        children: [
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
            attrs: { "aria-label": "Minimize" },
            onClick: () => appWindow?.minimize(),
          }),
          el("button", {
            className: "titlebar__window-btn",
            html: icon("maximize"),
            attrs: { "aria-label": "Maximize" },
            onClick: () => appWindow?.toggleMaximize(),
          }),
          el("button", {
            className: "titlebar__window-btn titlebar__window-btn--close",
            html: icon("close"),
            attrs: { "aria-label": "Close" },
            onClick: () => appWindow?.close(),
          }),
        ],
      }),
    ],
  });

  return titlebar;
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
