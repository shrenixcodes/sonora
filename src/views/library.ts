/**
 * Library view.
 *
 * Manages saved music, liked tracks, custom playlists, and listening history.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { storage } from "@/lib/storage";
import { playerEngine } from "@/lib/playback/engine";
import type { Track, Playlist } from "@/types/music";

export function renderLibrary(container: HTMLElement): void {
  const hash = window.location.hash.slice(1) || "/library";
  const content = el("div", { className: "main__content" });

  if (hash === "/liked") {
    renderLikedSongs(content);
  } else if (hash === "/history") {
    renderHistory(content);
  } else if (hash === "/playlists") {
    renderPlaylists(content);
  } else {
    renderMainLibrary(content);
  }

  container.appendChild(content);
}

function renderLikedSongs(container: HTMLElement): void {
  const likedTracks = storage.getLikedTracks();

  const playAllBtn = el("button", {
    className: "btn btn--primary",
    children: [
      el("span", { className: "btn__icon", html: icon("play") }),
      el("span", { text: "Play all" }),
    ],
    onClick: () => {
      if (likedTracks.length > 0) {
        playerEngine.playTrack(likedTracks[0], likedTracks);
      }
    },
  });

  const shuffleBtn = el("button", {
    className: "btn btn--secondary",
    children: [
      el("span", { className: "btn__icon", html: icon("shuffle") }),
      el("span", { text: "Shuffle" }),
    ],
    onClick: () => {
      if (likedTracks.length > 0) {
        playerEngine.setQueue(likedTracks);
        if (!playerEngine.currentState.shuffle) {
          playerEngine.toggleShuffle();
        }
        playerEngine.playTrack(likedTracks[0]);
      }
    },
  });

  const header = el("div", {
    className: "page-header",
    children: [
      el("h1", { className: "page-header__title", text: "Liked Music" }),
      el("p", {
        className: "page-header__subtitle",
        text: `${likedTracks.length} song${likedTracks.length === 1 ? "" : "s"} saved`,
      }),
      likedTracks.length > 0
        ? el("div", {
            className: "page-header__actions",
            children: [playAllBtn, shuffleBtn],
          })
        : el("div"),
    ],
  });

  container.appendChild(header);

  if (likedTracks.length === 0) {
    container.appendChild(
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("heart") }),
          el("h3", {
            className: "empty-state__title",
            text: "No liked tracks yet",
          }),
          el("p", {
            className: "empty-state__description",
            text: "Tap the heart icon on any track to save it to your Liked Music.",
          }),
        ],
      }),
    );
    return;
  }

  const list = el("div", {
    className: "track-list",
    children: likedTracks.map((t, idx) =>
      createTrackRow(t, idx + 1, likedTracks, () => {
        container.innerHTML = "";
        renderLikedSongs(container);
      }),
    ),
  });

  container.appendChild(list);
}

function renderHistory(container: HTMLElement): void {
  const historyTracks = storage.getHistory();

  const clearBtn = el("button", {
    className: "btn btn--secondary",
    text: "Clear history",
    onClick: () => {
      storage.clearHistory();
      container.innerHTML = "";
      renderHistory(container);
    },
  });

  const header = el("div", {
    className: "page-header",
    children: [
      el("h1", { className: "page-header__title", text: "Listening History" }),
      el("p", {
        className: "page-header__subtitle",
        text: "Recent tracks you have played on Sonora",
      }),
      historyTracks.length > 0
        ? el("div", {
            className: "page-header__actions",
            children: [clearBtn],
          })
        : el("div"),
    ],
  });

  container.appendChild(header);

  if (historyTracks.length === 0) {
    container.appendChild(
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("history") }),
          el("h3", {
            className: "empty-state__title",
            text: "No history yet",
          }),
          el("p", {
            className: "empty-state__description",
            text: "Songs you play will be cataloged here.",
          }),
        ],
      }),
    );
    return;
  }

  const list = el("div", {
    className: "track-list",
    children: historyTracks.map((t, idx) =>
      createTrackRow(t, idx + 1, historyTracks),
    ),
  });

  container.appendChild(list);
}

function renderPlaylists(container: HTMLElement): void {
  const playlists = storage.getPlaylists();

  const newPlaylistBtn = el("button", {
    className: "btn btn--primary",
    children: [
      el("span", { className: "btn__icon", html: icon("playlist") }),
      el("span", { text: "New Playlist" }),
    ],
    onClick: () => {
      const name = prompt("Enter playlist title:");
      if (name && name.trim()) {
        const newPl: Playlist = {
          id: `pl_${Date.now()}`,
          title: name.trim(),
          description: "Custom user playlist",
          trackCount: 0,
          tracks: [],
          isCustom: true,
          artworkUrl:
            "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
        };
        storage.savePlaylist(newPl);
        container.innerHTML = "";
        renderPlaylists(container);
      }
    },
  });

  const header = el("div", {
    className: "page-header",
    children: [
      el("h1", { className: "page-header__title", text: "Playlists" }),
      el("p", {
        className: "page-header__subtitle",
        text: "Custom playlists created by you",
      }),
      el("div", {
        className: "page-header__actions",
        children: [newPlaylistBtn],
      }),
    ],
  });

  container.appendChild(header);

  if (playlists.length === 0) {
    container.appendChild(
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("playlist") }),
          el("h3", {
            className: "empty-state__title",
            text: "No playlists yet",
          }),
          el("p", {
            className: "empty-state__description",
            text: "Create a playlist to organize your favorite tracks.",
          }),
        ],
      }),
    );
    return;
  }

  const grid = el("div", {
    className: "card-grid",
    children: playlists.map((pl) =>
      el("div", {
        className: "card",
        children: [
          el("div", {
            className: "card__artwork",
            children: [
              el("img", {
                attrs: {
                  src:
                    pl.artworkUrl ||
                    "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
                  alt: pl.title,
                },
              }),
            ],
          }),
          el("div", {
            className: "card__info",
            children: [
              el("span", { className: "card__title truncate", text: pl.title }),
              el("span", {
                className: "card__subtitle",
                text: `${pl.tracks.length} track${pl.tracks.length === 1 ? "" : "s"}`,
              }),
            ],
          }),
        ],
        onClick: () => {
          if (pl.tracks.length > 0) {
            playerEngine.playTrack(pl.tracks[0], pl.tracks);
          }
        },
      }),
    ),
  });

  container.appendChild(grid);
}

function renderMainLibrary(container: HTMLElement): void {
  const liked = storage.getLikedTracks();
  const history = storage.getHistory();
  const playlists = storage.getPlaylists();

  const header = el("div", {
    className: "page-header",
    children: [
      el("h1", { className: "page-header__title", text: "Your Library" }),
      el("p", {
        className: "page-header__subtitle",
        text: "Quick overview of your music collection",
      }),
    ],
  });

  const summarySection = el("div", {
    className: "section",
    children: [
      el("div", {
        className: "card-grid",
        children: [
          createLibraryFolderCard(
            "Liked Music",
            `${liked.length} songs`,
            "heart",
            "#/liked",
          ),
          createLibraryFolderCard(
            "Playlists",
            `${playlists.length} playlists`,
            "playlist",
            "#/playlists",
          ),
          createLibraryFolderCard(
            "Listening History",
            `${history.length} songs played`,
            "history",
            "#/history",
          ),
        ],
      }),
    ],
  });

  container.appendChild(header);
  container.appendChild(summarySection);

  if (liked.length > 0) {
    const likedSection = el("div", {
      className: "section",
      children: [
        el("div", {
          className: "section__header",
          children: [
            el("h2", { className: "section__title", text: "Liked songs" }),
          ],
        }),
        el("div", {
          className: "track-list",
          children: liked
            .slice(0, 5)
            .map((t, idx) => createTrackRow(t, idx + 1, liked)),
        }),
      ],
    });
    container.appendChild(likedSection);
  }
}

function createLibraryFolderCard(
  title: string,
  subtitle: string,
  iconName: any,
  href: string,
): HTMLElement {
  return el("a", {
    className: "card card--folder",
    attrs: { href },
    children: [
      el("div", {
        className: "card__artwork card__artwork--folder",
        children: [
          el("div", {
            className: "card__folder-icon",
            html: icon(iconName),
          }),
        ],
      }),
      el("div", {
        className: "card__info",
        children: [
          el("span", { className: "card__title truncate", text: title }),
          el("span", { className: "card__subtitle truncate", text: subtitle }),
        ],
      }),
    ],
  });
}

function createTrackRow(
  track: Track,
  index: number,
  queueContext: Track[],
  onToggleLike?: () => void,
): HTMLElement {
  const isLiked = storage.isLiked(track.id);

  return el("div", {
    className: "track-row",
    children: [
      el("div", { className: "track-row__index", text: String(index) }),
      el("div", { className: "track-row__play-icon", html: icon("play") }),
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
          if (onToggleLike) onToggleLike();
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
}
