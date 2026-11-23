/**
 * Sonora playback engine.
 *
 * Owns the play queue and the playback state the interface shows. Audio comes
 * from the official YouTube Music web app through the bridge in ytm-bridge.ts:
 * the engine sends it commands and mirrors the state it reports. Windows media
 * keys and the media overlay are handled by that page's own media session.
 */

import type { LyricsData, PlaybackState, RepeatMode, Track } from "@/types/music";
import { EventEmitter } from "@/lib/events";
import { storage } from "@/lib/storage";
import { extractPalette, type ArtworkPalette } from "@/lib/visuals/color-extractor";
import { lyricsService } from "@/lib/lyrics/providers";
import { PlayQueue } from "@/lib/playback/queue";
import { ytmBridge, type YtmCommand, type YtmState } from "@/lib/playback/ytm-bridge";

export interface PlaybackEvents {
  stateChange: PlaybackState;
  trackChange: Track | null;
  timeUpdate: { currentTime: number; duration: number };
  queueChange: Track[];
  paletteChange: ArtworkPalette;
  lyricsChange: LyricsData | null;
}

/** The part of the bridge the engine needs; swapped for a fake in tests. */
export interface PlaybackBridge {
  readonly available: boolean;
  control(command: YtmCommand): Promise<void>;
  onState(handler: (state: YtmState) => void): Promise<unknown>;
}

const TICK_MS = 250;
const RESTART_THRESHOLD_S = 3;
const UNAVAILABLE_MESSAGE = "Playback works in the Sonora desktop app.";
/** A page that never reports back (unavailable video, network trouble) must not leave "Loading…" forever. */
const LOAD_TIMEOUT_MS = 15_000;
const LOAD_FAILED_MESSAGE = "YouTube Music couldn't play this song.";
/** Taps on next/previous arrive faster than a track can load; see `load`. */
const SKIP_SETTLE_MS = 400;

export class PlaybackEngine extends EventEmitter<PlaybackEvents> {
  private state: PlaybackState = {
    currentTrack: null,
    status: "idle",
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    isMuted: false,
    shuffle: false,
    repeat: "off",
    playbackRate: 1.0,
    isAd: false,
  };

  private readonly queue = new PlayQueue();
  /** Track we asked the page to load; its first report confirms it. */
  private pendingId: string | null = null;
  /** Position reported last, and when, to move the progress bar smoothly between reports. */
  private lastReport = { time: 0, at: 0 };
  private ticker: number | null = null;
  private loadTimer: number | null = null;
  /** The current track's lyrics and artwork colors, for a view opened mid-song. */
  private lyrics: LyricsData | null = null;
  private palette: ArtworkPalette | null = null;
  /** When the last skip was handled, and the load a run of them is still waiting to send. */
  private lastSkipAt = 0;
  private skipTimer: number | null = null;

  constructor(private readonly bridge: PlaybackBridge = ytmBridge) {
    super();
    this.state.volume = storage.getSettings().volume;
    if (bridge.available) {
      bridge.onState((s) => this.handleBridgeState(s)).catch((err) => this.fail(err));
    }
  }

  get currentState(): PlaybackState {
    return { ...this.state };
  }

  get currentTrack(): Track | null {
    return this.state.currentTrack;
  }

  get currentQueue(): Track[] {
    return this.queue.all;
  }

  /**
   * The current track's lyrics, or null while they are still being looked up.
   * A view that opens part-way through a song has missed the change event that
   * carried them, so it reads them from here instead of waiting for the next
   * track.
   */
  get currentLyrics(): LyricsData | null {
    return this.lyrics;
  }

  /** Colors drawn from the current artwork, for a view opened mid-song. */
  get currentPalette(): ArtworkPalette | null {
    return this.palette;
  }

  /** Tracks after the current one, in the order next() will play them. */
  get upcoming(): Track[] {
    return this.queue.upcoming;
  }

  /* ── Commands ─────────────────────────────────────────── */

  async playTrack(track: Track, newQueue?: Track[]): Promise<void> {
    if (newQueue) {
      this.queue.set(newQueue, track);
      this.emit("queueChange", this.queue.all);
    } else if (!this.queue.jumpTo(track.id)) {
      this.queue.set([track], track);
      this.emit("queueChange", this.queue.all);
    }
    this.load(track);
  }

  setQueue(tracks: Track[], startTrack?: Track): void {
    this.queue.set(tracks, startTrack);
    this.emit("queueChange", this.queue.all);
  }

  /**
   * Adds the rest of a list that started playing before it finished loading.
   * Ignored if the user has since moved on to something else.
   */
  extendQueue(listStart: Track, more: Track[]): void {
    if (this.queue.all[0]?.id !== listStart.id) return;
    this.queue.append(more);
    this.emit("queueChange", this.queue.all);
  }

  togglePlay(): void {
    if (!this.state.currentTrack) {
      const first = this.queue.current ?? this.queue.all[0];
      if (first) this.playTrack(first);
      return;
    }
    this.send({ action: this.state.status === "playing" ? "pause" : "play" });
  }

  resume(): void {
    this.send({ action: "play" });
  }

  pause(): void {
    this.send({ action: "pause" });
  }

  next(): void {
    const track = this.queue.next(this.state.repeat);
    if (track) {
      this.load(track, true);
    } else if (this.state.currentTrack) {
      // Past the end of Sonora's list, let YouTube Music continue with its own radio.
      this.send({ action: "next" });
    }
  }

  previous(): void {
    if (this.state.currentTime > RESTART_THRESHOLD_S) {
      this.seekTo(0);
      return;
    }
    const track = this.queue.previous(this.state.repeat);
    if (track) this.load(track, true);
    else this.seekTo(0);
  }

  seekTo(seconds: number): void {
    if (this.state.isAd) return; // ads play out in full
    const clamped = Math.max(0, Math.min(seconds, this.state.duration || seconds));
    this.setTime(clamped);
    this.send({ action: "seek", value: clamped });
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    this.state.isMuted = clamped === 0;
    storage.saveSettings({ volume: clamped });
    this.send({ action: "volume", value: clamped });
    this.emit("stateChange", this.currentState);
  }

  toggleMute(): void {
    // Muting sets the page's volume to zero and keeps the chosen level to restore.
    this.state.isMuted = !this.state.isMuted;
    if (!this.state.isMuted && this.state.volume === 0) {
      this.state.volume = 0.8;
      storage.saveSettings({ volume: 0.8 });
    }
    const target = this.state.isMuted ? 0 : this.state.volume;
    this.send({ action: "volume", value: target });
    this.emit("stateChange", this.currentState);
  }

  toggleShuffle(): void {
    this.state.shuffle = !this.state.shuffle;
    this.queue.setShuffle(this.state.shuffle);
    this.emit("stateChange", this.currentState);
    this.emit("queueChange", this.queue.all);
  }

  cycleRepeat(): void {
    const modes: RepeatMode[] = ["off", "all", "one"];
    this.state.repeat = modes[(modes.indexOf(this.state.repeat) + 1) % modes.length];
    this.emit("stateChange", this.currentState);
  }

  moveUpcoming(fromIndex: number, toIndex: number): void {
    if (this.queue.moveUpcoming(fromIndex, toIndex)) {
      this.emit("queueChange", this.queue.all);
    }
  }

  clearQueue(): void {
    this.queue.clearUpcoming();
    this.emit("queueChange", this.queue.all);
  }

  removeUpcoming(index: number): void {
    if (this.queue.removeUpcoming(index)) {
      this.emit("queueChange", this.queue.all);
    }
  }

  /* ── Bridge state ─────────────────────────────────────── */

  /** Applies a report from the YouTube Music page. Public for tests. */
  handleBridgeState(report: YtmState): void {
    // Sign-in status only; it says nothing about playback.
    if (report.reason === "account") return;
    // Media keys and the system media controls skip through Sonora's queue.
    if (report.reason === "media-next") {
      this.next();
      return;
    }
    if (report.reason === "media-previous") {
      this.previous();
      return;
    }
    this.state.isAd = report.ad;

    if (report.videoId) {
      if (report.videoId === this.pendingId) {
        // Confirmed, even if an ad plays first: the page URL already names our track.
        this.pendingId = null;
        this.clearLoadTimer();
        // A load can leave the page on its own saved volume; put ours back.
        this.send({ action: "volume", value: this.state.isMuted ? 0 : this.state.volume });
      } else if (!report.ad && report.title && this.pageIsOnAnotherTrack(report)) {
        // The page is playing something else: its own radio, a media key, or a
        // song it chose over the one we asked for. Waiting for an id that is
        // never coming would freeze the interface on the wrong track, with the
        // wrong lyrics under the seek bar, while the music played on.
        this.pendingId = null;
        this.clearLoadTimer();
        this.adoptTrack(report);
      }
    }

    if (this.reportCorrectsCurrentTrack(report)) {
      const current = this.state.currentTrack!;
      this.setCurrent({
        ...current,
        title: report.title!,
        artist: report.artist ?? current.artist,
        artworkUrl: report.artworkUrl ?? current.artworkUrl,
        duration: report.duration > 0 ? Math.round(report.duration) : current.duration,
      });
    }

    if (report.reason === "ended" && !report.ad) {
      if (this.state.repeat === "one") {
        this.send({ action: "seek", value: 0 });
        this.send({ action: "play" });
      } else {
        // A finished track advances straight away; nothing is waiting to settle.
        const track = this.queue.next(this.state.repeat);
        if (track) this.load(track);
        else this.send({ action: "next" });
      }
      return;
    }

    if (!this.pendingId) {
      this.state.status = report.paused ? "paused" : "playing";
      this.state.error = undefined;
      if (!report.ad && report.duration > 0) this.state.duration = report.duration;
      this.setTime(report.ad ? 0 : report.currentTime);
      if (report.paused) this.stopTicker();
      else this.startTicker();
    }
    this.emit("stateChange", this.currentState);
  }

  /**
   * True when a report names a track that is neither the one showing nor the
   * one being loaded. While a load is outstanding only a "track" report counts,
   * since that is the page saying it finished loading something; anything else
   * could still be describing the song that was playing before.
   */
  private pageIsOnAnotherTrack(report: YtmState): boolean {
    if (report.videoId === this.state.currentTrack?.id) return false;
    return this.pendingId === null || report.reason === "track";
  }

  /**
   * YouTube Music's own title and artist are the truth for what is playing.
   * Only settled reports count: the first "play" of an ad can arrive before
   * the player marks itself as showing an ad.
   */
  private reportCorrectsCurrentTrack(report: YtmState): boolean {
    const current = this.state.currentTrack;
    return (
      !report.ad &&
      (report.reason === "track" || report.reason === "time") &&
      !!current &&
      report.videoId === current.id &&
      !!report.title &&
      (report.title !== current.title || (!!report.artist && report.artist !== current.artist))
    );
  }

  private adoptTrack(report: YtmState): void {
    const known = this.queue.all.find((t) => t.id === report.videoId);
    if (known) {
      this.queue.jumpTo(known.id);
      this.setCurrent(known);
      return;
    }
    this.setCurrent({
      id: report.videoId!,
      title: report.title!,
      artist: report.artist ?? "",
      album: report.album ?? undefined,
      duration: Math.round(report.duration),
      artworkUrl: report.artworkUrl ?? "",
    });
  }

  /* ── Internals ────────────────────────────────────────── */

  /**
   * Starts a track. A load still takes the page a moment to act on, and taps on
   * next arrive faster than that: handing it every one of them only asks it to
   * start tracks nobody waits for. The queue and the interface move with every
   * tap, but a run of them loads once, for the track the user stops on.
   */
  private load(track: Track, fromSkip = false): void {
    this.setCurrent(track, false);
    this.state.status = "loading";
    this.state.duration = track.duration || 0;
    this.setTime(0);
    this.emit("stateChange", this.currentState);

    if (!this.bridge.available) {
      this.fail(UNAVAILABLE_MESSAGE);
      return;
    }
    this.pendingId = track.id;
    this.clearLoadTimer();
    this.loadTimer = window.setTimeout(() => {
      if (this.pendingId === track.id) this.fail(LOAD_FAILED_MESSAGE);
    }, LOAD_TIMEOUT_MS);

    this.clearSkipTimer();
    const stillSkipping = fromSkip && Date.now() - this.lastSkipAt < SKIP_SETTLE_MS;
    if (fromSkip) this.lastSkipAt = Date.now();
    if (!stillSkipping) {
      this.send({ action: "load", value: track.id });
      this.settleOn(track);
      return;
    }
    this.skipTimer = window.setTimeout(() => {
      this.skipTimer = null;
      // A later tap has its own load pending; this one is no longer wanted.
      if (this.pendingId !== track.id) return;
      this.send({ action: "load", value: track.id });
      this.settleOn(track);
    }, SKIP_SETTLE_MS);
  }

  /**
   * Shows a track in the interface. Cheap enough for every tap on next; pass
   * `settle` as false when the track may still be skipped past.
   */
  private setCurrent(track: Track, settle = true): void {
    this.state.currentTrack = track;
    this.emit("trackChange", track);
    this.emit("queueChange", this.queue.all);
    if (settle) this.settleOn(track);
  }

  /**
   * The work a track only deserves once it is the one playing: its artwork is
   * fetched and read for colors, its lyrics are looked up, and it joins the
   * listening history. Tracks a run of skips passes through are never heard,
   * so doing this for each of them only cost time and filled history with
   * songs the user never played.
   */
  private settleOn(track: Track): void {
    storage.addToHistory(track);
    this.lyrics = null;
    // Both arrive late. A reply for a track that has since been left behind
    // would put the wrong words and the wrong colors on screen.
    const stillCurrent = () => this.state.currentTrack?.id === track.id;
    extractPalette(track.artworkUrl).then((palette) => {
      if (!stillCurrent()) return;
      this.palette = palette;
      this.emit("paletteChange", palette);
    });
    lyricsService.getLyrics(track).then((lyrics) => {
      if (!stillCurrent()) return;
      this.lyrics = lyrics;
      this.emit("lyricsChange", lyrics);
    });
  }

  private send(command: YtmCommand): void {
    if (!this.bridge.available) return;
    this.bridge.control(command).catch((err) => this.fail(err));
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) {
      window.clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  private clearSkipTimer(): void {
    if (this.skipTimer !== null) {
      window.clearTimeout(this.skipTimer);
      this.skipTimer = null;
    }
  }

  private fail(err: unknown): void {
    console.error("[PlaybackEngine]", err);
    this.pendingId = null;
    this.clearLoadTimer();
    this.clearSkipTimer();
    this.stopTicker();
    this.state.status = "error";
    this.state.error = typeof err === "string" ? err : "YouTube Music did not respond. Try again.";
    this.emit("stateChange", this.currentState);
  }

  private setTime(seconds: number): void {
    this.state.currentTime = seconds;
    this.lastReport = { time: seconds, at: performance.now() };
    this.emit("timeUpdate", { currentTime: seconds, duration: this.state.duration });
  }

  /** The page reports about once a second; fill in between so the progress bar moves smoothly. */
  private startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = window.setInterval(() => {
      if (this.state.status !== "playing" || this.state.isAd) return;
      const elapsed = (performance.now() - this.lastReport.at) / 1000;
      const time = Math.min(this.lastReport.time + elapsed, this.state.duration || Infinity);
      this.state.currentTime = time;
      this.emit("timeUpdate", { currentTime: time, duration: this.state.duration });
    }, TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

export const playerEngine = new PlaybackEngine();
