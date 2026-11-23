import { describe, it, expect } from "vitest";
import { PlayQueue } from "../src/lib/playback/queue";
import type { Track } from "../src/types/music";

const track = (id: string): Track => ({ id, title: id, artist: "A", duration: 100, artworkUrl: "" });
const tracks = ["a", "b", "c", "d", "e"].map(track);
const ids = (list: Track[]) => list.map((t) => t.id);

/** Deterministic stand-in for Math.random. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("PlayQueue in order", () => {
  it("starts at the chosen track and walks forward", () => {
    const q = new PlayQueue();
    q.set(tracks, tracks[2]);

    expect(q.current?.id).toBe("c");
    expect(ids(q.upcoming)).toEqual(["d", "e"]);
    expect(q.next("off")?.id).toBe("d");
    expect(q.previous("off")?.id).toBe("c");
  });

  it("stops at the end unless repeating the whole queue", () => {
    const q = new PlayQueue();
    q.set(tracks, tracks[4]);

    expect(q.next("off")).toBeNull();
    expect(q.current?.id).toBe("e");
    expect(q.next("all")?.id).toBe("a");
  });

  it("jumps to a track already in the queue", () => {
    const q = new PlayQueue();
    q.set(tracks);

    expect(q.jumpTo("d")).toBe(true);
    expect(ids(q.upcoming)).toEqual(["e"]);
    expect(q.jumpTo("zzz")).toBe(false);
  });
});

describe("PlayQueue shuffled", () => {
  it("keeps the current track when shuffle is turned on", () => {
    const q = new PlayQueue(seeded());
    q.set(tracks, tracks[1]);
    q.setShuffle(true);

    expect(q.current?.id).toBe("b");
    expect(ids(q.upcoming).sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("plays exactly the order Up next shows", () => {
    const q = new PlayQueue(seeded(42));
    q.set(tracks, tracks[0]);
    q.setShuffle(true);

    const shown = ids(q.upcoming);
    const played: string[] = [];
    for (let t = q.next("off"); t; t = q.next("off")) played.push(t.id);

    expect(played).toEqual(shown);
  });

  it("actually changes the order (the old engine ignored it)", () => {
    const q = new PlayQueue(seeded(3));
    q.set(tracks, tracks[0]);
    q.setShuffle(true);

    expect(ids(q.upcoming)).not.toEqual(["b", "c", "d", "e"]);
  });

  it("returns to list order around the current track when turned off", () => {
    const q = new PlayQueue(seeded());
    q.set(tracks, tracks[0]);
    q.setShuffle(true);
    q.next("off");
    const now = q.current!.id;
    q.setShuffle(false);

    expect(q.current?.id).toBe(now);
    expect(ids(q.upcoming)).toEqual(ids(tracks).slice(ids(tracks).indexOf(now) + 1));
  });

  it("appends the rest of a list after the current tracks, skipping duplicates", () => {
    const q = new PlayQueue();
    q.set([track("a"), track("b")], track("a"));
    q.append([track("b"), track("c"), track("d")]);
    expect(ids(q.all)).toEqual(["a", "b", "c", "d"]);
    expect(ids(q.upcoming)).toEqual(["b", "c", "d"]);
  });
});
