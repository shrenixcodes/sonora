import { catalog } from "@/lib/ytm/catalog";
import { playerEngine } from "@/lib/playback/engine";
import type { Track } from "@/types/music";

export type RadioResult = { status: "queued"; count: number } | { status: "empty" | "cancelled" };
let cancelPrevious: (() => void) | null = null;
let stopRadio: (() => void) | null = null;

function uniqueRecommendations(source: Track, recommendations: Track[], existing: Track[]): Track[] {
  const seen = new Set(existing.map((item) => item.id));
  const title = source.title.trim().toLocaleLowerCase();
  return recommendations.filter((item) => {
    if (!item.id || seen.has(item.id) || item.title.trim().toLocaleLowerCase() === title) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 25);
}

/** Keeps an explicitly started radio going until the user edits or replaces its queue. */
function continueRadio(seed: Track): void {
  let stopped = false;
  let fetching = false;
  let lastSeed = "";
  let lastUpcoming = playerEngine.upcoming.length;
  let lastTrack = playerEngine.currentTrack?.id;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    offTrack();
    offQueue();
    if (stopRadio === stop) stopRadio = null;
  };
  const offTrack = playerEngine.on("trackChange", (current) => {
    lastTrack = current?.id;
    lastUpcoming = playerEngine.upcoming.length;
    if (!current || playerEngine.currentQueue[0]?.id !== seed.id) { stop(); return; }
    if (lastUpcoming > 3 || fetching || lastSeed === current.id) return;
    lastSeed = current.id;
    fetching = true;
    void catalog.getPlaylistTracks(`RDAMVM${current.id}`).then((recommendations) => {
      if (stopped || playerEngine.currentQueue[0]?.id !== seed.id) return;
      const songs = uniqueRecommendations(current, recommendations, playerEngine.currentQueue);
      if (songs.length) playerEngine.extendQueue(seed, songs);
    }).catch((error) => console.warn("[radio] could not load more recommendations:", error))
      .finally(() => { fetching = false; });
  });
  const offQueue = playerEngine.on("queueChange", () => {
    const upcoming = playerEngine.upcoming.length;
    if (playerEngine.currentQueue[0]?.id !== seed.id ||
        (playerEngine.currentTrack?.id === lastTrack && upcoming < lastUpcoming)) {
      stop();
      return;
    }
    lastTrack = playerEngine.currentTrack?.id;
    lastUpcoming = upcoming;
  });
  stopRadio = stop;
}

/** Starts the selected song immediately and appends its radio recommendations. */
export async function startSongRadio(track: Track): Promise<RadioResult> {
  cancelPrevious?.();
  stopRadio?.();
  void playerEngine.playTrack(track, [track]);
  let cancelled = false;
  const stopQueue = playerEngine.on("queueChange", () => {
    const queue = playerEngine.currentQueue;
    if (playerEngine.currentTrack?.id !== track.id || queue.length !== 1 || queue[0]?.id !== track.id) cancel();
  });
  const cancel = () => {
    cancelled = true;
    stopQueue();
    if (cancelPrevious === cancel) cancelPrevious = null;
  };
  cancelPrevious = cancel;
  try {
    const recommendations = await catalog.getPlaylistTracks(`RDAMVM${track.id}`);
    if (cancelled || playerEngine.currentTrack?.id !== track.id) return { status: "cancelled" };
    const songs = uniqueRecommendations(track, recommendations, [track]);
    stopQueue();
    if (cancelPrevious === cancel) cancelPrevious = null;
    if (songs.length === 0) return { status: "empty" };
    playerEngine.extendQueue(track, songs);
    continueRadio(track);
    return { status: "queued", count: songs.length };
  } catch (error) {
    if (cancelled) return { status: "cancelled" };
    throw error;
  } finally {
    stopQueue();
    if (cancelPrevious === cancel) cancelPrevious = null;
  }
}
