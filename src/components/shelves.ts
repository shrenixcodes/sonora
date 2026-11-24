/**
 * Shelves of YouTube Music items, shared by Home and Explore.
 *
 * Song rows become compact tiles; albums, playlists, mixes, videos and
 * artists become cards. Albums, playlists and mixes play from the top when
 * clicked; artists open a search for their songs.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { createSongRadioButton } from "@/components/song-radio";
import { icon } from "@/icons";
import { catalog, CatalogError, type HomeCollection, type HomeItem, type HomeShelf } from "@/lib/ytm/catalog";
import { playerEngine } from "@/lib/playback/engine";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import type { Track } from "@/types/music";

const QUICK_PICK_LIMIT = 16;
const PLACEHOLDER_TILES = 6;

/**
 * Translates vertical mouse wheel scroll to horizontal scroll when the element overflows horizontally.
 */
export function enableHorizontalScroll(element: HTMLElement): HTMLElement {
  element.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && element.scrollWidth > element.clientWidth) {
        element.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    },
    { passive: false },
  );
  return element;
}

export function renderShelves(shelves: HomeShelf[], emptyText: string): HTMLElement[] {
  if (shelves.length === 0) {
    return [
      el("p", {
        className: "home__hint",
        text: emptyText,
      }),
    ];
  }
  return shelves.map((shelf) =>
    section(
      shelf.title,
      shelf.layout === "list"
        ? el("div", {
            className: "quick-grid",
            children: shelf.tracks.slice(0, QUICK_PICK_LIMIT).map((track) => createQuickTile(track, shelf.tracks)),
          })
        : enableHorizontalScroll(
            el("div", { className: "shelf", children: shelf.items.map((item) => createCard(item, shelf.tracks)) }),
          ),
      shelf.strapline,
    ),
  );
}

/** Grey tiles in the shape of the quick picks while Home loads. */
export function placeholderShelf(label: string): HTMLElement {
  return el("div", {
    className: "section",
    attrs: { "aria-label": label },
    children: [
      el("div", { className: "skeleton skeleton--title" }),
      el("div", {
        className: "quick-grid",
        children: Array.from({ length: PLACEHOLDER_TILES }, () => el("div", { className: "skeleton skeleton--tile" })),
      }),
    ],
  });
}

export function section(title: string, body: HTMLElement, strapline?: string): HTMLElement {
  return el("section", {
    className: "section",
    children: [
      el("div", {
        className: "section__header",
        children: [
          el("div", {
            children: [
              ...(strapline ? [el("p", { className: "section__strapline", text: strapline })] : []),
              el("h2", { className: "section__title", text: title }),
            ],
          }),
        ],
      }),
      body,
    ],
  });
}

function createQuickTile(track: Track, queue: Track[]): HTMLElement {
  const play = el("button", {
    className: "quick-tile__main",
    attrs: { type: "button", "aria-label": `Play ${track.title} by ${track.artist}` },
    children: [
      el("img", { className: "quick-tile__art", attrs: { src: track.artworkUrl, alt: "", loading: "lazy" } }),
      el("span", {
        className: "quick-tile__meta",
        children: [
          el("span", { className: "quick-tile__title truncate", text: track.title }),
          el("span", { className: "quick-tile__subtitle truncate", text: track.artist }),
        ],
      }),
      el("span", { className: "quick-tile__play", html: icon("play"), attrs: { "aria-hidden": "true" } }),
    ],
    onClick: () => playerEngine.playTrack(track, queue),
  });
  const tile = el("div", {
    className: "quick-tile",
    attrs: { "data-track-id": track.id },
    children: [play, createSongRadioButton(track)],
  });
  attachSongContextMenu(play, track);
  return tile;
}

function createCard(item: HomeItem, queue: Track[]): HTMLElement {
  return item.kind === "song" ? createSongCard(item.track, queue) : createCollectionCard(item);
}

function cardShell(options: {
  artworkUrl: string;
  title: string;
  subtitle: string;
  label: string;
  round?: boolean;
  playable?: boolean;
  onClick: () => void;
}): { card: HTMLElement; subtitle: HTMLElement } {
  const subtitle = el("span", { className: "shelf-card__subtitle truncate", text: options.subtitle });
  const card = el("button", {
    className: `shelf-card${options.round ? " shelf-card--round" : ""}`,
    attrs: { type: "button", "aria-label": options.label },
    children: [
      el("span", {
        className: "shelf-card__art",
        children: [
          el("img", { attrs: { src: options.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" } }),
          ...(options.playable === false
            ? []
            : [el("span", { className: "shelf-card__play", html: icon("play"), attrs: { "aria-hidden": "true" } })]),
        ],
      }),
      el("span", { className: "shelf-card__title truncate", text: options.title }),
      subtitle,
    ],
    onClick: options.onClick,
  });
  return { card, subtitle };
}

export function createSongCard(track: Track, queue: Track[]): HTMLElement {
  const { card } = cardShell({
    artworkUrl: track.artworkUrl,
    title: track.title,
    subtitle: track.duration ? `${track.artist} · ${formatTime(track.duration)}` : track.artist,
    label: `Play ${track.title} by ${track.artist}`,
    onClick: () => playerEngine.playTrack(track, queue),
  });
  card.dataset.trackId = track.id;
  attachSongContextMenu(card, track);
  return card;
}

/** Albums, playlists and mixes play from the top; artists open a search for their songs. */
export function createCollectionCard(item: HomeCollection): HTMLElement {
  if (item.kind === "artist") {
    return cardShell({
      artworkUrl: item.artworkUrl,
      title: item.title,
      subtitle: item.subtitle,
      label: `Find songs by ${item.title}`,
      round: true,
      playable: false,
      onClick: () => {
        searchQuery.set(item.title);
        router.navigate("/search");
      },
    }).card;
  }

  let loading = false;
  const { card, subtitle } = cardShell({
    artworkUrl: item.artworkUrl,
    title: item.title,
    subtitle: item.subtitle,
    label: `Play ${item.title}`,
    onClick: async () => {
      if (loading || !item.playlistId) return;
      loading = true;
      card.setAttribute("aria-busy", "true");
      subtitle.textContent = "Loading…";
      try {
        let first: Track | undefined;
        const tracks = await catalog.getPlaylistTracks(item.playlistId, (more) => {
          if (first) playerEngine.extendQueue(first, more);
        });
        first = tracks[0];
        subtitle.textContent = tracks.length > 0 ? item.subtitle : "Nothing playable here";
        if (tracks.length > 0) playerEngine.playTrack(tracks[0], tracks);
      } catch (err) {
        subtitle.textContent = err instanceof CatalogError ? err.message : `Couldn't load this ${item.kind}.`;
      } finally {
        loading = false;
        card.removeAttribute("aria-busy");
      }
    },
  });
  return card;
}
