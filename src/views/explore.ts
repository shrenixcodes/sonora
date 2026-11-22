/**
 * Explore view.
 *
 * Mood and genre shortcuts; each one runs a YouTube Music search.
 */

import { el } from "@/lib/dom";
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
  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Explore" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Pick a mood to search YouTube Music for it",
          }),
        ],
      }),
      el("div", {
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
    ],
  });

  container.appendChild(content);
}

function createMoodCard(mood: MoodCategory): HTMLElement {
  return el("button", {
    className: "mood-card",
    attrs: { type: "button", "aria-label": `Search for ${mood.title}` },
    children: [
      el("span", { className: "mood-card__title", text: mood.title }),
    ],
    onClick: () => {
      searchQuery.set(mood.query);
      router.navigate("/search");
    },
  });
}
