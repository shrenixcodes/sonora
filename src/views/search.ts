/**
 * Search view.
 *
 * Full-text search across songs, albums, artists, and playlists.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";

export function renderSearch(container: HTMLElement): void {
  const searchInput = el("input", {
    className: "search__input",
    attrs: {
      type: "text",
      placeholder: "Search songs, albums, artists...",
      autofocus: "",
    },
  });

  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Search" }),
        ],
      }),
      el("div", {
        className: "search__bar",
        children: [
          el("span", { className: "search__icon", html: icon("search") }),
          searchInput,
        ],
      }),
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("search") }),
          el("h3", {
            className: "empty-state__title",
            text: "Find your music",
          }),
          el("p", {
            className: "empty-state__description",
            text: "Search for songs, albums, artists, and playlists from YouTube Music.",
          }),
        ],
      }),
    ],
  });

  container.appendChild(content);

  // Focus the input after render
  requestAnimationFrame(() => searchInput.focus());
}
