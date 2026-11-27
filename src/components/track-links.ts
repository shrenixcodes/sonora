/**
 * Reusable clickable artist and album metadata controls shared across song lists, cards, and tiles.
 */

import { el } from "@/lib/dom";
import { openAlbum, openArtist } from "@/lib/navigation";
import type { Track } from "@/types/music";

/** Updates rendered track-row heart buttons matching `trackId` when like state changes elsewhere. */
export function syncTrackRowLikeButtons(root: ParentNode, trackId: string, isLiked: boolean): void {
  root.querySelectorAll<HTMLElement>("[data-track-id]").forEach((row) => {
    if (row.dataset.trackId !== trackId) return;
    const btn = row.querySelector<HTMLElement>(".track-row__like-btn");
    if (!btn) return;
    btn.classList.toggle("track-row__like-btn--active", isLiked);
    btn.setAttribute("aria-pressed", String(isLiked));
    const title = row.querySelector<HTMLElement>(".track-row__title")?.textContent?.trim();
    if (title) {
      btn.setAttribute("aria-label", isLiked ? `Unlike ${title}` : `Like ${title}`);
    }
    if (btn.hasAttribute("title")) {
      btn.setAttribute("title", isLiked ? "Unlike track" : "Like track");
    }
  });
}

/** Renders a track's artist name as an interactive button that opens the artist page without playing the row. */
export function createTrackArtistControl(track: Track): HTMLElement {
  const artistName = track.artist?.trim();
  if (!artistName) {
    return el("span", { className: "track-row__artist truncate", text: track.artist || "" });
  }
  return el("button", {
    className: "track-row__artist track-row__link truncate",
    text: track.artist,
    attrs: { type: "button", title: `Open artist: ${artistName}`, "aria-label": `Open artist ${artistName}` },
    onClick: (e) => {
      e.stopPropagation();
      openArtist({ id: track.artistId, name: artistName });
    },
    onKeyDown: (e) => e.stopPropagation(),
  });
}

/** Renders a track's album column as an interactive button opening the album playlist when known. */
export function createTrackAlbumControl(track: Track, fallbackText = ""): HTMLElement {
  const albumTitle = track.album?.trim();
  if (!albumTitle) {
    return el("span", { className: "track-row__album truncate", text: fallbackText });
  }
  return el("button", {
    className: "track-row__album track-row__link truncate",
    text: albumTitle,
    attrs: { type: "button", title: `Open album: ${albumTitle}`, "aria-label": `Open album ${albumTitle}` },
    onClick: (e) => {
      e.stopPropagation();
      openAlbum({
        id: track.albumId,
        title: albumTitle,
        artist: track.artist,
        artworkUrl: track.artworkUrl,
      });
    },
    onKeyDown: (e) => e.stopPropagation(),
  });
}

/** Renders an inline link-role element (safe inside parent `<button>` wrappers without nesting buttons). */
export function createInlineArtistLink(
  artistName: string,
  artistId: string | undefined,
  className: string,
): HTMLElement {
  const clean = artistName.trim();
  if (!clean) {
    return el("span", { className, text: artistName });
  }
  const trigger = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    openArtist({ id: artistId, name: clean });
  };
  return el("span", {
    className: `${className} artist-inline-link`,
    text: artistName,
    attrs: {
      role: "link",
      tabindex: "0",
      title: `Open artist: ${clean}`,
      "aria-label": `Open artist ${clean}`,
    },
    onClick: trigger,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") trigger(e);
    },
  });
}
