import { afterEach, describe, expect, it, vi } from "vitest";
import { attachSongContextMenu } from "../src/components/song-context-menu";
import { createSongCard, renderShelves } from "../src/components/shelves";
import { playerEngine } from "../src/lib/playback/engine";
import { searchQuery } from "../src/lib/search-query";
import { router } from "../src/lib/router";
import type { Track } from "../src/types/music";

const song: Track = { id: "abc123", title: "Song", artist: "Artist", album: "Album", duration: 120, artworkUrl: "" };

function open(element: HTMLElement) {
  document.body.appendChild(element);
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
  return document.querySelector<HTMLElement>(".song-context-menu")!;
}

function button(menu: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(menu.querySelectorAll("button")).find((item) => item.textContent === label)!;
}

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.body.replaceChildren();
  searchQuery.takeTargetFilter();
  searchQuery.set("");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("song context menu", () => {
  it("opens from song cards without playing and queues the chosen song", () => {
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(song);
    const play = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    const next = vi.spyOn(playerEngine, "playNext").mockImplementation(() => {});
    const add = vi.spyOn(playerEngine, "addToQueue").mockImplementation(() => {});
    const card = createSongCard(song, [song]);
    const menu = open(card);
    expect(Array.from(menu.querySelectorAll("button")).map((item) => item.textContent)).toEqual([
      "Play Next", "Add to Queue", "Go to Artist", "Go to Album", "Copy Link",
    ]);
    expect(play).not.toHaveBeenCalled();
    button(menu, "Play Next").click();
    expect(next).toHaveBeenCalledWith(song);
    expect(document.querySelector(".song-context-menu")).toBeNull();
    button(open(card), "Add to Queue").click();
    expect(add).toHaveBeenCalledWith(song);
  });

  it("starts the selected track when the queue is empty", () => {
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(null);
    const play = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    button(open(createSongCard(song, [song])), "Play Next").click();
    expect(play).toHaveBeenCalledWith(song);
  });

  it("opens category searches and disables an unavailable album", () => {
    const navigate = vi.spyOn(router, "navigate").mockImplementation(() => {});
    const card = document.createElement("button");
    attachSongContextMenu(card, song);
    button(open(card), "Go to Artist").click();
    expect(searchQuery.value).toBe("Artist");
    expect(searchQuery.takeTargetFilter()).toBe("artists");
    expect(navigate).toHaveBeenCalledWith("/search");
    button(open(card), "Go to Album").click();
    expect(searchQuery.value).toBe("Album Artist");
    expect(searchQuery.takeTargetFilter()).toBe("albums");
    const missing = document.createElement("div");
    attachSongContextMenu(missing, { ...song, album: undefined });
    expect(button(open(missing), "Go to Album").disabled).toBe(true);
  });

  it("copies the song link and keeps a failed copy visible", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const card = createSongCard(song, [song]);
    button(open(card), "Copy Link").click();
    await vi.waitFor(() => expect(document.querySelector(".song-context-menu")).toBeNull());
    expect(writeText).toHaveBeenCalledWith("https://music.youtube.com/watch?v=abc123");
    button(open(card), "Copy Link").click();
    await vi.waitFor(() => expect(document.querySelector(".song-context-menu")?.textContent).toContain("Could not copy link"));
  });

  it("uses the local clipboard fallback when the async API is unavailable", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const copy = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: copy });
    try {
      button(open(createSongCard(song, [song])), "Copy Link").click();
      await vi.waitFor(() => expect(document.querySelector(".song-context-menu")).toBeNull());
      expect(copy).toHaveBeenCalledWith("copy");
      expect(document.querySelector("textarea")).toBeNull();
    } finally {
      delete (document as Document & { execCommand?: unknown }).execCommand;
    }
  });

  it("keeps menu navigation and activation keys out of global shortcuts", () => {
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    try {
      const menu = open(createSongCard(song, [song]));
      const first = button(menu, "Play Next");
      expect(document.activeElement).toBe(first);
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(button(menu, "Add to Queue"));
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
      expect(shortcut).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", shortcut);
    }
  });

  it("opens for quick picks and supports keyboard dismissal", () => {
    const host = document.createElement("div");
    const shelves = renderShelves([{ title: "Quick picks", layout: "list", tracks: [song], items: [] }]);
    host.append(...shelves);
    const tile = host.querySelector<HTMLElement>(".quick-tile")!;
    document.body.appendChild(host);
    tile.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });
});
