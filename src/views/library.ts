/**
 * Library view.
 *
 * Manages saved music, liked tracks, custom playlists, and listening history.
 * When signed in to YouTube Music, liked songs and saved playlists come from
 * the user's account alongside the ones kept in Sonora.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { icon } from "@/icons";
import { storage } from "@/lib/storage";
import { playerEngine } from "@/lib/playback/engine";
import { catalog, CatalogError, type LibraryArtist, type LibraryPlaylist } from "@/lib/ytm/catalog";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { catalogAvailable } from "@/lib/ytm/client";
import { account } from "@/lib/ytm/account";
import { dedupeById } from "@/lib/tracks";
import type { Track, Playlist } from "@/types/music";

export function renderLibrary(container: HTMLElement): void {
  const hash = window.location.hash.slice(1);
  const content = el("div", { className: "main__content" });

  if (hash === "/history") {
    renderHistory(content);
  } else if (hash === "/playlists") {
    renderPlaylists(content);
  } else if (hash === "/albums") {
    renderAlbums(content);
  } else if (hash === "/artists") {
    renderArtists(content);
  } else {
    renderLikedSongs(content);
  }

  container.appendChild(content);

  const markPlaying = (track: Track | null) => {
    content.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };
  markPlaying(playerEngine.currentTrack);
  const stopTrack = playerEngine.on("trackChange", markPlaying);
  const currentHash = hash;
  const stopPlaylist = storage.on("playlistChange", () => {
    if (currentHash !== "/playlists") return;
    content.replaceChildren();
    renderPlaylists(content);
  });
  const stopNav = router.onNavigate((path) => {
    if (path === currentHash) return;
    stopTrack();
    stopPlaylist();
    stopNav();
  });
}

function libraryNotice(err: unknown, what: string): HTMLElement {
  const message = err instanceof CatalogError ? err.message : `Couldn't load your ${what} from YouTube Music.`;
  return el("p", { className: "home__hint", text: message });
}

function signInHint(what: string): HTMLElement {
  return el("p", {
    className: "home__hint",
    text: `Sign in to YouTube Music from Settings to see your ${what} here.`,
  });
}

function renderLikedSongs(container: HTMLElement): void {
  if (!catalogAvailable()) {
    showLikedSongs(container, null);
    return;
  }
  if (account.isSignedIn === false) {
    showLikedSongs(container, null, signInHint("liked songs"));
    return;
  }

  container.appendChild(
    el("div", {
      className: "page-header",
      children: [
        el("h1", { className: "page-header__title", text: "Liked Music" }),
        el("p", { className: "page-header__subtitle", text: "Loading your liked songs…" }),
      ],
    }),
  );
  catalog
    .getLikedSongs()
    .then((remote) => {
      if (!container.isConnected) return;
      container.replaceChildren();
      showLikedSongs(container, remote);
    })
    .catch((err) => {
      if (!container.isConnected) return;
      container.replaceChildren();
      showLikedSongs(container, null, libraryNotice(err, "liked songs"));
    });
}

/**
 * Songs liked in Sonora come first, then the YouTube Music likes.
 * `remote` is null when the account's likes aren't available.
 */
function showLikedSongs(container: HTMLElement, remote: Track[] | null, notice?: HTMLElement): void {
  const remoteIds = new Set((remote ?? []).map((t) => t.id));
  const likedTracks = dedupeById([...storage.getLikedTracks(), ...(remote ?? [])]);
  const rerender = () => {
    container.replaceChildren();
    showLikedSongs(container, remote, notice);
  };

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
  if (notice) container.appendChild(notice);

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
      createTrackRow(t, idx + 1, likedTracks, rerender, remoteIds.has(t.id) && !storage.isLiked(t.id)),
    ),
  });

  container.appendChild(list);
}

function renderHistory(container: HTMLElement): void {
  if (!catalogAvailable()) {
    showHistory(container, null);
    return;
  }
  if (account.isSignedIn === false) {
    showHistory(container, null, signInHint("listening history"));
    return;
  }

  container.appendChild(
    el("div", {
      className: "page-header",
      children: [
        el("h1", { className: "page-header__title", text: "Listening History" }),
        el("p", { className: "page-header__subtitle", text: "Loading your listening history…" }),
      ],
    }),
  );
  catalog
    .getHistory()
    .then((remote) => {
      if (!container.isConnected) return;
      container.replaceChildren();
      showHistory(container, remote);
    })
    .catch((err) => {
      if (!container.isConnected) return;
      container.replaceChildren();
      showHistory(container, null, libraryNotice(err, "listening history"));
    });
}

function showHistory(container: HTMLElement, remote: Track[] | null, notice?: HTMLElement): void {
  const historyTracks = dedupeById([...storage.getHistory(), ...(remote ?? [])]);

  const clearBtn = el("button", {
    className: "btn btn--secondary",
    text: "Clear local history",
    onClick: () => {
      storage.clearHistory();
      container.replaceChildren();
      showHistory(container, remote, notice);
    },
  });

  const header = el("div", {
    className: "page-header",
    children: [
      el("h1", { className: "page-header__title", text: "Listening History" }),
      el("p", {
        className: "page-header__subtitle",
        text: "Your playback history across YouTube Music and Sonora",
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
  if (notice) container.appendChild(notice);

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
            "/artwork-placeholder.svg",
        };
        storage.savePlaylist(newPl);
      }
    },
  });

  const header = el("div", {
    className: "page-header",
    children: [
      el("h1", { className: "page-header__title", text: "Playlists" }),
      el("p", {
        className: "page-header__subtitle",
        text: "Your YouTube Music playlists and the ones you made in Sonora",
      }),
      el("div", {
        className: "page-header__actions",
        children: [newPlaylistBtn],
      }),
    ],
  });

  container.appendChild(header);

  if (catalogAvailable()) {
    const ytmSection = el("div", { className: "section", attrs: { "aria-live": "polite" } });
    container.appendChild(ytmSection);
    loadYtmPlaylists(ytmSection);
    container.appendChild(
      el("div", {
        className: "section__header",
        children: [el("h2", { className: "section__title", text: "Made in Sonora" })],
      }),
    );
  }

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
      el("button", {
        className: "card",
        attrs: { type: "button", title: `Play ${pl.title}` },
        children: [
          el("div", {
            className: "card__artwork",
            children: [
              el("img", {
                attrs: {
                  src:
                    pl.artworkUrl ||
                    "/artwork-placeholder.svg",
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

function loadYtmPlaylists(host: HTMLElement): void {
  loadYtmCards(host, "playlists", "From YouTube Music", () => catalog.getLibraryPlaylists(), createYtmPlaylistCard);
}

/** Loads one kind of library item from YouTube Music into `host` as a card grid. */
function loadYtmCards<T>(
  host: HTMLElement,
  what: string,
  heading: string | null,
  load: () => Promise<T[]>,
  card: (item: T) => HTMLElement,
): void {
  const title = heading
    ? [el("div", { className: "section__header", children: [el("h2", { className: "section__title", text: heading })] })]
    : [];
  if (!catalogAvailable()) {
    host.replaceChildren(
      ...title,
      el("p", { className: "home__hint", text: `Your ${what} show up in the Sonora desktop app.` }),
    );
    return;
  }
  if (account.isSignedIn === false) {
    host.replaceChildren(...title, signInHint(what));
    return;
  }

  host.setAttribute("aria-busy", "true");
  host.replaceChildren(...title, el("p", { className: "home__hint", text: `Loading your ${what}…` }));
  load()
    .then((items) => {
      if (!host.isConnected) return;
      host.replaceChildren(
        ...title,
        items.length > 0
          ? el("div", { className: "card-grid", children: items.map(card) })
          : el("p", { className: "home__hint", text: `No ${what} saved in your YouTube Music library yet.` }),
      );
    })
    .catch((err) => host.isConnected && host.replaceChildren(...title, libraryNotice(err, what)))
    .finally(() => host.removeAttribute("aria-busy"));
}

function libraryPage(container: HTMLElement, title: string, subtitle: string): HTMLElement {
  const body = el("div", { className: "section", attrs: { "aria-live": "polite" } });
  container.append(
    el("div", {
      className: "page-header",
      children: [
        el("h1", { className: "page-header__title", text: title }),
        el("p", { className: "page-header__subtitle", text: subtitle }),
      ],
    }),
    body,
  );
  return body;
}

function renderAlbums(container: HTMLElement): void {
  const body = libraryPage(container, "Albums", "Albums saved in your YouTube Music library");
  loadYtmCards(body, "albums", null, () => catalog.getLibraryAlbums(), createYtmPlaylistCard);
}

function renderArtists(container: HTMLElement): void {
  const body = libraryPage(container, "Artists", "Artists in your YouTube Music library");
  loadYtmCards(body, "artists", null, () => catalog.getLibraryArtists(), createArtistCard);
}

/** Artists have no page in Sonora yet, so a click searches for their songs. */
function createArtistCard(artist: LibraryArtist): HTMLElement {
  return el("button", {
    className: "card card--artist",
    attrs: { type: "button", title: `Find songs by ${artist.title}` },
    children: [
      el("div", {
        className: "card__artwork card__artwork--round",
        children: [el("img", { attrs: { src: artist.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" } })],
      }),
      el("div", {
        className: "card__info",
        children: [
          el("span", { className: "card__title truncate", text: artist.title }),
          el("span", { className: "card__subtitle truncate", text: artist.subtitle }),
        ],
      }),
    ],
    onClick: () => {
      searchQuery.set(artist.title);
      router.navigate("/search");
    },
  });
}

/** Plays the playlist from the top; its songs are fetched when clicked. */
function createYtmPlaylistCard(playlist: LibraryPlaylist): HTMLElement {
  const subtitle = el("span", { className: "card__subtitle truncate", text: playlist.subtitle });
  let loading = false;

  return el("button", {
    className: "card",
    attrs: { type: "button", title: `Play ${playlist.title}` },
    children: [
      el("div", {
        className: "card__artwork",
        children: [
          el("img", {
            attrs: { src: playlist.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" },
          }),
        ],
      }),
      el("div", {
        className: "card__info",
        children: [el("span", { className: "card__title truncate", text: playlist.title }), subtitle],
      }),
    ],
    onClick: async () => {
      if (loading) return;
      loading = true;
      subtitle.textContent = "Loading…";
      try {
        let first: Track | undefined;
        const tracks = await catalog.getPlaylistTracks(playlist.id, (more) => {
          if (first) playerEngine.extendQueue(first, more);
        });
        first = tracks[0];
        subtitle.textContent = tracks.length > 0 ? playlist.subtitle : "No playable songs";
        if (tracks.length > 0) playerEngine.playTrack(tracks[0], tracks);
      } catch (err) {
        subtitle.textContent = err instanceof CatalogError ? err.message : "Couldn't load this playlist.";
      } finally {
        loading = false;
      }
    },
  });
}

function createTrackRow(
  track: Track,
  index: number,
  queueContext: Track[],
  onToggleLike?: () => void,
  likedOnYtm = false,
): HTMLElement {
  const isLiked = likedOnYtm || storage.isLiked(track.id);
  const isPlaying = playerEngine.currentTrack?.id === track.id;
  const play = () => playerEngine.playTrack(track, queueContext);

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
      el("img", {
        className: "track-row__art",
        attrs: { src: track.artworkUrl || "/artwork-placeholder.svg", alt: track.title, loading: "lazy" },
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
        // Likes from the account can't be changed from Sonora yet.
        attrs: likedOnYtm
          ? { "aria-label": "Liked on YouTube Music", title: "Liked on YouTube Music", disabled: "" }
          : { "aria-label": `Like ${track.title}`, title: "Like track", "aria-pressed": String(isLiked) },
        onClick: (e) => {
          e.stopPropagation();
          if (likedOnYtm) return;
          const liked = storage.toggleLike(track);
          const btn = e.currentTarget as HTMLElement;
          btn.classList.toggle("track-row__like-btn--active", liked);
          btn.setAttribute("aria-pressed", String(liked));
          if (onToggleLike) onToggleLike();
        },
      }),
      el("span", {
        className: "track-row__duration",
        text: formatTime(track.duration || 0),
      }),
    ],
  });

  attachSongContextMenu(row, track);
  return row;
}
