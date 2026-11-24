import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSearch } from "../src/views/search";
import { searchQuery } from "../src/lib/search-query";
import { catalog } from "../src/lib/ytm/catalog";
import { playerEngine } from "../src/lib/playback/engine";
import type { Track } from "../src/types/music";

const song: Track = { id: "song", title: "Title", artist: "Artist", album: "Album", duration: 1, artworkUrl: "" };

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.body.replaceChildren();
  searchQuery.takeTargetFilter();
  searchQuery.set("");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("search category navigation", () => {
  it("opens a requested category and switches categories without leaving search", async () => {
    vi.useFakeTimers();
    const search = vi.spyOn(catalog, "search").mockResolvedValue({ filter: "albums", tracks: [], collections: [] });
    searchQuery.searchFor("Album Artist", "albums");
    const host = document.createElement("main");
    document.body.appendChild(host);
    renderSearch(host);
    expect(search).toHaveBeenCalledWith("Album Artist", "albums");
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Albums");
    searchQuery.searchFor("Artist", "artists");
    await vi.advanceTimersByTimeAsync(300);
    expect(search).toHaveBeenLastCalledWith("Artist", "artists");
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Artists");
  });

  it("opens song actions from search result rows", async () => {
    vi.useFakeTimers();
    vi.spyOn(catalog, "search").mockResolvedValue({ filter: "songs", tracks: [song], collections: [] });
    vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    searchQuery.set("Title");
    const host = document.createElement("main");
    document.body.appendChild(host);
    renderSearch(host);
    await vi.runAllTimersAsync();
    const row = host.querySelector<HTMLElement>(".track-row")!;
    expect(row).not.toBeNull();
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Play Next");
    expect(playerEngine.playTrack).not.toHaveBeenCalled();
  });
});
