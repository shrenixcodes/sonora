import { afterEach, describe, expect, it, vi } from "vitest";
import { renderShelves } from "../src/components/shelves";
import { createQueuePanel } from "../src/components/queue-panel";
import { playerEngine } from "../src/lib/playback/engine";
import { catalog } from "../src/lib/ytm/catalog";
import type { Track } from "../src/types/music";

const song: Track = { id: "seed", title: "Song", artist: "Artist", duration: 10, artworkUrl: "" };

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("song radio controls", () => {
  it("starts radio from a Home quick pick without triggering the regular play action", async () => {
    const play = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(song);
    vi.spyOn(playerEngine, "currentQueue", "get").mockReturnValue([song]);
    vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    const fetch = vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue([{ ...song, id: "rec", title: "Another" }]);
    const host = document.createElement("div");
    host.append(...renderShelves([{ title: "Quick picks", layout: "list", tracks: [song], items: [] }]));
    document.body.appendChild(host);
    const radio = host.querySelector<HTMLButtonElement>('.song-radio-btn')!;
    expect(radio.getAttribute("aria-label")).toContain("Song");
    radio.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("RDAMVMseed"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith(song, [song]);
    expect(host.querySelector(".quick-tile__main button")).toBeNull();
  });

  it("shows a radio control for queued songs", () => {
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(song);
    vi.spyOn(playerEngine, "upcoming", "get").mockReturnValue([{ ...song, id: "next", title: "Next" }]);
    const panel = createQueuePanel();
    expect(panel.querySelector('.queue-row--upcoming .song-radio-btn')?.getAttribute("aria-label")).toContain("Next");
  });
});
