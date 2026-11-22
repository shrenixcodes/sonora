/**
 * Explore view.
 *
 * Browse music by mood, genre, and trending content.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";

export function renderExplore(container: HTMLElement): void {
  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Explore" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Discover new music, moods, and genres",
          }),
        ],
      }),
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("explore") }),
          el("h3", {
            className: "empty-state__title",
            text: "Connect to explore",
          }),
          el("p", {
            className: "empty-state__description",
            text: "Sign in with your YouTube Music account to browse trending music, moods, and genres.",
          }),
        ],
      }),
    ],
  });

  container.appendChild(content);
}
