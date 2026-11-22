/**
 * Home view.
 *
 * Greeting, compact quick-pick tiles, and a "Jump back in" shelf built from
 * local listening history. Every tile is a real button that plays its track.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { ytmService } from "@/lib/playback/ytm-api";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { greetingFor } from "@/lib/greeting";
import { dedupeById } from "@/lib/tracks";
import type { Track } from "@/types/music";

const RECENT_LIMIT = 10;

export function renderHome(container: HTMLElement): void {
  const quickPicks = ytmService.getQuickPicks();
  const recent = dedupeById(storage.getHistory()).slice(0, RECENT_LIMIT);

  const content = el("div", {
    className: "main__content home",
    children: [
      el("div", {
        className: "page-header",
        children: [el("h1", { className: "page-header__title", text: greetingFor(new Date()) })],
      }),

      section(
        "Quick picks",
        el("div", {
          className: "quick-grid",
          children: quickPicks.map((track) => createQuickTile(track, quickPicks)),
        }),
      ),

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
  const stopNavListener = router.onNavigate((path) => {
    if (path === "/") return;
    stopTrackListener();
    stopNavListener();
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
