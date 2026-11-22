/**
 * Home view.
 *
 * Greeting, YouTube Music's mood chips and every Home shelf it sends: song
 * rows as compact tiles, and albums, playlists, mixes, videos and artists as
 * cards. A "Jump back in" shelf comes from local listening history. Every
 * tile is a real button that plays what it shows.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import {
  catalog,
  CatalogError,
  type HomeCollection,
  type HomeChip,
  type HomeItem,
  type HomeShelf,
} from "@/lib/ytm/catalog";
import { account } from "@/lib/ytm/account";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { greetingFor } from "@/lib/greeting";
import { dedupeById } from "@/lib/tracks";
import type { Track } from "@/types/music";

const RECENT_LIMIT = 10;
const QUICK_PICK_LIMIT = 16;
const PLACEHOLDER_TILES = 6;

export function renderHome(container: HTMLElement): void {
  const recent = dedupeById(storage.getHistory()).slice(0, RECENT_LIMIT);
  const chipsHost = el("div", { className: "home__chips", attrs: { role: "toolbar", "aria-label": "Moods and genres" } });
  const shelvesHost = el("div", { className: "home__shelves", attrs: { "aria-live": "polite" } });
  /** The selected chip's params; null shows the unfiltered Home. */
  let selectedChip: string | null = null;

  const content = el("div", {
    className: "main__content home",
    children: [
      el("div", {
        className: "page-header",
        children: [el("h1", { className: "page-header__title", text: greetingFor(new Date()) })],
      }),

      chipsHost,
      shelvesHost,

      section(
        "Jump back in",
        recent.length > 0
          ? el("div", {
              className: "shelf",
              children: recent.map((track) => createSongCard(track, recent)),
            })
          : el("p", {
              className: "home__hint",
              text: "Songs you play will show up here so you can get back to them quickly.",
            }),
      ),
    ],
  });

  container.appendChild(content);

  // Highlight the playing track; stop listening once the user leaves Home.
  const markPlaying = (track: Track | null) => {
    content.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };
  markPlaying(playerEngine.currentTrack);
  const stopTrackListener = playerEngine.on("trackChange", markPlaying);
  // Signing in or out changes what YouTube Music suggests.
  const stopAccountListener = account.on("change", () => {
    selectedChip = null;
    load(true);
  });
  const stopNavListener = router.onNavigate((path) => {
    if (path === "/") return;
    stopTrackListener();
    stopAccountListener();
    stopNavListener();
  });

  /** Chips of the unfiltered Home; they stay put while a chip's page loads. */
  let chips: HomeChip[] = [];
  const renderChips = () => {
    if (chips.length === 0) return;
    const chip = (title: string, params: string | null) =>
      el("button", {
        className: `search__filter-chip${params === selectedChip ? " search__filter-chip--active" : ""}`,
        text: title,
        attrs: { type: "button", "aria-pressed": String(params === selectedChip) },
        onClick: () => {
          if (params === selectedChip) return;
          selectedChip = params;
          renderChips();
          load();
        },
      });
    chipsHost.replaceChildren(chip("All", null), ...chips.map((c) => chip(c.title, c.params)));
  };

  const load = async (refresh = false) => {
    const params = selectedChip;
    shelvesHost.setAttribute("aria-busy", "true");
    shelvesHost.replaceChildren(placeholderShelf());
    try {
      const page = await catalog.getHome({ refresh, params: params ?? undefined });
      if (!shelvesHost.isConnected || params !== selectedChip) return;
      if (!params && page.chips.length > 0) {
        chips = page.chips;
        renderChips();
      }
      shelvesHost.replaceChildren(...renderShelves(page.shelves));
      markPlaying(playerEngine.currentTrack);
    } catch (err) {
      if (!shelvesHost.isConnected) return;
      const message = err instanceof CatalogError ? err.message : "Something went wrong loading Home.";
      const canRetry = !(err instanceof CatalogError && err.reason === "unavailable");
      shelvesHost.replaceChildren(
        el("div", {
          className: "home__notice",
          children: [
            el("p", { className: "home__hint", text: message }),
            ...(canRetry
              ? [el("button", { className: "btn btn--secondary", text: "Try again", attrs: { type: "button" }, onClick: () => load(true) })]
              : []),
          ],
        }),
      );
    } finally {
      shelvesHost.removeAttribute("aria-busy");
    }
  };
  load();
}

function renderShelves(shelves: HomeShelf[]): HTMLElement[] {
  if (shelves.length === 0) {
    return [
      el("p", {
        className: "home__hint",
        text: "YouTube Music has no suggestions here yet. Sign in from Settings for a personal Home, or try Search.",
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
        : el("div", { className: "shelf", children: shelf.items.map((item) => createCard(item, shelf.tracks)) }),
      shelf.strapline,
    ),
  );
}

/** Grey tiles in the shape of the quick picks while Home loads. */
function placeholderShelf(): HTMLElement {
  return el("div", {
    className: "section",
    attrs: { "aria-label": "Loading your Home from YouTube Music" },
    children: [
      el("div", { className: "skeleton skeleton--title" }),
      el("div", {
        className: "quick-grid",
        children: Array.from({ length: PLACEHOLDER_TILES }, () => el("div", { className: "skeleton skeleton--tile" })),
      }),
    ],
  });
}

function section(title: string, body: HTMLElement, strapline?: string): HTMLElement {
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
  return el("button", {
    className: "quick-tile",
    attrs: {
      type: "button",
      "data-track-id": track.id,
      "aria-label": `Play ${track.title} by ${track.artist}`,
    },
    children: [
      el("img", {
        className: "quick-tile__art",
        attrs: { src: track.artworkUrl, alt: "", loading: "lazy" },
      }),
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

function createSongCard(track: Track, queue: Track[]): HTMLElement {
  const { card } = cardShell({
    artworkUrl: track.artworkUrl,
    title: track.title,
    subtitle: track.duration ? `${track.artist} · ${formatTime(track.duration)}` : track.artist,
    label: `Play ${track.title} by ${track.artist}`,
    onClick: () => playerEngine.playTrack(track, queue),
  });
  card.dataset.trackId = track.id;
  return card;
}

/** Albums, playlists and mixes play from the top; artists open a search for their songs. */
function createCollectionCard(item: HomeCollection): HTMLElement {
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
        const tracks = await catalog.getPlaylistTracks(item.playlistId);
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
