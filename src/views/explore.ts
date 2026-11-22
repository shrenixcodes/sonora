/**
 * Explore view.
 *
 * Mood and genre shortcuts that run a YouTube Music search, each showing
 * artwork from songs it finds, followed by YouTube Music's own Explore
 * shelves (new releases, charts, trending).
 */

import { el } from "@/lib/dom";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { catalog, CatalogError } from "@/lib/ytm/catalog";
import { catalogAvailable } from "@/lib/ytm/client";
import { placeholderShelf, renderShelves } from "@/components/shelves";

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

const MOSAIC_SIZE = 4;
/** Artwork per mood, kept for the session so revisiting Explore doesn't search again. */
const moodArtwork = new Map<string, Promise<string[]>>();

function artworkFor(mood: MoodCategory): Promise<string[]> {
  let pending = moodArtwork.get(mood.query);
  if (!pending) {
    pending = catalog
      .searchSongs(mood.query)
      .then((tracks) => tracks.map((t) => t.artworkUrl).filter(Boolean).slice(0, MOSAIC_SIZE));
    // A failed lookup is retried on the next visit.
    pending.catch(() => moodArtwork.delete(mood.query));
    moodArtwork.set(mood.query, pending);
  }
  return pending;
}

export function renderExplore(container: HTMLElement): void {
  const shelvesHost = el("div", { className: "explore__shelves", attrs: { "aria-live": "polite" } });

  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Explore" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Moods, new releases and what's trending on YouTube Music",
          }),
        ],
      }),
      el("section", {
        className: "section",
        children: [
          el("div", {
            className: "section__header",
            children: [el("h2", { className: "section__title", text: "Moods & Genres" })],
          }),
          el("div", {
            className: "mood-grid",
            children: MOODS.map((mood) => createMoodCard(mood)),
          }),
        ],
      }),
      shelvesHost,
    ],
  });

  container.appendChild(content);
  if (catalogAvailable()) loadShelves(shelvesHost);
}

async function loadShelves(host: HTMLElement): Promise<void> {
  host.setAttribute("aria-busy", "true");
  host.replaceChildren(placeholderShelf("Loading Explore from YouTube Music"));
  try {
    const shelves = await catalog.getExplore();
    if (!host.isConnected) return;
    host.replaceChildren(...(shelves.length > 0 ? renderShelves(shelves, "") : []));
  } catch (err) {
    if (!host.isConnected) return;
    const message = err instanceof CatalogError ? err.message : "Couldn't load Explore from YouTube Music.";
    host.replaceChildren(
      el("div", {
        className: "home__notice",
        children: [
          el("p", { className: "home__hint", text: message }),
          el("button", {
            className: "btn btn--secondary",
            text: "Try again",
            attrs: { type: "button" },
            onClick: () => loadShelves(host),
          }),
        ],
      }),
    );
  } finally {
    host.removeAttribute("aria-busy");
  }
}

function createMoodCard(mood: MoodCategory): HTMLElement {
  const mosaic = el("span", { className: "mood-card__art", attrs: { "aria-hidden": "true" } });
  const card = el("button", {
    className: "mood-card",
    attrs: { type: "button", "aria-label": `Search for ${mood.title}`, style: `--mood-color: ${mood.color}` },
    children: [mosaic, el("span", { className: "mood-card__title", text: mood.title })],
    onClick: () => {
      searchQuery.set(mood.query);
      router.navigate("/search");
    },
  });

  if (catalogAvailable()) {
    artworkFor(mood)
      .then((urls) => {
        if (urls.length === 0) return;
        mosaic.classList.toggle("mood-card__art--single", urls.length < MOSAIC_SIZE);
        mosaic.replaceChildren(
          ...urls
            .slice(0, urls.length < MOSAIC_SIZE ? 1 : MOSAIC_SIZE)
            .map((src) => el("img", { attrs: { src, alt: "", loading: "lazy" } })),
        );
        card.classList.add("mood-card--has-art");
      })
      .catch(() => {});
  }
  return card;
}
