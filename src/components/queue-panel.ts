/**
 * "Up next" panel.
 *
 * Right-hand column listing the current track and the rest of the queue.
 * Opened and closed from the player's queue button; the choice is remembered.
 */

import { el, formatTime } from "@/lib/dom";
import { EventEmitter } from "@/lib/events";
import { playerEngine } from "@/lib/playback/engine";
import type { Track } from "@/types/music";

const STORAGE_KEY = "sonora-queue-panel";
const OPEN_CLASS = "app--queue-open";
/** Below this window width the panel starts closed unless the user opened it. */
const AUTO_OPEN_MIN_WIDTH = 1200;

class QueuePanelState extends EventEmitter<{ change: boolean }> {
  private open = false;

  get isOpen(): boolean {
    return this.open;
  }

  init(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    this.open = saved ? saved === "open" : window.innerWidth >= AUTO_OPEN_MIN_WIDTH;
    this.apply();
  }

  toggle(): void {
    this.open = !this.open;
    localStorage.setItem(STORAGE_KEY, this.open ? "open" : "closed");
    this.apply();
  }

  private apply(): void {
    document.getElementById("app")?.classList.toggle(OPEN_CLASS, this.open);
    this.emit("change", this.open);
  }
}

export const queuePanel = new QueuePanelState();

export function createQueuePanel(): HTMLElement {
  const list = el("div", { className: "queue-panel__list" });
  const count = el("span", { className: "queue-panel__count" });

  const panel = el("aside", {
    className: "queue-panel",
    attrs: { "aria-label": "Up next" },
    children: [
      el("div", {
        className: "queue-panel__header",
        children: [el("h2", { className: "queue-panel__title", text: "Up next" }), count],
      }),
      list,
    ],
  });

  const render = () => {
    const current = playerEngine.currentTrack;
    const upcoming = playerEngine.upcoming;
    count.textContent = upcoming.length > 0 ? `${upcoming.length} ${upcoming.length === 1 ? "song" : "songs"}` : "";

    list.replaceChildren();
    if (!current && upcoming.length === 0) {
      list.appendChild(
        el("p", {
          className: "queue-panel__empty",
          text: "Nothing queued yet. Play a song and the rest of its list lines up here.",
        }),
      );
      return;
    }

    if (current) list.appendChild(createGroup("Now playing", [current], true));
    if (upcoming.length > 0) list.appendChild(createGroup("Next", upcoming, false));
  };

  // The panel lives for the whole session, so these listeners never need removing.
  playerEngine.on("trackChange", render);
  playerEngine.on("queueChange", render);
  render();

  return panel;
}

function createGroup(label: string, tracks: Track[], isCurrent: boolean): HTMLElement {
  return el("section", {
    className: "queue-panel__group",
    attrs: { "aria-label": label },
    children: [
      el("h3", { className: "queue-panel__label", text: label }),
      el("ol", {
        className: "queue-panel__tracks",
        children: tracks.map((track) => el("li", { children: [createRow(track, isCurrent)] })),
      }),
    ],
  });
}

function createRow(track: Track, isCurrent: boolean): HTMLElement {
  return el("button", {
    className: `queue-row${isCurrent ? " is-playing" : ""}`,
    attrs: {
      type: "button",
      "aria-label": isCurrent ? `Now playing: ${track.title} by ${track.artist}` : `Play ${track.title} by ${track.artist}`,
      ...(isCurrent ? { "aria-current": "true" } : {}),
    },
    children: [
      el("img", { className: "queue-row__art", attrs: { src: track.artworkUrl, alt: "", loading: "lazy" } }),
      el("span", {
        className: "queue-row__meta",
        children: [
          el("span", { className: "queue-row__title truncate", text: track.title }),
          el("span", { className: "queue-row__artist truncate", text: track.artist }),
        ],
      }),
      el("span", { className: "queue-row__duration", text: track.duration ? formatTime(track.duration) : "" }),
    ],
    // Restarting the same queue from this track keeps next/previous in order.
    onClick: () => {
      if (!isCurrent) playerEngine.playTrack(track, playerEngine.currentQueue);
    },
  });
}
