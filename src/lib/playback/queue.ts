/**
 * Play queue.
 *
 * Holds the list being played, the position in it, and the play order. With
 * shuffle on, the order is a random permutation that starts at the current
 * track, so toggling shuffle never jumps away from what is playing and
 * "Up next" always shows what next() will actually play.
 */

import type { RepeatMode, Track } from "@/types/music";

export type Random = () => number;

export class PlayQueue {
  private tracks: Track[] = [];
  /** Indices into `tracks` in play order. */
  private order: number[] = [];
  /** Position within `order`. */
  private position = -1;
  private shuffled = false;

  constructor(private readonly random: Random = Math.random) {}

  get current(): Track | null {
    return this.position >= 0 ? (this.tracks[this.order[this.position]] ?? null) : null;
  }

  get all(): Track[] {
    return [...this.tracks];
  }

  get isShuffled(): boolean {
    return this.shuffled;
  }

  /** Tracks after the current one, in the order next() will play them. */
  get upcoming(): Track[] {
    return this.order.slice(this.position + 1).map((i) => this.tracks[i]);
  }

  /** Replaces the queue and starts at `start` (or the first track). */
  set(tracks: Track[], start?: Track): void {
    this.tracks = [...tracks];
    const startIndex = start ? Math.max(0, this.tracks.findIndex((t) => t.id === start.id)) : 0;
    this.rebuildOrder(this.tracks.length > 0 ? startIndex : -1);
  }

  /** Adds tracks to the end (shuffled into the rest when shuffle is on), skipping ones already queued. */
  append(tracks: Track[]): void {
    const known = new Set(this.tracks.map((t) => t.id));
    const added = tracks.filter((t) => !known.has(t.id) && (known.add(t.id), true));
    if (added.length === 0) return;
    const start = this.tracks.length;
    this.tracks.push(...added);
    const indices = added.map((_, i) => start + i);
    if (this.shuffled) {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }
    this.order.push(...indices);
    if (this.position < 0) this.position = 0;
  }

  /** Inserts a track to play immediately after the current one. */
  playNext(track: Track): void {
    const existingIndex = this.tracks.findIndex((t) => t.id === track.id);
    let trackIndex: number;
    if (existingIndex !== -1) {
      trackIndex = existingIndex;
      const orderPos = this.order.indexOf(trackIndex);
      if (orderPos === this.position) return;
      if (orderPos !== -1) {
        this.order.splice(orderPos, 1);
        if (orderPos < this.position) {
          this.position -= 1;
        }
      }
    } else {
      trackIndex = this.tracks.length;
      this.tracks.push(track);
    }
    const insertAt = this.position >= 0 ? this.position + 1 : 0;
    this.order.splice(insertAt, 0, trackIndex);
    if (this.position < 0) this.position = 0;
  }

  /** Adds a track to the end of the queue. */
  addToQueue(track: Track): void {
    this.append([track]);
  }

  /** Moves to a track already in the queue; returns false if it isn't there. */
  jumpTo(trackId: string): boolean {
    const at = this.order.findIndex((i) => this.tracks[i].id === trackId);
    if (at === -1) return false;
    this.position = at;
    return true;
  }

  setShuffle(on: boolean): void {
    if (on === this.shuffled) return;
    this.shuffled = on;
    this.rebuildOrder(this.position >= 0 ? this.order[this.position] : -1);
  }

  /** Advances and returns the new current track, or null at the end. */
  next(repeat: RepeatMode): Track | null {
    if (this.order.length === 0) return null;
    if (this.position + 1 < this.order.length) {
      this.position += 1;
    } else if (repeat === "all") {
      if (this.shuffled) this.rebuildOrder(-1);
      this.position = 0;
    } else {
      return null;
    }
    return this.current;
  }

  /** Steps back and returns the new current track, or null at the start. */
  previous(repeat: RepeatMode): Track | null {
    if (this.order.length === 0) return null;
    if (this.position > 0) {
      this.position -= 1;
    } else if (repeat === "all") {
      this.position = this.order.length - 1;
    } else {
      return null;
    }
    return this.current;
  }

  /** Reorders an item within the upcoming section of the queue. */
  moveUpcoming(fromIndex: number, toIndex: number): boolean {
    const start = this.position + 1;
    const from = start + fromIndex;
    const to = start + toIndex;
    if (from < start || from >= this.order.length || to < start || to >= this.order.length || from === to) {
      return false;
    }
    const [item] = this.order.splice(from, 1);
    this.order.splice(to, 0, item);
    return true;
  }

  /** Clears all tracks queued after the current playing song. */
  clearUpcoming(): void {
    if (this.position + 1 < this.order.length) {
      this.order = this.order.slice(0, this.position + 1);
      this.pruneTracks();
    }
  }

  /** Removes a single item from the upcoming queue. */
  removeUpcoming(index: number): boolean {
    const target = this.position + 1 + index;
    if (target < this.position + 1 || target >= this.order.length) return false;
    this.order.splice(target, 1);
    this.pruneTracks();
    return true;
  }

  /** Drops tracks no longer referenced by `order` and remaps remaining indices. */
  private pruneTracks(): void {
    const used = new Set(this.order);
    if (used.size === this.tracks.length) return;
    const nextTracks: Track[] = [];
    const remap = new Map<number, number>();
    for (let i = 0; i < this.tracks.length; i++) {
      if (used.has(i)) {
        remap.set(i, nextTracks.length);
        nextTracks.push(this.tracks[i]);
      }
    }
    this.tracks = nextTracks;
    this.order = this.order.map((oldIndex) => remap.get(oldIndex)!);
  }

  /** Builds the play order with `anchor` (an index into tracks) first, or -1 for none. */
  private rebuildOrder(anchor: number): void {
    const indices = this.tracks.map((_, i) => i);
    if (!this.shuffled) {
      this.order = indices;
      this.position = anchor;
      return;
    }
    const rest = indices.filter((i) => i !== anchor);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = anchor >= 0 ? [anchor, ...rest] : rest;
    this.position = anchor >= 0 ? 0 : this.order.length > 0 ? 0 : -1;
  }
}
