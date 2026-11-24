import { afterEach, describe, expect, it, vi } from "vitest";
import { startSongRadio } from "../src/lib/playback/song-radio";
import { playerEngine } from "../src/lib/playback/engine";
import { catalog } from "../src/lib/ytm/catalog";
import type { Track } from "../src/types/music";

const track = (id: string, title = id): Track => ({ id, title, artist: "Artist", duration: 120, artworkUrl: "" });

afterEach(() => vi.restoreAllMocks());

describe("song radio", () => {
  it("starts the selected song immediately and queues at most 25 distinct recommendations", async () => {
    const seed = track("seed", "Song");
    let current: Track | null = null;
    let queue: Track[] = [];
    const play = vi.spyOn(playerEngine, "playTrack").mockImplementation(async (item, items) => { current = item; queue = items ?? [item]; });
    vi.spyOn(playerEngine, "currentTrack", "get").mockImplementation(() => current);
    vi.spyOn(playerEngine, "currentQueue", "get").mockImplementation(() => queue);
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    let resolve!: (tracks: Track[]) => void;
    const fetch = vi.spyOn(catalog, "getPlaylistTracks").mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = startSongRadio(seed);
    expect(play).toHaveBeenCalledWith(seed, [seed]);
    expect(fetch).toHaveBeenCalledWith("RDAMVMseed");
    expect(extend).not.toHaveBeenCalled();
    resolve([seed, track("cover", "song"), ...Array.from({ length: 30 }, (_, i) => track(`rec${i}`)), track("rec0")]);
    expect(await pending).toEqual({ status: "queued", count: 25 });
    expect(extend.mock.calls[0][0]).toBe(seed);
    expect(extend.mock.calls[0][1].map((item) => item.id)).toEqual(Array.from({ length: 25 }, (_, i) => `rec${i}`));
  });

  it("does not overwrite a queue changed while recommendations load", async () => {
    const seed = track("seed");
    let queue = [seed];
    vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(seed);
    vi.spyOn(playerEngine, "currentQueue", "get").mockImplementation(() => queue);
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    let resolve!: (tracks: Track[]) => void;
    vi.spyOn(catalog, "getPlaylistTracks").mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = startSongRadio(seed);
    queue = [seed, track("manual")];
    playerEngine.emit("queueChange", queue);
    resolve([track("rec")]);
    expect(await pending).toEqual({ status: "cancelled" });
    expect(extend).not.toHaveBeenCalled();
  });

  it("ignores an older radio request when another is started", async () => {
    const first = track("first");
    const second = track("second");
    let current: Track | null = null;
    let queue: Track[] = [];
    vi.spyOn(playerEngine, "playTrack").mockImplementation(async (item, items) => {
      current = item;
      queue = items ?? [item];
      playerEngine.emit("queueChange", queue);
    });
    vi.spyOn(playerEngine, "currentTrack", "get").mockImplementation(() => current);
    vi.spyOn(playerEngine, "currentQueue", "get").mockImplementation(() => queue);
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    let resolveFirst!: (tracks: Track[]) => void;
    let resolveSecond!: (tracks: Track[]) => void;
    vi.spyOn(catalog, "getPlaylistTracks")
      .mockReturnValueOnce(new Promise((done) => { resolveFirst = done; }))
      .mockReturnValueOnce(new Promise((done) => { resolveSecond = done; }));
    const oldRadio = startSongRadio(first);
    const newRadio = startSongRadio(second);
    resolveFirst([track("old")]);
    expect(await oldRadio).toEqual({ status: "cancelled" });
    resolveSecond([track("new")]);
    expect(await newRadio).toEqual({ status: "queued", count: 1 });
    expect(extend).toHaveBeenCalledTimes(1);
    expect(extend).toHaveBeenCalledWith(second, [track("new")]);
  });

  it("loads another batch when the queue runs low and stops if the user clears it", async () => {
    const seed = track("seed");
    const initial = [track("a"), track("b"), track("c"), track("d")];
    let current: Track | null = seed;
    let queue: Track[] = [seed];
    let upcoming: Track[] = [];
    vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    vi.spyOn(playerEngine, "currentTrack", "get").mockImplementation(() => current);
    vi.spyOn(playerEngine, "currentQueue", "get").mockImplementation(() => queue);
    vi.spyOn(playerEngine, "upcoming", "get").mockImplementation(() => upcoming);
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation((_seed, more) => {
      queue = [...queue, ...more];
      upcoming = [...upcoming, ...more];
      playerEngine.emit("queueChange", queue);
    });
    const fetch = vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValueOnce(initial).mockResolvedValueOnce([track("e")]);
    expect(await startSongRadio(seed)).toEqual({ status: "queued", count: 4 });
    current = initial[0];
    upcoming = initial.slice(1);
    playerEngine.emit("trackChange", current);
    await vi.waitFor(() => expect(extend).toHaveBeenCalledWith(seed, [track("e")]));
    expect(fetch).toHaveBeenLastCalledWith("RDAMVMa");
    upcoming = [];
    playerEngine.emit("queueChange", queue);
    current = initial[1];
    playerEngine.emit("trackChange", current);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports an empty radio and preserves the selected track", async () => {
    const seed = track("seed");
    vi.spyOn(playerEngine, "playTrack").mockResolvedValue();
    vi.spyOn(playerEngine, "currentTrack", "get").mockReturnValue(seed);
    vi.spyOn(playerEngine, "currentQueue", "get").mockReturnValue([seed]);
    const extend = vi.spyOn(playerEngine, "extendQueue").mockImplementation(() => {});
    vi.spyOn(catalog, "getPlaylistTracks").mockResolvedValue([seed]);
    expect(await startSongRadio(seed)).toEqual({ status: "empty" });
    expect(extend).not.toHaveBeenCalled();
  });
});
