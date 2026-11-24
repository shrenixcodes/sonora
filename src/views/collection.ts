/**
 * Collection view — track list for a YouTube Music playlist/album or a local Sonora playlist.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { createSongRadioButton } from "@/components/song-radio";
import { icon } from "@/icons";
import { playerEngine } from "@/lib/playback/engine";
import { router } from "@/lib/router";
import { storage } from "@/lib/storage";
import { catalog, CatalogError } from "@/lib/ytm/catalog";
import type { Playlist, Track } from "@/types/music";

export type CollectionTarget =
  | {
      source: "ytm";
      id: string;
      kind: "playlist" | "album";
      title: string;
      subtitle: string;
      artworkUrl: string;
    }
  | {
      source: "local";
      id: string;
    };

const collectionCache = new Map<string, Extract<CollectionTarget, { source: "ytm" }>>();

/** Navigates to the playlist/album track list view without starting playback. */
export function openCollection(target: CollectionTarget): void {
  if (target.source === "ytm") {
    collectionCache.set(target.id, target);
    const params = new URLSearchParams({
      source: "ytm",
      id: target.id,
      kind: target.kind,
      title: target.title,
    });
    if (target.subtitle) params.set("subtitle", target.subtitle);
    if (target.artworkUrl) params.set("art", target.artworkUrl);
    router.navigate(`/playlist?${params.toString()}`);
    return;
  }

  const params = new URLSearchParams({
    source: "local",
    id: target.id,
  });
  router.navigate(`/playlist?${params.toString()}`);
}

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
  const id = params.get("id");
  if (!id) return null;

  if (source === "local") {
    return { source: "local", id };
  }

  const cached = collectionCache.get(id);
  const kindParam = params.get("kind");
  const kind: "playlist" | "album" = kindParam === "album" ? "album" : cached?.kind ?? "playlist";
  return {
    source: "ytm",
    id,
    kind,
    title: params.get("title") || cached?.title || (kind === "album" ? "Album" : "Playlist"),
    subtitle: params.get("subtitle") ?? cached?.subtitle ?? "",
    artworkUrl: params.get("art") ?? cached?.artworkUrl ?? "",
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
      if (tracks.length === 0) return;
      playerEngine.setQueue(tracks);
      if (!playerEngine.currentState.shuffle) playerEngine.toggleShuffle();
      void playerEngine.playTrack(tracks[0]);
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
      if (tracks.length === 0) return;
      playerEngine.setQueue(tracks);
      if (!playerEngine.currentState.shuffle) playerEngine.toggleShuffle();
      void playerEngine.playTrack(tracks[0]);
    },
  }) as HTMLButtonElement;

  const listHost = el("div", {
    className: "collection__tracks",
    attrs: { "aria-live": "polite" },
  });

  host.append(
    createBackButton(),
    createHeroHeader({
      eyebrow: target.kind === "album" ? "Album" : "Playlist",
      title: target.title,
      subtitleNode,
      artworkUrl: target.artworkUrl,
      playBtn,
      shuffleBtn,
    }),
    listHost,
  );

  const updateSubtitle = (count: number) => {
    const countText = `${count} song${count === 1 ? "" : "s"}`;
    subtitleNode.textContent = target.subtitle ? `${target.subtitle} · ${countText}` : countText;
  };

  const load = () => {
    tracks = [];
    playBtn.setAttribute("disabled", "");
    shuffleBtn.setAttribute("disabled", "");
    listHost.setAttribute("aria-busy", "true");
    listHost.replaceChildren(el("p", { className: "home__hint", text: "Loading songs…" }));

    let trackListEl: HTMLElement | null = null;
    catalog
      .getPlaylistTracks(target.id, (more) => {
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

        if (tracks.length === 0) {
          subtitleNode.textContent = target.subtitle || "0 songs";
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
          el("span", { className: "track-row__artist truncate", text: track.artist }),
        ],
      }),
      el("span", { className: "track-row__album truncate", text: track.album ?? "" }),
      createSongRadioButton(track),
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
      el("span", {
        className: "track-row__duration",
        text: track.duration ? formatTime(track.duration) : "",
      }),
    ],
  });

  attachSongContextMenu(row, track);
  return row;
}
