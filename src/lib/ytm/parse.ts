/**
 * Parsers for YouTube Music API responses.
 *
 * The responses are deeply nested "renderer" trees that the site changes from
 * time to time, so these parsers search for the renderers they need instead of
 * following fixed paths, and skip anything they can't read instead of failing.
 */

import type { Track } from "@/types/music";

type Json = Record<string, unknown>;

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
  let url = typeof largest?.url === "string" ? largest.url : "";
  // Some covers (Liked Music, auto playlists) come without a scheme, which
  // would resolve against the app's own origin instead of the web.
  if (url.startsWith("//")) url = `https:${url}`;
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

/** Something on a Home shelf other than a single song. */
export interface HomeCollection {
  kind: "album" | "playlist" | "artist";
  title: string;
  subtitle: string;
  artworkUrl: string;
  /** Playlist that plays this album, playlist or mix; absent for artists. */
  playlistId?: string;
}

export type HomeItem = { kind: "song"; track: Track } | HomeCollection;

export interface HomeShelf {
  title: string;
  /** Small line above the title, such as "Mixed for you". */
  strapline?: string;
  /** "list" shelves are song rows (Quick picks); "cards" shelves are artwork cards. */
  layout: "list" | "cards";
  items: HomeItem[];
  /** The shelf's songs, in order, to queue when one of them plays. */
  tracks: Track[];
}

/** A mood or genre chip at the top of Home, such as "Relax" or "Workout". */
export interface HomeChip {
  title: string;
  params: string;
}

export interface HomePage {
  chips: HomeChip[];
  shelves: HomeShelf[];
}

function pageTypeOf(endpoint: unknown): string | undefined {
  return get(endpoint, "browseEndpoint", "browseEndpointContextSupportedConfigs",
    "browseEndpointContextMusicConfig", "pageType") as string | undefined;
}

/** Playlist behind an item's play button, or behind its own link for playlists. */
function playlistIdOf(item: Json): string | undefined {
  const overlay = findAll(item.thumbnailOverlay, "watchPlaylistEndpoint")[0]
    ?? findAll(item.thumbnailOverlay, "watchEndpoint")[0];
  if (typeof overlay?.playlistId === "string") return overlay.playlistId;
  const browseId = get(item, "navigationEndpoint", "browseEndpoint", "browseId");
  return typeof browseId === "string" && browseId.startsWith("VL") ? browseId.slice(2) : undefined;
}

/** An album, playlist, mix or artist card. Songs are handled by parseCardItem. */
export function parseCollectionItem(item: Json): HomeCollection | null {
  const title = joined(runsOf(item.title));
  const pageType = pageTypeOf(item.navigationEndpoint);
  if (!title || !pageType) return null;

  const kind =
    pageType === "MUSIC_PAGE_TYPE_ALBUM" || pageType === "MUSIC_PAGE_TYPE_AUDIOBOOK"
      ? "album"
      : pageType === "MUSIC_PAGE_TYPE_PLAYLIST"
        ? "playlist"
        : pageType === "MUSIC_PAGE_TYPE_ARTIST" || pageType === "MUSIC_PAGE_TYPE_USER_CHANNEL"
          ? "artist"
          : null;
  if (!kind) return null;

  const playlistId = kind === "artist" ? undefined : playlistIdOf(item);
  if (kind !== "artist" && !playlistId) return null;
  return {
    kind,
    title,
    subtitle: joined(runsOf(item.subtitle)),
    artworkUrl: artworkUrl(get(item, "thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails")),
    ...(playlistId ? { playlistId } : {}),
  };
}

function parseHomeItem(entry: Json): HomeItem | null {
  if (isObject(entry.musicResponsiveListItemRenderer)) {
    const track = parseListItem(entry.musicResponsiveListItemRenderer);
    return track ? { kind: "song", track } : null;
  }
  if (isObject(entry.musicTwoRowItemRenderer)) {
    const card = entry.musicTwoRowItemRenderer;
    const track = parseCardItem(card);
    return track ? { kind: "song", track } : parseCollectionItem(card);
  }
  return null;
}

/** Every Home shelf with something Sonora can show: songs, albums, playlists, mixes and artists. */
export function parseHomeShelves(response: unknown): HomeShelf[] {
  return findAll(response, "musicCarouselShelfRenderer")
    .map((shelf): HomeShelf => {
      const header = get(shelf, "header", "musicCarouselShelfBasicHeaderRenderer");
      const title = joined(runsOf(get(header, "title")));
      const strapline = joined(runsOf(get(header, "strapline"))) || undefined;
      const contents = Array.isArray(shelf.contents) ? shelf.contents.filter(isObject) : [];
      const seen = new Set<string>();
      const items = contents
        .map(parseHomeItem)
        .filter((item): item is HomeItem => {
          if (!item) return false;
          const key = item.kind === "song" ? item.track.id : `${item.kind}:${item.playlistId ?? item.title}`;
          return !seen.has(key) && (seen.add(key), true);
        });
      const layout = contents.some((c) => isObject(c.musicResponsiveListItemRenderer)) ? "list" : "cards";
      const tracks = items.flatMap((item) => (item.kind === "song" ? [item.track] : []));
      return { title, ...(strapline ? { strapline } : {}), layout, items, tracks };
    })
    .filter((shelf) => shelf.title && shelf.items.length > 0);
}

/** The mood and genre chips at the top of Home. */
export function parseHomeChips(response: unknown): HomeChip[] {
  return findAll(response, "chipCloudChipRenderer").flatMap((chip) => {
    const title = joined(runsOf(chip.text));
    const params = get(chip, "navigationEndpoint", "browseEndpoint", "params");
    return title && typeof params === "string" ? [{ title, params }] : [];
  });
}

/** Songs from a watch queue ("next" response), used for mixes that have no playlist page. */
export function parseWatchPlaylist(response: unknown): Track[] {
  const tracks = findAll(response, "playlistPanelVideoRenderer").flatMap((item): Track[] => {
    const videoId = item.videoId;
    const title = joined(runsOf(item.title));
    if (typeof videoId !== "string" || !title) return [];
    const byline = segments(runsOf(item.longBylineText));
    const artistSegment =
      byline.find((segment) => segment.some((r) => r.pageType === "MUSIC_PAGE_TYPE_ARTIST")) ?? byline[0] ?? [];
    const album = byline.flat().find((r) => r.pageType === "MUSIC_PAGE_TYPE_ALBUM")?.text;
    return [
      {
        id: videoId,
        title,
        artist: joined(artistSegment),
        album,
        duration: parseDuration(joined(runsOf(item.lengthText))),
        artworkUrl: artworkUrl(get(item, "thumbnail", "thumbnails")),
      },
    ];
  });
  return uniqueById(tracks);
}

/** A playlist saved in the user's YouTube Music library. */
export interface LibraryPlaylist {
  id: string;
  title: string;
  subtitle: string;
  artworkUrl: string;
}

/** Songs on a playlist page, the Liked Music page, or one of their continuation pages. */
export function parsePlaylistTracks(response: unknown): Track[] {
  const items = findAll(response, "musicResponsiveListItemRenderer");
  return uniqueById(items.map(parseListItem).filter((t): t is Track => t !== null));
}

/** Playlist cards from the library's Playlists page; the "New playlist" card is skipped. */
export function parseLibraryPlaylists(response: unknown): LibraryPlaylist[] {
  const seen = new Set<string>();
  return findAll(response, "musicTwoRowItemRenderer").flatMap((item) => {
    const browseId = get(item, "navigationEndpoint", "browseEndpoint", "browseId");
    const title = joined(runsOf(item.title));
    if (typeof browseId !== "string" || !browseId.startsWith("VL") || !title) return [];
    const id = browseId.slice(2);
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        title,
        subtitle: joined(runsOf(item.subtitle)),
        artworkUrl: artworkUrl(get(item, "thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails")),
      },
    ];
  });
}

/** Token for the next page of a long list, if there is one. */
export function parseContinuation(response: unknown): string | null {
  const command = findAll(response, "continuationCommand").find((c) => typeof c.token === "string");
  if (command) return command.token as string;
  const next = findAll(response, "nextContinuationData").find((c) => typeof c.continuation === "string");
  return next ? (next.continuation as string) : null;
}

/** The signed-in Google account, as shown in YouTube Music's account menu. */
export interface AccountProfile {
  name: string;
  /** Channel handle such as "@someone", when the account has one. */
  handle?: string;
  email?: string;
  photoUrl: string;
}

export function parseAccountProfile(response: unknown): AccountProfile | null {
  const header = findAll(response, "activeAccountHeaderRenderer")[0];
  if (!header) return null;
  const name = joined(runsOf(header.accountName));
  if (!name) return null;
  const handle = joined(runsOf(header.channelHandle));
  const email = joined(runsOf(header.email));
  return {
    name,
    ...(handle ? { handle } : {}),
    ...(email ? { email } : {}),
    photoUrl: artworkUrl(get(header, "accountPhoto", "thumbnails")).replace(/=s\d+/, "=s176"),
  };
}
