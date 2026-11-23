import { describe, it, expect } from "vitest";
import { PlayQueue } from "../src/lib/playback/queue";
import { createQueuePanel, queuePanel } from "../src/components/queue-panel";
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

  it("reorders upcoming tracks without affecting current playing track", () => {
    const q = new PlayQueue();
    q.set(tracks, tracks[0]);
    expect(ids(q.upcoming)).toEqual(["b", "c", "d", "e"]);

    // Move 'e' (index 3) to index 0 -> should become ['e', 'b', 'c', 'd']
    expect(q.moveUpcoming(3, 0)).toBe(true);
    expect(q.current?.id).toBe("a");
    expect(ids(q.upcoming)).toEqual(["e", "b", "c", "d"]);

    // Move 'b' (index 1) to index 2 -> should become ['e', 'c', 'b', 'd']
    expect(q.moveUpcoming(1, 2)).toBe(true);
    expect(ids(q.upcoming)).toEqual(["e", "c", "b", "d"]);

    // Invalid bounds return false
    expect(q.moveUpcoming(-1, 0)).toBe(false);
    expect(q.moveUpcoming(0, 99)).toBe(false);
    expect(q.moveUpcoming(1, 1)).toBe(false);
  });

  it("clears upcoming queue while preserving current track", () => {
    const q = new PlayQueue();
    q.set(tracks, tracks[1]);
    expect(q.current?.id).toBe("b");
    expect(ids(q.upcoming)).toEqual(["c", "d", "e"]);

    q.clearUpcoming();
    expect(q.current?.id).toBe("b");
    expect(q.upcoming).toHaveLength(0);
  });

  it("removes a single track from the upcoming queue", () => {
    const q = new PlayQueue();
    q.set(tracks, tracks[0]);
    expect(ids(q.upcoming)).toEqual(["b", "c", "d", "e"]);

    expect(q.removeUpcoming(1)).toBe(true); // removes 'c'
    expect(ids(q.upcoming)).toEqual(["b", "d", "e"]);

    expect(q.removeUpcoming(99)).toBe(false);
  });

  it("inserts a track to play next immediately after the current playing track", () => {
    const q = new PlayQueue();
    q.set(tracks, tracks[0]); // current is 'a', upcoming is ['b', 'c', 'd', 'e']
    q.playNext(track("z"));

    expect(q.current?.id).toBe("a");
    expect(ids(q.upcoming)).toEqual(["z", "b", "c", "d", "e"]);

    // If an existing upcoming track is set to play next, it moves to the next position
    q.playNext(track("d"));
    expect(ids(q.upcoming)).toEqual(["d", "z", "b", "c", "e"]);
  });

  it("adds a track to the end of the queue", () => {
    const q = new PlayQueue();
    q.set([track("a"), track("b")], track("a"));
    q.addToQueue(track("z"));

    expect(ids(q.upcoming)).toEqual(["b", "z"]);
  });
});

describe("createQueuePanel", () => {
  it("renders a close button in the header that toggles the queue panel state", () => {
    const panel = createQueuePanel();
    const closeBtn = panel.querySelector<HTMLButtonElement>(".queue-panel__close-btn");
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.getAttribute("aria-label")).toBe("Close Up next");

    const initialState = queuePanel.isOpen;
    closeBtn?.click();
    expect(queuePanel.isOpen).toBe(!initialState);
  });

  it("renders rows as accessible buttons with drag support", () => {
    const panel = createQueuePanel();
    const rows = panel.querySelectorAll(".queue-row");
    rows.forEach((row) => {
      expect(row.getAttribute("role")).toBe("button");
      expect(row.getAttribute("tabindex")).toBe("0");
    });
  });
});

