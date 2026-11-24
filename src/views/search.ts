/**
 * Search view.
 *
 * Songs from YouTube Music matching the titlebar search field. Shows a prompt
 * when empty, a busy state while searching, and a retry on failure.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { icon } from "@/icons";
import { catalog, CatalogError, type SearchFilter } from "@/lib/ytm/catalog";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { createCollectionCard } from "@/components/shelves";
import type { Track } from "@/types/music";

const DEBOUNCE_MS = 300;

interface FilterOption {
  id: SearchFilter;
  label: string;
}

const SEARCH_FILTERS: FilterOption[] = [
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "playlists", label: "Playlists" },
  { id: "videos", label: "Videos" },
];

export function renderSearch(container: HTMLElement): void {
  let debounceTimer: number | null = null;
  let activeFilter: SearchFilter = searchQuery.takeTargetFilter() ?? "songs";
  const results = el("div", { className: "search__results", attrs: { "aria-live": "polite" } });

  const filterButtons: Map<SearchFilter, HTMLElement> = new Map();
  const filterBar = el("div", {
    className: "search__filters",
    attrs: { role: "radiogroup", "aria-label": "Search categories" },
    children: SEARCH_FILTERS.map((f) => {
      const btn = el("button", {
        className: `search__filter-chip${f.id === activeFilter ? " search__filter-chip--active" : ""}`,
        text: f.label,
        attrs: {
          type: "button",
          role: "radio",
          "aria-checked": String(f.id === activeFilter),
        },
        onClick: () => {
          if (activeFilter === f.id) return;
          activeFilter = f.id;
          for (const [id, chip] of filterButtons.entries()) {
            const isActive = id === activeFilter;
            chip.classList.toggle("search__filter-chip--active", isActive);
            chip.setAttribute("aria-checked", String(isActive));
          }
          if (searchQuery.value) {
            search(searchQuery.value);
          }
        },
      });
      filterButtons.set(f.id, btn);
      return btn;
    }),
  });

  container.appendChild(
    el("div", {
      className: "main__content",
      children: [
        el("div", {
          className: "page-header",
          children: [el("h1", { className: "page-header__title", text: "Search" })],
        }),
        filterBar,
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
      const filterAtStart = activeFilter;
      const res = await catalog.search(query, filterAtStart);
      // Ignore answers that arrive after the query or filter has moved on
      if (query !== searchQuery.value || filterAtStart !== activeFilter || !results.isConnected) return;

      const filterOption = SEARCH_FILTERS.find((f) => f.id === filterAtStart)!;
      if (filterAtStart === "songs" || filterAtStart === "videos") {
        const songs = res.tracks ?? [];
        if (songs.length === 0) {
          showState(`No ${filterOption.label.toLowerCase()} found`, "Try different words, or check your spelling.");
          return;
        }
        results.removeAttribute("aria-busy");
        results.replaceChildren(
          el("section", {
            className: "section",
            children: [
              el("div", {
                className: "section__header",
                children: [el("h2", { className: "section__title", text: filterOption.label })],
              }),
              el("div", {
                className: "track-list",
                children: songs.map((song, i) => createTrackRow(song, i + 1)),
              }),
            ],
          }),
        );
        markPlaying(playerEngine.currentTrack);
      } else {
        const collections = res.collections ?? [];
        if (collections.length === 0) {
          showState(`No ${filterOption.label.toLowerCase()} found`, "Try different words, or check your spelling.");
          return;
        }
        results.removeAttribute("aria-busy");
        results.replaceChildren(
          el("section", {
            className: "section",
            children: [
              el("div", {
                className: "section__header",
                children: [el("h2", { className: "section__title", text: filterOption.label })],
              }),
              el("div", {
                className: "card-grid",
                children: collections.map((col) => createCollectionCard(col)),
              }),
            ],
          }),
        );
      }
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
    const targetFilter = searchQuery.takeTargetFilter();
    if (targetFilter) {
      activeFilter = targetFilter;
      for (const [id, chip] of filterButtons) {
        const selected = id === activeFilter;
        chip.classList.toggle("search__filter-chip--active", selected);
        chip.setAttribute("aria-checked", String(selected));
      }
    }
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    if (!query) {
      showState("Find your music", "Type in the search bar above to find songs on YouTube Music.");
      return;
    }
    debounceTimer = window.setTimeout(() => search(query), DEBOUNCE_MS);
  }

  const markPlaying = (track: Track | null) => {
    results.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };
  const stopTrackListener = playerEngine.on("trackChange", markPlaying);

  const stopListening = searchQuery.on("change", runQuery);
  const stopNavListener = router.onNavigate((path) => {
    if (path === "/search") return;
    stopListening();
    stopTrackListener();
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

let searchPlaybackRequest = 0;

export function playSearchResult(track: Track): void {
  const request = ++searchPlaybackRequest;
  void playerEngine.playTrack(track, [track]);
  if (!storage.getSettings().autoPlayNext) return;
  void catalog.getPlaylistTracks(`RDAMVM${track.id}`).then((radio) => {
    if (request !== searchPlaybackRequest || playerEngine.currentTrack?.id !== track.id ||
        playerEngine.currentQueue.length !== 1 || playerEngine.currentQueue[0]?.id !== track.id) return;
    const title = track.title.trim().toLocaleLowerCase();
    playerEngine.extendQueue(track, radio.filter((song) => song.title.trim().toLocaleLowerCase() !== title));
  }).catch((err) => console.warn("[search] could not load song radio:", err));
}

function createTrackRow(track: Track, index: number): HTMLElement {
  const play = () => playSearchResult(track);
  const liked = storage.isLiked(track.id);
  const isPlaying = playerEngine.currentTrack?.id === track.id;

  const row = el("div", {
    className: `track-row${isPlaying ? " is-playing" : ""}`,
    attrs: {
      role: "button",
      tabindex: "0",
      "data-track-id": track.id,
      "aria-label": `Play ${track.title} by ${track.artist}`,
      ...(isPlaying ? { "aria-current": "true" } : {}),
    },
    onClick: play,
    onKeyDown: (e) => {
      if (e.target === row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        play();
      }
    },
    children: [
      el("div", { className: "track-row__index", text: String(index) }),
      el("div", {
        className: "track-row__play-icon",
        html: icon("play"),
        attrs: { "aria-hidden": "true" },
      }),
      el("img", { className: "track-row__art", attrs: { src: track.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" } }),
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

  attachSongContextMenu(row, track);
  return row;
}
