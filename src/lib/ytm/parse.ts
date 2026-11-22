/**
 * Parsers for YouTube Music API responses.
 *
 * The responses are deeply nested "renderer" trees that the site changes from
 * time to time, so these parsers search for the renderers they need instead of
 * following fixed paths, and skip anything they can't read instead of failing.
 */

import type { Track } from "@/types/music";

type Json = Record<string, unknown>;

export interface HomeShelf {
  title: string;
  tracks: Track[];
}

const SEPARATOR = " • ";
const DURATION = /^\d{1,2}(:\d{2}){1,2}$/;
/** Artwork size requested from Google's image servers (they resize on the fly). */
const ARTWORK_SIZE = 544;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every value stored under `key` anywhere in the tree, in document order. */
export function findAll(node: unknown, key: string, found: Json[] = []): Json[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, key, found));
  } else if (isObject(node)) {
    for (const [k, value] of Object.entries(node)) {
      if (k === key && isObject(value)) found.push(value);
      findAll(value, key, found);
    }
  }
  return found;
}

function get(node: unknown, ...path: Array<string | number>): unknown {
  let current = node;
  for (const step of path) {
    if (Array.isArray(current) && typeof step === "number") current = current[step];
    else if (isObject(current) && typeof step === "string") current = current[step];
    else return undefined;
  }
  return current;
}

interface Run {
  text: string;
  pageType?: string;
  videoId?: string;
}

function runsOf(text: unknown): Run[] {
  const runs = get(text, "runs");
  if (!Array.isArray(runs)) return [];
  return runs.filter(isObject).map((run) => ({
    text: typeof run.text === "string" ? run.text : "",
    pageType: get(run, "navigationEndpoint", "browseEndpoint", "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig", "pageType") as string | undefined,
    videoId: get(run, "navigationEndpoint", "watchEndpoint", "videoId") as string | undefined,
  }));
}

const joined = (runs: Run[]) => runs.map((r) => r.text).join("").trim();

/** Splits runs into the " • "-separated segments the site uses for subtitles. */
function segments(runs: Run[]): Run[][] {
  const result: Run[][] = [[]];
  for (const run of runs) {
    if (run.text === SEPARATOR) result.push([]);
    else result[result.length - 1].push(run);
  }
  return result.filter((segment) => segment.length > 0);
}

export function parseDuration(text: string): number {
  if (!DURATION.test(text)) return 0;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** Picks the largest thumbnail and asks Google's image server for a sharper copy. */
export function artworkUrl(thumbnails: unknown): string {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return "";
  const largest = thumbnails
    .filter(isObject)
    .reduce<Json | null>((best, t) => (!best || Number(t.width) > Number(best.width) ? t : best), null);
  const url = typeof largest?.url === "string" ? largest.url : "";
  return url.replace(/=w\d+-h\d+/, `=w${ARTWORK_SIZE}-h${ARTWORK_SIZE}`);
}

/** A song row (search results, "Song mixes" and similar list shelves). */
export function parseListItem(item: Json): Track | null {
  const columns = (Array.isArray(item.flexColumns) ? item.flexColumns : []).map((column) =>
    runsOf(get(column, "musicResponsiveListItemFlexColumnRenderer", "text")),
  );
  const titleRuns = columns[0] ?? [];
  const videoId =
    (get(item, "playlistItemData", "videoId") as string | undefined) ?? titleRuns.find((r) => r.videoId)?.videoId;
  const title = joined(titleRuns);
  if (!videoId || !title) return null;

  const details = columns.slice(1).flatMap((runs) => segments(runs));
  const artistSegment =
    details.find((segment) => segment.some((r) => r.pageType === "MUSIC_PAGE_TYPE_ARTIST")) ?? details[0] ?? [];
  const album = columns.flat().find((r) => r.pageType === "MUSIC_PAGE_TYPE_ALBUM")?.text;
  const duration = details.map(joined).find((text) => DURATION.test(text));

  return {
    id: videoId,
    title,
    artist: joined(artistSegment),
    album,
    duration: duration ? parseDuration(duration) : 0,
    artworkUrl: artworkUrl(get(item, "thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails")),
  };
}

/** A card that plays a single song or video directly; playlists and albums return null. */
export function parseCardItem(item: Json): Track | null {
  const videoId = get(item, "navigationEndpoint", "watchEndpoint", "videoId");
  const title = joined(runsOf(item.title));
  if (typeof videoId !== "string" || !title) return null;

  const subtitle = segments(runsOf(item.subtitle));
  const artistSegment =
    subtitle.find((segment) => segment.some((r) => r.pageType === "MUSIC_PAGE_TYPE_ARTIST")) ?? subtitle[0] ?? [];
  return {
    id: videoId,
    title,
    artist: joined(artistSegment),
    duration: 0,
    artworkUrl: artworkUrl(get(item, "thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails")),
  };
}

function uniqueById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
}

/** Songs from a search response (Sonora searches with YouTube Music's "Songs" filter). */
export function parseSearchSongs(response: unknown): Track[] {
  const items = findAll(response, "musicShelfRenderer").flatMap((shelf) =>
    findAll(shelf.contents, "musicResponsiveListItemRenderer"),
  );
  return uniqueById(items.map(parseListItem).filter((t): t is Track => t !== null));
}

/** Home shelves that contain playable songs; shelves of playlists or albums are left out. */
export function parseHomeShelves(response: unknown): HomeShelf[] {
  return findAll(response, "musicCarouselShelfRenderer")
    .map((shelf) => {
      const title = joined(runsOf(get(shelf, "header", "musicCarouselShelfBasicHeaderRenderer", "title")));
      const contents = Array.isArray(shelf.contents) ? shelf.contents.filter(isObject) : [];
      const tracks = contents
        .map((entry) =>
          isObject(entry.musicResponsiveListItemRenderer)
            ? parseListItem(entry.musicResponsiveListItemRenderer)
            : isObject(entry.musicTwoRowItemRenderer)
              ? parseCardItem(entry.musicTwoRowItemRenderer)
              : null,
        )
        .filter((t): t is Track => t !== null);
      return { title, tracks: uniqueById(tracks) };
    })
    .filter((shelf) => shelf.title && shelf.tracks.length > 0);
}
