/**
 * Collection view — track list for a YouTube Music playlist/album or a local Sonora playlist.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { createSongRadioButton } from "@/components/song-radio";
import { createTrackAlbumControl, createTrackArtistControl, syncTrackRowLikeButtons } from "@/components/track-links";
import { icon } from "@/icons";
import {
  getCachedCollection,
  openAlbum,
  openArtist,
  openCollection,
  type CollectionTarget,
} from "@/lib/navigation";
import { playerEngine } from "@/lib/playback/engine";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { storage } from "@/lib/storage";
import { catalog, CatalogError } from "@/lib/ytm/catalog";
import type { Playlist, Track } from "@/types/music";

export { openAlbum, openCollection, type CollectionTarget };

/** Fetches a YouTube Music playlist or album and starts playing from its first track. */
export async function playYtmCollection(
  id: string,
  options?: { onEmpty?: () => void },
): Promise<Track[]> {
  let first: Track | undefined;
  const tracks = await catalog.getPlaylistTracks(id, (more) => {
    if (first) playerEngine.extendQueue(first, more);
  });
  first = tracks[0];
  if (tracks.length > 0) {
    void playerEngine.playTrack(tracks[0], tracks);
  } else {
    options?.onEmpty?.();
  }
  return tracks;
}

function targetFromHash(): CollectionTarget | null {
  const hash = window.location.hash.slice(1);
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) return null;
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  const source = params.get("source");
  const id = params.get("id") ?? "";
  const query = params.get("query") ?? "";

  if (source === "local") {
    return id ? { source: "local", id } : null;
  }

  if (!id && !query) return null;

  const cached = id ? getCachedCollection(id) : undefined;
  const kindParam = params.get("kind");
  const kind: "playlist" | "album" = kindParam === "album" ? "album" : cached?.kind ?? "playlist";
  return {
    source: "ytm",
    id,
    kind,
    title: params.get("title") || cached?.title || (kind === "album" ? "Album" : "Playlist"),
    subtitle: params.get("subtitle") ?? cached?.subtitle ?? "",
    artworkUrl: params.get("art") ?? cached?.artworkUrl ?? "",
    ...(query ? { query } : {}),
  };
}

export function renderCollection(container: HTMLElement): void {
  const target = targetFromHash();
  if (!target) {
    router.navigate("/");
    return;
  }

  const content = el("div", { className: "main__content collection" });
  container.appendChild(content);

  const activeHash = window.location.hash.slice(1);
  const cleanupFns: Array<() => void> = [];

  const markPlaying = (track: Track | null) => {
    content.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };
  cleanupFns.push(playerEngine.on("trackChange", markPlaying));
  cleanupFns.push(
    storage.on("likeChange", ({ trackId, isLiked }) => {
      syncTrackRowLikeButtons(content, trackId, isLiked);
    }),
  );

  const stopNav = router.onNavigate((path) => {
    if (path === activeHash) return;
    cleanupFns.forEach((fn) => fn());
    stopNav();
  });

  if (target.source === "local") {
    const renderLocal = () => {
      const playlist = storage.getPlaylists().find((p) => p.id === target.id);
      content.replaceChildren();
      if (!playlist) {
        content.appendChild(createMissingView("Playlist not found", "This playlist may have been deleted."));
        return;
      }
      renderLocalPlaylistView(content, playlist, markPlaying);
    };
    renderLocal();
    cleanupFns.push(storage.on("playlistChange", renderLocal));
    return;
  }

  renderYtmCollectionView(content, target, markPlaying);
}

function createBackButton(): HTMLElement {
  return el("button", {
    className: "collection__back-btn",
    attrs: { type: "button", "aria-label": "Go back" },
    children: [
      el("span", { className: "collection__back-icon", html: icon("chevronLeft") }),
      el("span", { text: "Back" }),
    ],
    onClick: () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.navigate("/");
      }
    },
  });
}

function createMissingView(title: string, description: string): HTMLElement {
  return el("div", {
    children: [
      createBackButton(),
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("playlist") }),
          el("h3", { className: "empty-state__title", text: title }),
          el("p", { className: "empty-state__description", text: description }),
        ],
      }),
    ],
  });
}

function createHeroHeader(options: {
  eyebrow: string;
  title: string;
  subtitleNode: HTMLElement;
  artworkUrl: string;
  playBtn: HTMLButtonElement;
  shuffleBtn: HTMLButtonElement;
}): HTMLElement {
  return el("div", {
    className: "collection__header",
    children: [
      el("div", {
        className: "collection__artwork",
        children: [
          el("img", {
            attrs: { src: options.artworkUrl || "/artwork-placeholder.svg", alt: options.title },
          }),
        ],
      }),
      el("div", {
        className: "collection__meta",
        children: [
          el("span", { className: "collection__eyebrow", text: options.eyebrow }),
          el("h1", { className: "collection__title", text: options.title }),
          options.subtitleNode,
          el("div", {
            className: "page-header__actions",
            children: [options.playBtn, options.shuffleBtn],
          }),
        ],
      }),
    ],
  });
}

function renderLocalPlaylistView(
  host: HTMLElement,
  playlist: Playlist,
  markPlaying: (track: Track | null) => void,
): void {
  const tracks = [...playlist.tracks];
  const countLabel = `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;
  const subtitleNode = el("p", {
    className: "collection__subtitle",
    text: playlist.description ? `${playlist.description} · ${countLabel}` : countLabel,
  });

  const playBtn = el("button", {
    className: "btn btn--primary",
    attrs: { type: "button", ...(tracks.length === 0 ? { disabled: "" } : {}) },
    children: [el("span", { className: "btn__icon", html: icon("play") }), el("span", { text: "Play" })],
    onClick: () => {
      if (tracks.length > 0) void playerEngine.playTrack(tracks[0], tracks);
    },
  }) as HTMLButtonElement;

  const shuffleBtn = el("button", {
    className: "btn btn--secondary",
    attrs: { type: "button", ...(tracks.length === 0 ? { disabled: "" } : {}) },
    children: [el("span", { className: "btn__icon", html: icon("shuffle") }), el("span", { text: "Shuffle" })],
    onClick: () => {
      void playerEngine.playShuffled(tracks);
    },
  }) as HTMLButtonElement;

  host.append(
    createBackButton(),
    createHeroHeader({
      eyebrow: "Sonora Playlist",
      title: playlist.title,
      subtitleNode,
      artworkUrl: tracks[0]?.artworkUrl || playlist.artworkUrl || "",
      playBtn,
      shuffleBtn,
    }),
  );

  if (tracks.length === 0) {
    host.appendChild(
      el("div", {
        className: "empty-state",
        children: [
          el("div", { className: "empty-state__icon", html: icon("playlist") }),
          el("h3", { className: "empty-state__title", text: "No songs yet" }),
          el("p", {
            className: "empty-state__description",
            text: "Right-click any song and choose Add to Playlist to add tracks here.",
          }),
        ],
      }),
    );
    return;
  }

  const list = el("div", {
    className: "track-list",
    children: tracks.map((track, idx) => createCollectionTrackRow(track, idx + 1, () => tracks)),
  });
  host.appendChild(list);
  markPlaying(playerEngine.currentTrack);
}

function renderYtmCollectionView(
  host: HTMLElement,
  target: Extract<CollectionTarget, { source: "ytm" }>,
  markPlaying: (track: Track | null) => void,
): void {
  let tracks: Track[] = [];
  let resolvedId = target.id;
  let resolvedArtistName = target.kind === "album" ? target.subtitle.trim() : "";
  let resolvedArtistId: string | undefined;

  const subtitleNode = el("p", {
    className: "collection__subtitle",
    text: target.subtitle || "Loading songs…",
  });

  const playBtn = el("button", {
    className: "btn btn--primary",
    attrs: { type: "button", disabled: "" },
    children: [el("span", { className: "btn__icon", html: icon("play") }), el("span", { text: "Play" })],
    onClick: () => {
      if (tracks.length > 0) void playerEngine.playTrack(tracks[0], tracks);
    },
  }) as HTMLButtonElement;

  const shuffleBtn = el("button", {
    className: "btn btn--secondary",
    attrs: { type: "button", disabled: "" },
    children: [el("span", { className: "btn__icon", html: icon("shuffle") }), el("span", { text: "Shuffle" })],
    onClick: () => {
      void playerEngine.playShuffled(tracks);
    },
  }) as HTMLButtonElement;

  const listHost = el("div", {
    className: "collection__tracks",
    attrs: { "aria-live": "polite" },
  });

  const header = createHeroHeader({
    eyebrow: target.kind === "album" ? "Album" : "Playlist",
    title: target.title,
    subtitleNode,
    artworkUrl: target.artworkUrl,
    playBtn,
    shuffleBtn,
  });
  const artworkImg = header.querySelector<HTMLImageElement>(".collection__artwork img");
  const titleEl = header.querySelector<HTMLElement>(".collection__title");

  host.append(createBackButton(), header, listHost);

  const renderSubtitle = (countText?: string) => {
    if (target.kind === "album" && resolvedArtistName) {
      const artistBtn = el("button", {
        className: "collection__subtitle-link",
        text: resolvedArtistName,
        attrs: {
          type: "button",
          title: `Open artist: ${resolvedArtistName}`,
          "aria-label": `Open artist ${resolvedArtistName}`,
        },
        onClick: () => openArtist({ id: resolvedArtistId, name: resolvedArtistName }),
      });
      subtitleNode.replaceChildren(
        artistBtn,
        ...(countText ? [document.createTextNode(` · ${countText}`)] : []),
      );
      return;
    }
    const base = target.subtitle;
    subtitleNode.textContent = countText ? (base ? `${base} · ${countText}` : countText) : base;
  };
  renderSubtitle();

  const updateSubtitle = (count: number) => {
    renderSubtitle(`${count} song${count === 1 ? "" : "s"}`);
  };

  const renderTracks = (playlistId: string) => {
    let trackListEl: HTMLElement | null = null;
    catalog
      .getPlaylistTracks(playlistId, (more) => {
        if (!listHost.isConnected || !trackListEl) return;
        const offset = tracks.length;
        tracks = [...tracks, ...more];
        for (let i = 0; i < more.length; i++) {
          trackListEl.appendChild(createCollectionTrackRow(more[i], offset + i + 1, () => tracks));
        }
        updateSubtitle(tracks.length);
        markPlaying(playerEngine.currentTrack);
      })
      .then((initial) => {
        if (!listHost.isConnected) return;
        listHost.removeAttribute("aria-busy");
        tracks = [...initial];

        if (initial[0]?.artistId && !resolvedArtistId) {
          resolvedArtistId = initial[0].artistId;
        }
        if (target.kind === "album" && !resolvedArtistName && initial[0]?.artist) {
          resolvedArtistName = initial[0].artist.trim();
        }
        if (artworkImg && !target.artworkUrl && initial[0]?.artworkUrl) {
          artworkImg.src = initial[0].artworkUrl;
        }

        if (tracks.length === 0) {
          renderSubtitle(resolvedArtistName ? undefined : "0 songs");
          listHost.replaceChildren(
            el("div", {
              className: "empty-state",
              children: [
                el("div", { className: "empty-state__icon", html: icon("playlist") }),
                el("h3", { className: "empty-state__title", text: "Nothing playable here" }),
                el("p", {
                  className: "empty-state__description",
                  text: "YouTube Music didn't return any playable songs for this item.",
                }),
              ],
            }),
          );
          return;
        }

        playBtn.removeAttribute("disabled");
        shuffleBtn.removeAttribute("disabled");
        updateSubtitle(tracks.length);
        trackListEl = el("div", {
          className: "track-list",
          children: tracks.map((track, idx) => createCollectionTrackRow(track, idx + 1, () => tracks)),
        });
        listHost.replaceChildren(trackListEl);
        markPlaying(playerEngine.currentTrack);
      })
      .catch((err) => {
        if (!listHost.isConnected) return;
        listHost.removeAttribute("aria-busy");
        const message = err instanceof CatalogError ? err.message : `Couldn't load this ${target.kind}.`;
        listHost.replaceChildren(
          el("div", {
            className: "home__notice",
            children: [
              el("p", { className: "home__hint", text: message }),
              el("button", {
                className: "btn btn--secondary",
                text: "Try again",
                attrs: { type: "button" },
                onClick: load,
              }),
            ],
          }),
        );
      });
  };

  const load = () => {
    tracks = [];
    playBtn.setAttribute("disabled", "");
    shuffleBtn.setAttribute("disabled", "");
    listHost.setAttribute("aria-busy", "true");
    listHost.replaceChildren(el("p", { className: "home__hint", text: "Loading songs…" }));

    if (resolvedId) {
      renderTracks(resolvedId);
      return;
    }

    const query = target.query?.trim() || target.title;
    catalog
      .search(query, "albums")
      .then((res) => {
        if (!listHost.isConnected) return;
        const normalizedTitle = target.title.toLowerCase();
        const match =
          res.collections?.find(
            (c) => c.playlistId && c.kind === "album" && c.title.toLowerCase() === normalizedTitle,
          ) ?? res.collections?.find((c) => c.playlistId && (c.kind === "album" || c.kind === "playlist"));

        if (!match?.playlistId) {
          listHost.removeAttribute("aria-busy");
          renderSubtitle();
          listHost.replaceChildren(
            el("div", {
              className: "empty-state",
              children: [
                el("div", { className: "empty-state__icon", html: icon("album") }),
                el("h3", { className: "empty-state__title", text: "Album not found" }),
                el("p", {
                  className: "empty-state__description",
                  text: "Couldn't match this track's album on YouTube Music.",
                }),
                el("button", {
                  className: "btn btn--secondary",
                  text: "Search albums",
                  attrs: { type: "button" },
                  onClick: () => {
                    searchQuery.searchFor(query, "albums");
                    router.navigate("/search");
                  },
                }),
              ],
            }),
          );
          return;
        }

        resolvedId = match.playlistId;
        if (titleEl && match.title) titleEl.textContent = match.title;
        if (match.artistId && !resolvedArtistId) resolvedArtistId = match.artistId;
        if (artworkImg && !target.artworkUrl && match.artworkUrl) artworkImg.src = match.artworkUrl;
        renderTracks(resolvedId);
      })
      .catch((err) => {
        if (!listHost.isConnected) return;
        listHost.removeAttribute("aria-busy");
        const message = err instanceof CatalogError ? err.message : `Couldn't load this ${target.kind}.`;
        listHost.replaceChildren(
          el("div", {
            className: "home__notice",
            children: [
              el("p", { className: "home__hint", text: message }),
              el("button", {
                className: "btn btn--secondary",
                text: "Try again",
                attrs: { type: "button" },
                onClick: load,
              }),
            ],
          }),
        );
      });
  };

  load();
}

function createCollectionTrackRow(
  track: Track,
  index: number,
  getQueue: () => Track[],
): HTMLElement {
  const liked = storage.isLiked(track.id);
  const isPlaying = playerEngine.currentTrack?.id === track.id;
  const play = () => void playerEngine.playTrack(track, getQueue());

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
        attrs: { src: track.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" },
      }),
      el("div", {
        className: "track-row__info",
        children: [
          el("span", { className: "track-row__title truncate", text: track.title }),
          createTrackArtistControl(track),
        ],
      }),
      createTrackAlbumControl(track),
      createSongRadioButton(track),
      el("button", {
        className: `track-row__like-btn${liked ? " track-row__like-btn--active" : ""}`,
        html: icon("heart"),
        attrs: { type: "button", "aria-label": liked ? `Unlike ${track.title}` : `Like ${track.title}`, "aria-pressed": String(liked) },
        onClick: (e) => {
          e.stopPropagation();
          storage.toggleLike(track);
        },
      }),
      el("span", {
        className: "track-row__duration",
        text: track.duration ? formatTime(track.duration) : "",
      }),
    ],
  });

  attachSongContextMenu(row, track);
  return row;
}
