/**
 * Library view.
 *
 * Manages saved music, liked tracks, custom playlists, and listening history.
 * When signed in to YouTube Music, liked songs and saved playlists come from
 * the user's account alongside the ones kept in Sonora.
 */

import { el, formatTime } from "@/lib/dom";
import { showPromptDialog } from "@/components/modal-dialog";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { createSongRadioButton } from "@/components/song-radio";
import { createTrackAlbumControl, createTrackArtistControl, syncTrackRowLikeButtons } from "@/components/track-links";
import { icon } from "@/icons";
import { storage } from "@/lib/storage";
import { playerEngine } from "@/lib/playback/engine";
import { ytmBridge } from "@/lib/playback/ytm-bridge";
import { catalog, CatalogError, type LibraryArtist, type LibraryPlaylist } from "@/lib/ytm/catalog";
import { openArtist } from "@/lib/navigation";
import { router } from "@/lib/router";
import { catalogAvailable } from "@/lib/ytm/client";
import { account } from "@/lib/ytm/account";
import { dedupeById } from "@/lib/tracks";
import { openCollection, playYtmCollection } from "@/views/collection";
import type { Track, Playlist } from "@/types/music";

export function renderLibrary(container: HTMLElement): void {
  const hash = window.location.hash.slice(1);
  const content = el("div", { className: "main__content" });
  let handleLikeChange: ((trackId: string, isLiked: boolean) => void) | null = null;

  const markPlaying = (track: Track | null) => {
    content.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };

  const renderActiveTab = () => {
    handleLikeChange = null;
    content.replaceChildren();
    if (hash === "/history") {
      renderHistory(content);
    } else if (hash === "/playlists") {
      renderPlaylists(content);
    } else if (hash === "/albums") {
      renderAlbums(content);
    } else if (hash === "/artists") {
      renderArtists(content);
    } else {
      renderLikedSongs(content, (handler) => {
        handleLikeChange = handler;
      });
    }
    markPlaying(playerEngine.currentTrack);
  };
  renderActiveTab();
  container.appendChild(content);

  const stopTrack = playerEngine.on("trackChange", markPlaying);
  const currentHash = hash;
  const stopLike = storage.on("likeChange", ({ trackId, isLiked }) => {
    if (handleLikeChange) {
      handleLikeChange(trackId, isLiked);
      markPlaying(playerEngine.currentTrack);
      return;
    }
    syncTrackRowLikeButtons(content, trackId, isLiked);
  });
  const stopPlaylist = storage.on("playlistChange", () => {
    if (currentHash !== "/playlists") return;
    content.replaceChildren();
    renderPlaylists(content);
  });
  const stopAccount = account.on("change", () => {
    if (currentHash === "/playlists" && !catalogAvailable()) return;
    renderActiveTab();
  });
  const stopNav = router.onNavigate((path) => {
    if (path === currentHash) return;
    stopTrack();
    stopLike();
    stopPlaylist();
    stopAccount();
    stopNav();
  });
}

function libraryNotice(err: unknown, what: string): HTMLElement {
  const message = err instanceof CatalogError ? err.message : `Couldn't load your ${what} from YouTube Music.`;
  return el("p", { className: "home__hint", text: message });
}

function signInHint(what: string): HTMLElement {
  return el("div", {
    className: "home__notice",
    children: [
      el("p", {
        className: "home__hint",
        text: `Sign in to YouTube Music to see your ${what} here.`,
      }),
      el("button", {
        className: "btn btn--primary",
        text: "Sign in",
        attrs: { type: "button" },
        onClick: () => {
          if (!ytmBridge.available) {
            router.navigate("/settings");
            return;
          }
          account.beginSignIn();
          void ytmBridge.setSignInVisible(true).catch(() => router.navigate("/settings"));
        },
      }),
      el("button", {
        className: "btn btn--secondary",
        text: "Open Settings",
        attrs: { type: "button" },
        onClick: () => router.navigate("/settings"),
      }),
    ],
  });
}

function renderLikedSongs(
  container: HTMLElement,
  registerLikeHandler: (handler: (trackId: string, isLiked: boolean) => void) => void,
): void {
  if (!catalogAvailable()) {
    showLikedSongs(container, null, undefined, registerLikeHandler);
    return;
  }
  if (account.isSignedIn === false) {
    showLikedSongs(container, null, signInHint("liked songs"), registerLikeHandler);
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
      showLikedSongs(container, remote, undefined, registerLikeHandler);
    })
    .catch((err) => {
      if (!container.isConnected) return;
      container.replaceChildren();
      showLikedSongs(container, null, libraryNotice(err, "liked songs"), registerLikeHandler);
    });
}

/**
 * Songs liked in Sonora come first, then the YouTube Music likes.
 * `remote` is null when the account's likes aren't available.
 */
function showLikedSongs(
  container: HTMLElement,
  remote: Track[] | null,
  notice?: HTMLElement,
  registerLikeHandler?: (handler: (trackId: string, isLiked: boolean) => void) => void,
): void {
  const remoteTracks = remote ? [...remote] : null;
  const remoteIds = new Set((remoteTracks ?? []).map((t) => t.id));
  const likedTracks = dedupeById([...storage.getLikedTracks(), ...(remoteTracks ?? [])]);
  let active = true;
  const rerender = (changedId?: string, isNowLiked?: boolean) => {
    if (!active) return;
    active = false;
    if (changedId && isNowLiked === false && remoteTracks) {
      const idx = remoteTracks.findIndex((item) => item.id === changedId);
      if (idx !== -1) remoteTracks.splice(idx, 1);
    }
    container.replaceChildren();
    showLikedSongs(container, remoteTracks, notice, registerLikeHandler);
  };
  registerLikeHandler?.(rerender);

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
      void playerEngine.playShuffled(likedTracks);
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
    attrs: {
      type: "button",
      title: "Clears songs played in Sonora locally; YouTube Music account history is read-only",
    },
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
  if (remote && remote.length > 0) {
    container.appendChild(
      el("p", {
        className: "home__hint",
        text: "YouTube Music account history is read-only; clearing removes local Sonora history only.",
      }),
    );
  }

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
      showPromptDialog({
        title: "New Playlist",
        subtitle: "Give your Sonora playlist a name.",
        placeholder: "Late Night Drives",
        confirmLabel: "Create",
        emptyError: "Please enter a playlist title.",
        onConfirm: (title) => {
          const newPl: Playlist = {
            id: `pl_${Date.now()}`,
            title,
            description: "Custom user playlist",
            trackCount: 0,
            tracks: [],
            isCustom: true,
            artworkUrl: "/artwork-placeholder.svg",
          };
          storage.savePlaylist(newPl);
        },
      });
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

  const localHost = el("div", { className: "section" });
  const renderLocalEmpty = (compact: boolean) => {
    if (compact) {
      localHost.replaceChildren(
        el("p", {
          className: "home__hint",
          text: "No local Sonora playlists yet. Use New Playlist above to create one.",
        }),
      );
      return;
    }
    localHost.replaceChildren(
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
  };

  if (catalogAvailable()) {
    const ytmSection = el("div", { className: "section", attrs: { "aria-live": "polite" } });
    container.appendChild(ytmSection);
    container.appendChild(
      el("div", {
        className: "section__header",
        children: [el("h2", { className: "section__title", text: "Made in Sonora" })],
      }),
    );
    container.appendChild(localHost);
    if (playlists.length === 0) {
      renderLocalEmpty(account.isSignedIn !== false);
    }
    loadYtmPlaylists(ytmSection, (hasYtmPlaylists) => {
      if (playlists.length === 0 && localHost.isConnected) {
        renderLocalEmpty(hasYtmPlaylists);
      }
    });
  } else {
    container.appendChild(localHost);
  }

  if (playlists.length === 0) {
    if (!catalogAvailable()) renderLocalEmpty(false);
    return;
  }

  const grid = el("div", {
    className: "card-grid",
    children: playlists.map((pl) => {
      const openPlaylist = () => openCollection({ source: "local", id: pl.id });
      const card = el("div", {
        className: "card",
        attrs: { role: "button", tabindex: "0", "aria-label": `Open ${pl.title}`, title: `Open ${pl.title}` },
        children: [
          el("div", {
            className: "card__artwork",
            children: [
              el("img", {
                attrs: {
                  src: pl.tracks[0]?.artworkUrl || pl.artworkUrl || "/artwork-placeholder.svg",
                  alt: pl.title,
                },
              }),
              el("button", {
                className: "card__play-corner",
                html: icon("play"),
                attrs: { type: "button", "aria-label": `Play ${pl.title}`, title: `Play ${pl.title}` },
                onClick: (e) => {
                  e.stopPropagation();
                  if (pl.tracks.length > 0) {
                    void playerEngine.playTrack(pl.tracks[0], pl.tracks);
                  }
                },
                onKeyDown: (e) => e.stopPropagation(),
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
        onClick: openPlaylist,
        onKeyDown: (e) => {
          if (e.target === card && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openPlaylist();
          }
        },
      });
      return card;
    }),
  });

  localHost.replaceChildren(grid);
}

function loadYtmPlaylists(host: HTMLElement, onResolved?: (hasItems: boolean) => void): void {
  loadYtmCards(
    host,
    "playlists",
    "From YouTube Music",
    () => catalog.getLibraryPlaylists(),
    (item) => createYtmPlaylistCard(item, "playlist"),
    onResolved,
  );
}

/** Loads one kind of library item from YouTube Music into `host` as a card grid. */
function loadYtmCards<T>(
  host: HTMLElement,
  what: string,
  heading: string | null,
  load: () => Promise<T[]>,
  card: (item: T) => HTMLElement,
  onResolved?: (hasItems: boolean) => void,
): void {
  const title = heading
    ? [el("div", { className: "section__header", children: [el("h2", { className: "section__title", text: heading })] })]
    : [];
  if (!catalogAvailable()) {
    host.replaceChildren(
      ...title,
      el("p", { className: "home__hint", text: `Your ${what} show up in the Sonora desktop app.` }),
    );
    onResolved?.(false);
    return;
  }
  if (account.isSignedIn === false) {
    host.replaceChildren(...title, signInHint(what));
    onResolved?.(false);
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
      onResolved?.(items.length > 0);
    })
    .catch((err) => {
      if (!host.isConnected) return;
      host.replaceChildren(...title, libraryNotice(err, what));
      onResolved?.(false);
    })
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
  loadYtmCards(body, "albums", null, () => catalog.getLibraryAlbums(), (item) => createYtmPlaylistCard(item, "album"));
}

function renderArtists(container: HTMLElement): void {
  const body = libraryPage(container, "Artists", "Artists in your YouTube Music library");
  loadYtmCards(body, "artists", null, () => catalog.getLibraryArtists(), createArtistCard);
}

/** Opens the dedicated Artist page when a library artist card is clicked. */
function createArtistCard(artist: LibraryArtist): HTMLElement {
  return el("button", {
    className: "card card--artist",
    attrs: { type: "button", title: `Open artist ${artist.title}` },
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
    onClick: () => openArtist({ id: artist.id, name: artist.title, artworkUrl: artist.artworkUrl }),
  });
}

/** Opens the playlist/album track list when clicked, or plays straight away via the play button. */
function createYtmPlaylistCard(playlist: LibraryPlaylist, kind: "playlist" | "album"): HTMLElement {
  const subtitle = el("span", { className: "card__subtitle truncate", text: playlist.subtitle });
  let loading = false;

  const play = async () => {
    if (loading) return;
    loading = true;
    subtitle.textContent = "Loading…";
    try {
      const tracks = await playYtmCollection(playlist.id);
      subtitle.textContent = tracks.length > 0 ? playlist.subtitle : "No playable songs";
    } catch (err) {
      subtitle.textContent = err instanceof CatalogError ? err.message : "Couldn't load this playlist.";
    } finally {
      loading = false;
    }
  };

  const open = () =>
    openCollection({
      source: "ytm",
      id: playlist.id,
      kind,
      title: playlist.title,
      subtitle: playlist.subtitle,
      artworkUrl: playlist.artworkUrl,
    });

  const card = el("div", {
    className: "card",
    attrs: { role: "button", tabindex: "0", "aria-label": `Open ${playlist.title}`, title: `Open ${playlist.title}` },
    children: [
      el("div", {
        className: "card__artwork",
        children: [
          el("img", {
            attrs: { src: playlist.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" },
          }),
          el("button", {
            className: "card__play-corner",
            html: icon("play"),
            attrs: { type: "button", "aria-label": `Play ${playlist.title}`, title: `Play ${playlist.title}` },
            onClick: (e) => {
              e.stopPropagation();
              void play();
            },
            onKeyDown: (e) => e.stopPropagation(),
          }),
        ],
      }),
      el("div", {
        className: "card__info",
        children: [el("span", { className: "card__title truncate", text: playlist.title }), subtitle],
      }),
    ],
    onClick: open,
    onKeyDown: (e) => {
      if (e.target === card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        open();
      }
    },
  });
  return card;
}

function createTrackRow(
  track: Track,
  index: number,
  queueContext: Track[],
  onToggleLike?: (trackId: string, liked: boolean) => void,
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
          createTrackArtistControl(track),
        ],
      }),
      createTrackAlbumControl(track, "Single"),
      createSongRadioButton(track),
      el("button", {
        className: `track-row__like-btn${isLiked ? " track-row__like-btn--active" : ""}`,
        html: icon("heart"),
        attrs: {
          "aria-label": isLiked ? `Unlike ${track.title}` : `Like ${track.title}`,
          title: likedOnYtm ? "Unlike from YouTube Music" : isLiked ? "Unlike track" : "Like track",
          "aria-pressed": String(isLiked),
        },
        onClick: (e) => {
          e.stopPropagation();
          if (likedOnYtm) {
            void catalog.rateTrack(track.id, false);
            const btn = e.currentTarget as HTMLElement;
            btn.classList.remove("track-row__like-btn--active");
            btn.setAttribute("aria-pressed", "false");
            btn.setAttribute("aria-label", `Like ${track.title}`);
            onToggleLike?.(track.id, false);
            return;
          }
          storage.toggleLike(track);
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
