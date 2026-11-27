import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSongCard } from "../src/components/shelves";
import { storage } from "../src/lib/storage";
import type { Track } from "../src/types/music";

const song: Track = { id: "one", title: "Song", artist: "Artist", duration: 10, artworkUrl: "" };

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("adding songs to playlists", () => {
  it("adds the chosen song from a song card and prevents duplicates", () => {
    storage.savePlaylist({ id: "mix", title: "My mix", tracks: [], trackCount: 0, isCustom: true });
    const card = createSongCard(song, [song]);
    document.body.appendChild(card);
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const action = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === "Add to Playlist")!;
    action.click();
    const entry = document.querySelector<HTMLButtonElement>(".playlist-picker__item")!;
    entry.click();
    expect(storage.getPlaylists()[0]).toMatchObject({ trackCount: 1, tracks: [song] });
    expect(entry.disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Added to My mix");
    document.querySelector<HTMLButtonElement>(".playlist-picker__actions button")!.click();
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === "Add to Playlist")!.click();
    expect(document.querySelector<HTMLButtonElement>(".playlist-picker__item")?.disabled).toBe(true);
  });

  it("offers playlist creation when there are no local playlists", () => {
    const card = createSongCard(song, [song]);
    document.body.appendChild(card);
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === "Add to Playlist")!.click();
    expect(document.querySelector(".playlist-picker")?.textContent).toContain("Create a Sonora playlist first.");
    expect(document.querySelector(".playlist-picker")?.textContent).toContain("YouTube Music playlists are read-only");
  });
});
