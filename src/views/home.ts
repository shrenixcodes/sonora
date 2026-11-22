/**
 * Home view.
 *
 * Landing page showing quick picks, recent listening,
 * and personalized recommendations.
 *
 * Currently renders a welcoming empty state since no
 * music service is connected yet.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";

export function renderHome(container: HTMLElement): void {
  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Good evening" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Welcome to Sonora",
          }),
        ],
      }),

      // Quick picks section — placeholder for connected state
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
            children: Array.from({ length: 6 }, (_, i) =>
              createPlaceholderCard(`Mix ${i + 1}`, "Your personal mix"),
            ),
          }),
        ],
      }),

      // Recently played
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
          el("div", {
            className: "empty-state",
            children: [
              el("div", { className: "empty-state__icon", html: icon("music") }),
              el("h3", {
                className: "empty-state__title",
                text: "No recent activity",
              }),
              el("p", {
                className: "empty-state__description",
                text: "Music you play will appear here. Connect your YouTube Music account to get started.",
              }),
            ],
          }),
        ],
      }),
    ],
  });

  container.appendChild(content);
}

function createPlaceholderCard(title: string, subtitle: string): HTMLElement {
  return el("div", {
    className: "card",
    children: [
      el("div", {
        className: "card__artwork",
        children: [
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
          el("span", { className: "card__title truncate", text: title }),
          el("span", { className: "card__subtitle truncate", text: subtitle }),
        ],
      }),
    ],
  });
}
