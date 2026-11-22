/**
 * Explore view.
 *
 * Explore curated moods, genres, and trending soundscapes.
 */

import { el } from "@/lib/dom";
import { ytmService } from "@/lib/playback/ytm-api";
import { playerEngine } from "@/lib/playback/engine";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";

interface MoodCategory {
  title: string;
  color: string;
  query: string;
}

const MOODS: MoodCategory[] = [
  { title: "Chill & Relax", color: "#4A5568", query: "chill lofi relax" },
  { title: "Focus & Study", color: "#2B6CB0", query: "focus ambient study" },
  { title: "Energy & Workout", color: "#C53030", query: "workout high energy" },
  { title: "Synthwave & Retro", color: "#805AD5", query: "synthwave retro 80s" },
  { title: "Acoustic & Peaceful", color: "#2C7A7B", query: "acoustic guitar peaceful" },
  { title: "Rock & Alternative", color: "#975A16", query: "rock alternative indie" },
  { title: "Classical & Piano", color: "#44337A", query: "classical piano violin" },
  { title: "Late Night Drive", color: "#1A202C", query: "night drive moody beats" },
];

export function renderExplore(container: HTMLElement): void {
  const featuredAlbums = ytmService.getFeaturedAlbums();
  const quickPicks = ytmService.getQuickPicks();

  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Explore" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Discover music by mood, genre, and atmosphere",
          }),
        ],
      }),

      // ── Moods & Genres ───────────────────────────────────
      el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", {
                className: "section__title",
                text: "Moods & Genres",
              }),
            ],
          }),
          el("div", {
            className: "mood-grid",
            children: MOODS.map((mood) => createMoodCard(mood)),
          }),
        ],
      }),

      // ── Trending Collections ─────────────────────────────
      el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", {
                className: "section__title",
                text: "Trending Collections",
              }),
            ],
          }),
          el("div", {
            className: "card-grid",
            children: featuredAlbums.map((album) =>
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
      }),

      // ── Top Tracks This Week ─────────────────────────────
      el("div", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [
              el("h2", {
                className: "section__title",
                text: "Top Tracks This Week",
              }),
            ],
          }),
          el("div", {
            className: "card-grid",
            children: quickPicks.slice(0, 4).map((t) =>
              el("div", {
                className: "card",
                children: [
                  el("div", {
                    className: "card__artwork",
                    children: [
                      el("img", {
                        attrs: { src: t.artworkUrl, alt: t.title },
                      }),
                    ],
                  }),
                  el("div", {
                    className: "card__info",
                    children: [
                      el("span", {
                        className: "card__title truncate",
                        text: t.title,
                      }),
                      el("span", {
                        className: "card__subtitle truncate",
                        text: t.artist,
                      }),
                    ],
                  }),
                ],
                onClick: () => {
                  playerEngine.playTrack(t, quickPicks);
                },
              }),
            ),
          }),
        ],
      }),
    ],
  });

  container.appendChild(content);
}

function createMoodCard(mood: MoodCategory): HTMLElement {
  return el("div", {
    className: "mood-card",
    children: [
      el("span", { className: "mood-card__title", text: mood.title }),
    ],
    onClick: () => {
      searchQuery.set(mood.query);
      router.navigate("/search");
    },
  });
}
