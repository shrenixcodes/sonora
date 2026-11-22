/**
 * Search view.
 *
 * Songs from YouTube Music matching the titlebar search field. Shows a prompt
 * when empty, a busy state while searching, and a retry on failure.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { catalog, CatalogError } from "@/lib/ytm/catalog";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import type { Track } from "@/types/music";

const DEBOUNCE_MS = 300;

export function renderSearch(container: HTMLElement): void {
  let debounceTimer: number | null = null;
  const results = el("div", { className: "search__results", attrs: { "aria-live": "polite" } });

  container.appendChild(
    el("div", {
      className: "main__content",
      children: [
        el("div", {
          className: "page-header",
          children: [el("h1", { className: "page-header__title", text: "Search" })],
        }),
        results,
      ],
    }),
  );

  function showState(title: string, text: string, action?: HTMLElement): void {
    results.removeAttribute("aria-busy");
    results.replaceChildren(
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("search") }),
          el("h3", { className: "empty-state__title", text: title }),
          el("p", { className: "empty-state__description", text }),
          ...(action ? [action] : []),
        ],
      }),
    );
  }

  async function search(query: string): Promise<void> {
    results.setAttribute("aria-busy", "true");
    results.replaceChildren(el("p", { className: "empty-state__description", text: `Searching YouTube Music for “${query}”…` }));
    try {
      const songs = await catalog.searchSongs(query);
      // Ignore answers that arrive after the query has moved on
      if (query !== searchQuery.value || !results.isConnected) return;
      if (songs.length === 0) {
        showState("No songs found", "Try different words, or the artist's name.");
        return;
      }
      results.removeAttribute("aria-busy");
      results.replaceChildren(
        el("section", {
          className: "section",
          children: [
            el("div", {
              className: "section__header",
              children: [el("h2", { className: "section__title", text: "Songs" })],
            }),
            el("div", {
              className: "track-list",
              children: songs.map((song, i) => createTrackRow(song, i + 1, songs)),
            }),
          ],
        }),
      );
    } catch (err) {
      if (query !== searchQuery.value || !results.isConnected) return;
      const message = err instanceof CatalogError ? err.message : "Something went wrong while searching.";
      const canRetry = !(err instanceof CatalogError && err.reason === "unavailable");
      const retry = el("button", {
        className: "btn btn--secondary",
        text: "Try again",
        attrs: { type: "button" },
        onClick: () => search(query),
      });
      showState("Search didn't work", message, canRetry ? retry : undefined);
    }
  }

  function runQuery(query: string): void {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    if (!query) {
      showState("Find your music", "Type in the search bar above to find songs on YouTube Music.");
      return;
    }
    debounceTimer = window.setTimeout(() => search(query), DEBOUNCE_MS);
  }

  const stopListening = searchQuery.on("change", runQuery);
  const stopNavListener = router.onNavigate((path) => {
    if (path === "/search") return;
    stopListening();
    stopNavListener();
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  });

  if (searchQuery.value) {
    search(searchQuery.value);
  } else {
    runQuery("");
    requestAnimationFrame(() => searchQuery.requestFocus());
  }
}

function createTrackRow(track: Track, index: number, queue: Track[]): HTMLElement {
  const play = () => playerEngine.playTrack(track, queue);
  const liked = storage.isLiked(track.id);

  return el("div", {
    className: "track-row",
    // The whole row is a mouse target; keyboard users get the Play button.
    onClick: play,
    children: [
      el("div", { className: "track-row__index", text: String(index) }),
      el("button", {
        className: "track-row__play-icon",
        html: icon("play"),
        attrs: { type: "button", "aria-label": `Play ${track.title} by ${track.artist}` },
        onClick: (e) => {
          e.stopPropagation();
          play();
        },
      }),
      el("img", { className: "track-row__art", attrs: { src: track.artworkUrl, alt: "", loading: "lazy" } }),
      el("div", {
        className: "track-row__info",
        children: [
          el("span", { className: "track-row__title truncate", text: track.title }),
          el("span", { className: "track-row__artist truncate", text: track.artist }),
        ],
      }),
      el("span", { className: "track-row__album truncate", text: track.album ?? "" }),
      el("button", {
        className: `track-row__like-btn${liked ? " track-row__like-btn--active" : ""}`,
        html: icon("heart"),
        attrs: { type: "button", "aria-label": `Like ${track.title}`, "aria-pressed": String(liked) },
        onClick: (e) => {
          e.stopPropagation();
          const nowLiked = storage.toggleLike(track);
          const btn = e.currentTarget as HTMLElement;
          btn.classList.toggle("track-row__like-btn--active", nowLiked);
          btn.setAttribute("aria-pressed", String(nowLiked));
        },
      }),
      el("span", { className: "track-row__duration", text: track.duration ? formatTime(track.duration) : "" }),
    ],
  });
}
