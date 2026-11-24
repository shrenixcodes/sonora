/**
 * Shared navigation helpers for opening artist pages and album/playlist collections.
 */

import { router } from "@/lib/router";

export interface ArtistNavTarget {
  id?: string;
  name: string;
  artworkUrl?: string;
}

export type CollectionTarget =
  | {
      source: "ytm";
      id: string;
      kind: "playlist" | "album";
      title: string;
      subtitle: string;
      artworkUrl: string;
      query?: string;
    }
  | {
      source: "local";
      id: string;
    };

export interface AlbumNavTarget {
  id?: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
}

const collectionCache = new Map<string, Extract<CollectionTarget, { source: "ytm" }>>();

/** Reads cached metadata stored when navigating to a YouTube Music collection. */
export function getCachedCollection(id: string): Extract<CollectionTarget, { source: "ytm" }> | undefined {
  return collectionCache.get(id);
}

/** Opens the dedicated artist page, using its channel id when known or resolving by name. */
export function openArtist(target: ArtistNavTarget): void {
  const name = target.name.trim();
  if (!name && !target.id) return;
  const params = new URLSearchParams();
  if (target.id) params.set("id", target.id);
  if (name) params.set("name", name);
  if (target.artworkUrl) params.set("art", target.artworkUrl);
  router.navigate(`/artist?${params.toString()}`);
}

/** Navigates to the playlist/album track list view without starting playback. */
export function openCollection(target: CollectionTarget): void {
  if (target.source === "ytm") {
    if (target.id) collectionCache.set(target.id, target);
    const params = new URLSearchParams({
      source: "ytm",
      id: target.id,
      kind: target.kind,
      title: target.title,
    });
    if (target.subtitle) params.set("subtitle", target.subtitle);
    if (target.artworkUrl) params.set("art", target.artworkUrl);
    if (target.query) params.set("query", target.query);
    router.navigate(`/playlist?${params.toString()}`);
    return;
  }

  const params = new URLSearchParams({
    source: "local",
    id: target.id,
  });
  router.navigate(`/playlist?${params.toString()}`);
}

/** Opens an album playlist view by browse id or resolves it by album title + artist. */
export function openAlbum(target: AlbumNavTarget): void {
  const title = target.title.trim();
  const artist = target.artist?.trim() ?? "";
  if (!target.id && !title) return;
  openCollection({
    source: "ytm",
    id: target.id ?? "",
    kind: "album",
    title: title || "Album",
    subtitle: artist,
    artworkUrl: target.artworkUrl ?? "",
    ...(!target.id ? { query: `${title} ${artist}`.trim() } : {}),
  });
}
