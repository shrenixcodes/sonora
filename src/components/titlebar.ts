/**
 * Custom window titlebar.
 *
 * Provides drag-to-move, back/forward navigation, and
 * minimize/maximize/close controls using the Tauri window API.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { el } from "@/lib/dom";
import { icon } from "@/icons";

export function createTitlebar(): HTMLElement {
  const appWindow = getCurrentWindow();

  const titlebar = el("header", {
    className: "titlebar",
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

      // Center: app title
      el("div", {
        className: "titlebar__center",
        children: [
          el("span", {
            className: "titlebar__title",
            text: "Sonora",
          }),
        ],
      }),

      // Right: window controls
      el("div", {
        className: "titlebar__right",
        children: [
          el("button", {
            className: "titlebar__window-btn",
            html: icon("minimize"),
            attrs: { "aria-label": "Minimize" },
            onClick: () => appWindow.minimize(),
          }),
          el("button", {
            className: "titlebar__window-btn",
            html: icon("maximize"),
            attrs: { "aria-label": "Maximize" },
            onClick: () => appWindow.toggleMaximize(),
          }),
          el("button", {
            className: "titlebar__window-btn titlebar__window-btn--close",
            html: icon("close"),
            attrs: { "aria-label": "Close" },
            onClick: () => appWindow.close(),
          }),
        ],
      }),
    ],
  });

  return titlebar;
}
