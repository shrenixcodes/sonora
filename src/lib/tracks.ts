import type { Track } from "@/types/music";

/** Keeps the first (most recent) entry for each track id. */
export function dedupeById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}
