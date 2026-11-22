/**
 * Search view.
 *
 * Real-time searching across songs, albums, and artists from YouTube Music.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { ytmService } from "@/lib/playback/ytm-api";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import type { Track, SearchResult } from "@/types/music";

export function renderSearch(container: HTMLElement): void {
  let debounceTimer: number | null = null;
  let currentFilter: "all" | "songs" | "albums" | "artists" = "all";
  let lastResult: SearchResult | null = null;

  const resultsContainer = el("div", { className: "search__results" });

  const filterRow = el("div", {
    className: "search__filters",
    children: [
      createFilterChip("all", "All", true),
      createFilterChip("songs", "Songs"),
      createFilterChip("albums", "Albums"),
      createFilterChip("artists", "Artists"),
    ],
  });

  const searchInput = el("input", {
    className: "search__input",
    attrs: {
      type: "text",
      placeholder: "Search songs, albums, artists from YouTube Music...",
      autocomplete: "off",
      spellcheck: "false",
    },
  });

  function createFilterChip(
    filter: typeof currentFilter,
    label: string,
    isActive = false,
  ): HTMLElement {
    const chip = el("button", {
      className: `search__filter-chip${isActive ? " search__filter-chip--active" : ""}`,
      text: label,
      onClick: () => {
        currentFilter = filter;
        filterRow.querySelectorAll(".search__filter-chip").forEach((c) => {
          c.classList.remove("search__filter-chip--active");
        });
        chip.classList.add("search__filter-chip--active");
        if (lastResult) {
          renderResults(lastResult);
        }
      },
    });
    return chip;
  }

  function renderResults(result: SearchResult): void {
    resultsContainer.innerHTML = "";
    lastResult = result;

    const hasTracks = result.tracks.length > 0;
    const hasAlbums = result.albums.length > 0;
    const hasArtists = result.artists.length > 0;

    if (!hasTracks && !hasAlbums && !hasArtists) {
      resultsContainer.appendChild(
        el("div", {
          className: "empty-state",
          children: [
            el("div", { className: "empty-state__icon", html: icon("search") }),
            el("h3", {
              className: "empty-state__title",
              text: "No matches found",
            }),
            el("p", {
              className: "empty-state__description",
              text: "Try searching with different keywords or artist names.",
            }),
          ],
        }),
      );
      return;
    }

    // ── Songs section ────────────────────────────────────
    if ((currentFilter === "all" || currentFilter === "songs") && hasTracks) {
      const songSection = el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [el("h2", { className: "section__title", text: "Songs" })],
          }),
          el("div", {
            className: "track-list",
            children: result.tracks.map((t, idx) =>
              createTrackRow(t, idx + 1, result.tracks),
            ),
          }),
        ],
      });
      resultsContainer.appendChild(songSection);
    }

    // ── Albums section ───────────────────────────────────
    if ((currentFilter === "all" || currentFilter === "albums") && hasAlbums) {
      const albumSection = el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", { className: "section__title", text: "Albums" }),
            ],
          }),
          el("div", {
            className: "card-grid",
            children: result.albums.map((album) =>
              el("div", {
                className: "card",
                children: [
                  el("div", {
                    className: "card__artwork",
                    children: [
                      el("img", {
                        attrs: { src: album.artworkUrl, alt: album.title },
                      }),
                    ],
                  }),
                  el("div", {
                    className: "card__info",
                    children: [
                      el("span", {
                        className: "card__title truncate",
                        text: album.title,
                      }),
                      el("span", {
                        className: "card__subtitle truncate",
                        text: album.artist,
                      }),
                    ],
                  }),
                ],
              }),
            ),
          }),
        ],
      });
      resultsContainer.appendChild(albumSection);
    }

    // ── Artists section ──────────────────────────────────
    if ((currentFilter === "all" || currentFilter === "artists") && hasArtists) {
      const artistSection = el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", { className: "section__title", text: "Artists" }),
            ],
          }),
          el("div", {
            className: "card-grid",
            children: result.artists.map((artist) =>
              el("div", {
                className: "card card--artist",
                children: [
                  el("div", {
                    className: "card__artwork card__artwork--round",
                    children: [
                      el("img", {
                        attrs: {
                          src:
                            artist.thumbnailUrl ||
                            "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80",
                          alt: artist.name,
                        },
                      }),
                    ],
                  }),
                  el("div", {
                    className: "card__info",
                    children: [
                      el("span", {
                        className: "card__title truncate",
                        text: artist.name,
                      }),
                      el("span", {
                        className: "card__subtitle",
                        text: "Artist",
                      }),
                    ],
                  }),
                ],
              }),
            ),
          }),
        ],
      });
      resultsContainer.appendChild(artistSection);
    }
  }

  function createTrackRow(
    track: Track,
    index: number,
    queueContext: Track[],
  ): HTMLElement {
    const isLiked = storage.isLiked(track.id);

    const row = el("div", {
      className: "track-row",
      children: [
        el("div", { className: "track-row__index", text: String(index) }),
        el("div", {
          className: "track-row__play-icon",
          html: icon("play"),
        }),
        el("img", {
          className: "track-row__art",
          attrs: { src: track.artworkUrl, alt: track.title, loading: "lazy" },
        }),
        el("div", {
          className: "track-row__info",
          children: [
            el("span", { className: "track-row__title truncate", text: track.title }),
            el("span", { className: "track-row__artist truncate", text: track.artist }),
          ],
        }),
        el("span", {
          className: "track-row__album truncate",
          text: track.album || "Single",
        }),
        el("button", {
          className: `track-row__like-btn${isLiked ? " track-row__like-btn--active" : ""}`,
          html: icon("heart"),
          attrs: { "aria-label": "Like", title: "Like track" },
          onClick: (e) => {
            e.stopPropagation();
            const liked = storage.toggleLike(track);
            const btn = e.currentTarget as HTMLElement;
            btn.classList.toggle("track-row__like-btn--active", liked);
          },
        }),
        el("span", {
          className: "track-row__duration",
          text: formatTime(track.duration || 0),
        }),
      ],
      onClick: () => {
        playerEngine.playTrack(track, queueContext);
      },
    });

    return row;
  }

  // Live input handler
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }

    if (!query) {
      showDefaultPrompt();
      return;
    }

    debounceTimer = window.setTimeout(async () => {
      const res = await ytmService.search(query);
      renderResults(res);
    }, 250);
  });

  function showDefaultPrompt(): void {
    resultsContainer.innerHTML = "";
    resultsContainer.appendChild(
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
    );
  }

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
      filterRow,
      resultsContainer,
    ],
  });

  container.appendChild(content);
  showDefaultPrompt();

  requestAnimationFrame(() => searchInput.focus());
}
