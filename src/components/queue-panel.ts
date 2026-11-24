/**
 * "Up next" panel.
 *
 * Right-hand column listing the current track and the rest of the queue.
 * Opened and closed from the player's queue button; the choice is remembered.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { createSongRadioButton } from "@/components/song-radio";
import { icon } from "@/icons";
import { EventEmitter } from "@/lib/events";
import { playerEngine } from "@/lib/playback/engine";
import type { Track } from "@/types/music";

const STORAGE_KEY = "sonora-queue-panel";
const OPEN_CLASS = "app--queue-open";
/** Below this window width the panel starts closed unless the user opened it. */
const AUTO_OPEN_MIN_WIDTH = 1200;

let dragSourceIndex: number | null = null;
let isDraggingActive = false;

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
  const listContent = el("div", { className: "queue-panel__list-content" });
  const list = el("div", { className: "queue-panel__list", children: [listContent] });
  const count = el("span", { className: "queue-panel__count" });

  const closeBtn = el("button", {
    className: "queue-panel__close-btn",
    attrs: {
      type: "button",
      "aria-label": "Close Up next",
      title: "Close Up next",
    },
    html: icon("close"),
    onClick: () => queuePanel.toggle(),
  });

  const panel = el("aside", {
    className: "queue-panel",
    attrs: { "aria-label": "Up next" },
    children: [
      el("div", {
        className: "queue-panel__header",
        attrs: { "data-tauri-drag-region": "" },
        children: [
          el("div", {
            className: "queue-panel__header-title",
            attrs: { "data-tauri-drag-region": "" },
            children: [el("h2", { className: "queue-panel__title", attrs: { "data-tauri-drag-region": "" }, text: "Up next" }), count],
          }),
          closeBtn,
        ],
      }),
      list,
    ],
  });

  const render = () => {
    const current = playerEngine.currentTrack;
    const upcoming = playerEngine.upcoming;
    count.textContent = upcoming.length > 0 ? `${upcoming.length} ${upcoming.length === 1 ? "song" : "songs"}` : "";

    listContent.replaceChildren();
    if (!current && upcoming.length === 0) {
      listContent.appendChild(
        el("p", {
          className: "queue-panel__empty",
          text: "Nothing queued yet. Play a song and the rest of its list lines up here.",
        }),
      );
      return;
    }

    if (current) listContent.appendChild(createGroup("Now playing", [current], true));
    if (upcoming.length > 0) listContent.appendChild(createGroup("Next", upcoming, false));
  };

  // The panel lives for the whole session, so these listeners never need removing.
  playerEngine.on("trackChange", render);
  playerEngine.on("queueChange", render);
  render();

  return panel;
}

function createGroup(label: string, tracks: Track[], isCurrent: boolean): HTMLElement {
  const headerChildren: HTMLElement[] = [
    el("h3", { className: "queue-panel__label", text: label }),
  ];

  if (!isCurrent && tracks.length > 0) {
    headerChildren.push(
      el("button", {
        className: "queue-panel__clear-btn",
        text: "Clear",
        attrs: { type: "button", "aria-label": "Clear upcoming queue", title: "Clear upcoming queue" },
        onClick: () => playerEngine.clearQueue(),
      }),
    );
  }

  const header = el("div", {
    className: "queue-panel__group-header",
    children: headerChildren,
  });

  return el("section", {
    className: "queue-panel__group",
    attrs: { "aria-label": label },
    children: [
      header,
      el("ol", {
        className: "queue-panel__tracks",
        children: tracks.map((track, idx) => {
          const item = el("li", {
            className: "queue-item",
            children: [createRow(track, isCurrent, idx)],
          });
          if (!isCurrent) {
            setupDragHandlers(item, idx);
          }
          return item;
        }),
      }),
    ],
  });
}

function setupDragHandlers(item: HTMLElement, index: number): void {
  item.addEventListener("dragstart", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(".queue-row__grip")) {
      e.preventDefault();
      return;
    }
    isDraggingActive = true;
    dragSourceIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
    item.classList.add("is-dragging");
  });

  item.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });

  item.addEventListener("dragenter", (e) => {
    e.preventDefault();
    item.classList.add("is-drag-over");
  });

  item.addEventListener("dragleave", (e) => {
    const related = e.relatedTarget as Node | null;
    if (!item.contains(related)) {
      item.classList.remove("is-drag-over");
    }
  });

  item.addEventListener("drop", (e) => {
    e.preventDefault();
    item.classList.remove("is-drag-over");
    const sourceIdx =
      dragSourceIndex !== null
        ? dragSourceIndex
        : Number(e.dataTransfer?.getData("text/plain"));
    if (!isNaN(sourceIdx) && sourceIdx !== index) {
      playerEngine.moveUpcoming(sourceIdx, index);
    }
    dragSourceIndex = null;
  });

  item.addEventListener("dragend", () => {
    item.classList.remove("is-dragging");
    document.querySelectorAll(".queue-item.is-drag-over").forEach((el) => el.classList.remove("is-drag-over"));
    dragSourceIndex = null;
    setTimeout(() => {
      isDraggingActive = false;
    }, 80);
  });
}

function createRow(track: Track, isCurrent: boolean, upcomingIndex?: number): HTMLElement {
  const children: HTMLElement[] = [];

  if (!isCurrent && upcomingIndex !== undefined) {
    children.push(
      el("span", {
        className: "queue-row__grip",
        html: icon("grip"),
        attrs: { "aria-hidden": "true", title: "Drag to reorder", draggable: "true" },
        onClick: (e) => e.stopPropagation(),
      }),
    );
  }

  children.push(
    el("img", {
      className: "queue-row__art",
      attrs: { src: track.artworkUrl, alt: "", loading: "lazy", draggable: "false" },
    }),
    el("span", {
      className: "queue-row__meta",
      children: [
        el("span", { className: "queue-row__title truncate", text: track.title }),
        el("span", { className: "queue-row__artist truncate", text: track.artist }),
      ],
    }),
    el("span", { className: "queue-row__duration", text: track.duration ? formatTime(track.duration) : "" }),
    createSongRadioButton(track),
  );

  if (!isCurrent && upcomingIndex !== undefined) {
    children.push(
      el("button", {
        className: "queue-row__remove-btn",
        html: icon("close"),
        attrs: {
          type: "button",
          "aria-label": `Remove ${track.title} from queue`,
          title: "Remove from queue",
        },
        onClick: (e) => {
          e.stopPropagation();
          playerEngine.removeUpcoming(upcomingIndex);
        },
      }),
    );
  }

  const row = el("div", {
    className: `queue-row${isCurrent ? " is-playing" : " queue-row--upcoming"}`,
    attrs: {
      role: "button",
      tabindex: "0",
      "aria-label": isCurrent ? `Now playing: ${track.title} by ${track.artist}` : `Play ${track.title} by ${track.artist}`,
      ...(isCurrent ? { "aria-current": "true" } : {}),
    },
    children,
    // Restarting the same queue from this track keeps next/previous in order.
    onClick: () => {
      if (isDraggingActive) return;
      if (!isCurrent) playerEngine.playTrack(track);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        if (!isCurrent) playerEngine.playTrack(track);
      }
    },
  });
  attachSongContextMenu(row, track);
  return row;
}
