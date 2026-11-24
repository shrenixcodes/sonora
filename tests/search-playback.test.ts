import { afterEach, describe, expect, it, vi } from "vitest";
import { playSearchResult } from "../src/views/search";
import { playerEngine } from "../src/lib/playback/engine";
import { catalog } from "../src/lib/ytm/catalog";
import { DEFAULT_SETTINGS, storage } from "../src/lib/storage";
import type { Track } from "../src/types/music";

const track = (id: string, title: string): Track => ({ id, title, artist: "Artist", duration: 0, artworkUrl: "" });

describe("search playback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts the selected song and queues radio songs instead of search matches", async () => {
    const selected = track("one", "Song");
    const recommendation = track("two", "Another song");
    const play = vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(selected);
    vi.spyOn(playerEngine, "currentQueue", "get").mockReturnValue([selected]);
    vi.spyOn(storage, "getSettings").mockReturnValue({ ...DEFAULT_SETTINGS, autoPlayNext: true });
    const radio = vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue([selected, track("cover", "song"), recommendation]);

    playSearchResult(selected);
    await vi.waitFor(() => expect(extend).toHaveBeenCalledWith(selected, [recommendation]));
    expect(play).toHaveBeenCalledWith(selected, [selected]);
    expect(radio).toHaveBeenCalledWith("RDAMVMone");
  });

  it("does not overwrite a queue changed while recommendations load", async () => {
    const selected = track("one", "Song");
    let finish!: (tracks: Track[]) => void;
    vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(selected);
    vi.spyOn(playerEngine, "currentQueue", "get").mockReturnValue([selected, track("manual", "Queued")]);
    vi.spyOn(storage, "getSettings").mockReturnValue({ ...DEFAULT_SETTINGS, autoPlayNext: true });
    vi.spyOn(catalog, "getPlaylistTracks").mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    playSearchResult(selected);
    finish([track("two", "Another song")]);
    await Promise.resolve();
    expect(extend).not.toHaveBeenCalled();
  });

  it("does not request radio when autoplay is disabled", () => {
    vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    vi.spyOn(storage, "getSettings").mockReturnValue({ ...DEFAULT_SETTINGS, autoPlayNext: false });
    const radio = vi.spyOn(catalog, "getPlaylistTracks");
    playSearchResult(track("one", "Song"));
    expect(radio).not.toHaveBeenCalled();
  });
});
