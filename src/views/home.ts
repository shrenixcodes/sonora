/**
 * Home view.
 *
 * Greeting, YouTube Music's own Home shelves (the first as compact tiles, the
 * rest as rows of cards), and a "Jump back in" shelf from local listening
 * history. Every tile is a real button that plays its track.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { catalog, CatalogError, type HomeShelf } from "@/lib/ytm/catalog";
import { account } from "@/lib/ytm/account";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { greetingFor } from "@/lib/greeting";
import { dedupeById } from "@/lib/tracks";
import type { Track } from "@/types/music";

const RECENT_LIMIT = 10;
const QUICK_PICK_LIMIT = 12;
const PLACEHOLDER_TILES = 6;

export function renderHome(container: HTMLElement): void {
  const recent = dedupeById(storage.getHistory()).slice(0, RECENT_LIMIT);
  const shelvesHost = el("div", { className: "home__shelves", attrs: { "aria-live": "polite" } });

  const content = el("div", {
    className: "main__content home",
    children: [
      el("div", {
        className: "page-header",
        children: [el("h1", { className: "page-header__title", text: greetingFor(new Date()) })],
      }),

      shelvesHost,

      section(
        "Jump back in",
        recent.length > 0
          ? el("div", {
              className: "shelf",
              children: recent.map((track) => createShelfCard(track, recent)),
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
  const stopAccountListener = account.on("change", () => load(true));
  const stopNavListener = router.onNavigate((path) => {
    if (path === "/") return;
    stopTrackListener();
    stopAccountListener();
    stopNavListener();
  });

  const load = async (refresh = false) => {
    shelvesHost.setAttribute("aria-busy", "true");
    shelvesHost.replaceChildren(placeholderShelf());
    try {
      const shelves = await catalog.getHome({ refresh });
      if (!shelvesHost.isConnected) return;
      shelvesHost.replaceChildren(...renderShelves(shelves));
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
        text: "YouTube Music has no song suggestions yet. Sign in from Settings for a personal Home, or try Search.",
      }),
    ];
  }
  const [first, ...rest] = shelves;
  const picks = first.tracks.slice(0, QUICK_PICK_LIMIT);
  return [
    section(
      first.title,
      el("div", { className: "quick-grid", children: picks.map((track) => createQuickTile(track, picks)) }),
    ),
    ...rest.map((shelf) =>
      section(
        shelf.title,
        el("div", { className: "shelf", children: shelf.tracks.map((track) => createShelfCard(track, shelf.tracks)) }),
      ),
    ),
  ];
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

function section(title: string, body: HTMLElement): HTMLElement {
  return el("section", {
    className: "section",
    children: [
      el("div", {
        className: "section__header",
        children: [el("h2", { className: "section__title", text: title })],
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

function createShelfCard(track: Track, queue: Track[]): HTMLElement {
  const subtitle = track.duration ? `${track.artist} · ${formatTime(track.duration)}` : track.artist;
  return el("button", {
    className: "shelf-card",
    attrs: {
      type: "button",
      "data-track-id": track.id,
      "aria-label": `Play ${track.title} by ${track.artist}`,
    },
    children: [
      el("span", {
        className: "shelf-card__art",
        children: [
          el("img", { attrs: { src: track.artworkUrl, alt: "", loading: "lazy" } }),
          el("span", { className: "shelf-card__play", html: icon("play"), attrs: { "aria-hidden": "true" } }),
        ],
      }),
      el("span", { className: "shelf-card__title truncate", text: track.title }),
      el("span", { className: "shelf-card__subtitle truncate", text: subtitle }),
    ],
    onClick: () => playerEngine.playTrack(track, queue),
  });
}
