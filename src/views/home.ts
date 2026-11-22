/**
 * Home view.
 *
 * Rich landing experience featuring dynamic greeting, quick picks,
 * recently played history, and featured albums.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { ytmService } from "@/lib/playback/ytm-api";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import type { Track, Album } from "@/types/music";

export function renderHome(container: HTMLElement): void {
  const quickPicks = ytmService.getQuickPicks();
  const featuredAlbums = ytmService.getFeaturedAlbums();
  const recentHistory = storage.getHistory().slice(0, 6);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: greeting }),
          el("p", {
            className: "page-header__subtitle",
            text: "Your daily soundtrack on Sonora",
          }),
        ],
      }),

      // ── Quick Picks ──────────────────────────────────────
      el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", {
                className: "section__title",
                text: "Quick picks",
              }),
            ],
          }),
          el("div", {
            className: "card-grid",
            children: quickPicks.map((track) => createTrackCard(track, quickPicks)),
          }),
        ],
      }),

      // ── Recently Played ──────────────────────────────────
      el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", {
                className: "section__title",
                text: "Recently played",
              }),
            ],
          }),
          recentHistory.length > 0
            ? el("div", {
                className: "card-grid",
                children: recentHistory.map((track) =>
                  createTrackCard(track, recentHistory),
                ),
              })
            : el("div", {
                className: "empty-state",
                children: [
                  el("div", {
                    className: "empty-state__icon",
                    html: icon("history"),
                  }),
                  el("h3", {
                    className: "empty-state__title",
                    text: "No recent activity",
                  }),
                  el("p", {
                    className: "empty-state__description",
                    text: "Tracks you listen to will automatically appear here for quick access.",
                  }),
                ],
              }),
        ],
      }),

      // ── Featured Albums ──────────────────────────────────
      el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", {
                className: "section__title",
                text: "Featured albums & collections",
              }),
            ],
          }),
          el("div", {
            className: "card-grid",
            children: featuredAlbums.map((album) => createAlbumCard(album)),
          }),
        ],
      }),
    ],
  });

  container.appendChild(content);
}

function createTrackCard(track: Track, queueContext: Track[]): HTMLElement {
  const card = el("div", {
    className: "card",
    children: [
      el("div", {
        className: "card__artwork",
        children: [
          el("img", {
            attrs: {
              src: track.artworkUrl,
              alt: track.title,
              loading: "lazy",
            },
          }),
          el("div", {
            className: "card__play-overlay",
            children: [
              el("div", {
                className: "card__play-btn",
                html: icon("play"),
              }),
            ],
          }),
        ],
      }),
      el("div", {
        className: "card__info",
        children: [
          el("span", {
            className: "card__title truncate",
            text: track.title,
            attrs: { title: track.title },
          }),
          el("span", {
            className: "card__subtitle truncate",
            text: `${track.artist}${track.duration ? " • " + formatTime(track.duration) : ""}`,
            attrs: { title: track.artist },
          }),
        ],
      }),
    ],
    onClick: () => {
      playerEngine.playTrack(track, queueContext);
    },
  });

  return card;
}

function createAlbumCard(album: Album): HTMLElement {
  return el("div", {
    className: "card",
    children: [
      el("div", {
        className: "card__artwork",
        children: [
          el("img", {
            attrs: {
              src: album.artworkUrl,
              alt: album.title,
              loading: "lazy",
            },
          }),
        ],
      }),
      el("div", {
        className: "card__info",
        children: [
          el("span", {
            className: "card__title truncate",
            text: album.title,
            attrs: { title: album.title },
          }),
          el("span", {
            className: "card__subtitle truncate",
            text: `${album.artist}${album.year ? " • " + album.year : ""}`,
          }),
        ],
      }),
    ],
  });
}
