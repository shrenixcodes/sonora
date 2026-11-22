/**
 * Library view.
 *
 * Shows the user's saved music: playlists, albums, artists,
 * and liked songs.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";

export function renderLibrary(container: HTMLElement): void {
  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Library" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Your saved music",
          }),
        ],
      }),
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("library") }),
          el("h3", {
            className: "empty-state__title",
            text: "Your library is empty",
          }),
          el("p", {
            className: "empty-state__description",
            text: "Save albums, playlists, and artists to build your personal library.",
          }),
        ],
      }),
    ],
  });

  container.appendChild(content);
}
