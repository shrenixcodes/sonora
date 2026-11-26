/**
 * Artist detail view — shows an artist's artwork, top songs, albums, singles, and related shelves.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSongContextMenu } from "@/components/song-context-menu";
import { createSongRadioButton } from "@/components/song-radio";
import { createTrackAlbumControl } from "@/components/track-links";
import { renderShelves } from "@/components/shelves";
import { icon } from "@/icons";
import { openArtist, openCollection } from "@/lib/navigation";
import { playerEngine } from "@/lib/playback/engine";
import { router } from "@/lib/router";
import { searchQuery } from "@/lib/search-query";
import { storage } from "@/lib/storage";
import { catalog, CatalogError, type ArtistPage } from "@/lib/ytm/catalog";
import type { Track } from "@/types/music";

export { openArtist };

interface ArtistTarget {
  id?: string;
  name: string;
  artworkUrl: string;
}

function targetFromHash(): ArtistTarget | null {
  const hash = window.location.hash.slice(1);
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) return null;
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  const id = params.get("id") || undefined;
  const name = params.get("name")?.trim() || "";
  if (!id && !name) return null;
  return {
    id,
    name: name || "Artist",
    artworkUrl: params.get("art") || "",
  };
}

function createBackButton(): HTMLElement {
  return el("button", {
    className: "collection__back-btn",
    attrs: { type: "button", "aria-label": "Go back" },
    children: [
      el("span", { className: "collection__back-icon", html: icon("chevronLeft") }),
      el("span", { text: "Back" }),
    ],
    onClick: () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.navigate("/");
      }
    },
  });
}

function createArtistTrackRow(track: Track, index: number, getQueue: () => Track[]): HTMLElement {
  const liked = storage.isLiked(track.id);
  const isPlaying = playerEngine.currentTrack?.id === track.id;
  const play = () => void playerEngine.playTrack(track, getQueue());

  const row = el("div", {
    className: `track-row${isPlaying ? " is-playing" : ""}`,
    attrs: {
      role: "button",
      tabindex: "0",
      "data-track-id": track.id,
      "aria-label": `Play ${track.title} by ${track.artist}`,
      ...(isPlaying ? { "aria-current": "true" } : {}),
    },
    onClick: play,
    onKeyDown: (e) => {
      if (e.target === row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        play();
      }
    },
    children: [
      el("div", { className: "track-row__index", text: String(index) }),
      el("div", {
        className: "track-row__play-icon",
        html: icon("play"),
        attrs: { "aria-hidden": "true" },
      }),
      el("img", {
        className: "track-row__art",
        attrs: { src: track.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" },
      }),
      el("div", {
        className: "track-row__info",
        children: [
          el("span", { className: "track-row__title truncate", text: track.title }),
          el("span", { className: "track-row__artist truncate", text: track.artist }),
        ],
      }),
      createTrackAlbumControl(track),
      createSongRadioButton(track),
      el("button", {
        className: `track-row__like-btn${liked ? " track-row__like-btn--active" : ""}`,
        html: icon("heart"),
        attrs: { type: "button", "aria-label": `Like ${track.title}`, "aria-pressed": String(liked) },
        onClick: (e) => {
          e.stopPropagation();
          const nowLiked = storage.toggleLike(track);
          const btn = e.currentTarget as HTMLElement;
          btn.classList.toggle("track-row__like-btn--active", nowLiked);
          btn.setAttribute("aria-pressed", String(nowLiked));
        },
      }),
      el("span", {
        className: "track-row__duration",
        text: track.duration ? formatTime(track.duration) : "",
      }),
    ],
  });

  attachSongContextMenu(row, track);
  return row;
}

/** Renders the `/artist` page, resolving artist data by browse id or by artist name search. */
export function renderArtist(container: HTMLElement): void {
  const target = targetFromHash();
  if (!target) {
    router.navigate("/");
    return;
  }

  const content = el("div", { className: "main__content collection artist-page" });
  container.appendChild(content);

  const activeHash = window.location.hash.slice(1);
  const cleanupFns: Array<() => void> = [];
  const markPlaying = (track: Track | null) => {
    content.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };
  cleanupFns.push(playerEngine.on("trackChange", markPlaying));
  const stopNav = router.onNavigate((path) => {
    if (path === activeHash) return;
    cleanupFns.forEach((fn) => fn());
    stopNav();
  });

  const artworkImg = el("img", {
    attrs: { src: target.artworkUrl || "/artwork-placeholder.svg", alt: target.name },
  }) as HTMLImageElement;
  const titleEl = el("h1", { className: "collection__title", text: target.name });
  const subtitleEl = el("p", { className: "collection__subtitle", text: "Loading artist…" });
  const descEl = el("p", { className: "artist-page__description" });

  let tracks: Track[] = [];
  const playBtn = el("button", {
    className: "btn btn--primary",
    attrs: { type: "button", disabled: "" },
    children: [el("span", { className: "btn__icon", html: icon("play") }), el("span", { text: "Play" })],
    onClick: () => {
      if (tracks.length > 0) void playerEngine.playTrack(tracks[0], tracks);
    },
  }) as HTMLButtonElement;

  const shuffleBtn = el("button", {
    className: "btn btn--secondary",
    attrs: { type: "button", disabled: "" },
    children: [el("span", { className: "btn__icon", html: icon("shuffle") }), el("span", { text: "Shuffle" })],
    onClick: () => {
      void playerEngine.playShuffled(tracks);
    },
  }) as HTMLButtonElement;

  const bodyHost = el("div", { className: "artist-page__body", attrs: { "aria-live": "polite" } });

  content.append(
    createBackButton(),
    el("div", {
      className: "collection__header",
      children: [
        el("div", { className: "collection__artwork collection__artwork--round", children: [artworkImg] }),
        el("div", {
          className: "collection__meta",
          children: [
            el("span", { className: "collection__eyebrow", text: "Artist" }),
            titleEl,
            subtitleEl,
            descEl,
            el("div", { className: "page-header__actions", children: [playBtn, shuffleBtn] }),
          ],
        }),
      ],
    }),
    bodyHost,
  );

  const renderPage = (page: ArtistPage) => {
    titleEl.textContent = page.name;
    if (page.artworkUrl) artworkImg.src = page.artworkUrl;
    const parts = [page.subscribers, page.topSongs.length > 0 ? `${page.topSongs.length} top songs` : ""].filter(Boolean);
    subtitleEl.textContent = parts.join(" · ") || "Artist";
    descEl.textContent = page.description ?? "";

    tracks = page.topSongs;
    playBtn.toggleAttribute("disabled", tracks.length === 0);
    shuffleBtn.toggleAttribute("disabled", tracks.length === 0);

    const nodes: HTMLElement[] = [];
    if (tracks.length > 0) {
      const headerChildren: HTMLElement[] = [el("h2", { className: "section__title", text: "Top songs" })];
      if (page.topSongsPlaylistId) {
        headerChildren.push(
          el("button", {
            className: "section__more",
            text: "Show all",
            attrs: { type: "button" },
            onClick: () =>
              openCollection({
                source: "ytm",
                id: page.topSongsPlaylistId!,
                kind: "playlist",
                title: `${page.name} — Top songs`,
                subtitle: page.subscribers ?? page.name,
                artworkUrl: page.artworkUrl,
              }),
          }),
        );
      }
      nodes.push(
        el("section", {
          className: "section",
          children: [
            el("div", { className: "section__header", children: headerChildren }),
            el("div", {
              className: "track-list",
              children: tracks.map((track, idx) => createArtistTrackRow(track, idx + 1, () => tracks)),
            }),
          ],
        }),
      );
    }

    if (page.shelves.length > 0) {
      nodes.push(...renderShelves(page.shelves, ""));
    }

    if (nodes.length === 0) {
      nodes.push(
        el("div", {
          className: "empty-state",
          children: [
            el("div", { className: "empty-state__icon", html: icon("artist") }),
            el("h3", { className: "empty-state__title", text: "Nothing listed yet" }),
            el("p", {
              className: "empty-state__description",
              text: "Try searching YouTube Music to see more songs by this artist.",
            }),
            el("button", {
              className: "btn btn--secondary",
              text: "Search artist",
              attrs: { type: "button" },
              onClick: () => {
                searchQuery.searchFor(page.name, "artists");
                router.navigate("/search");
              },
            }),
          ],
        }),
      );
    }

    bodyHost.replaceChildren(...nodes);
    markPlaying(playerEngine.currentTrack);
  };

  const load = async () => {
    bodyHost.setAttribute("aria-busy", "true");
    bodyHost.replaceChildren(el("p", { className: "home__hint", text: "Loading songs and releases…" }));
    try {
      let artistId = target.id;
      let fallbackArt = target.artworkUrl;
      if (!artistId && target.name) {
        const res = await catalog.search(target.name, "artists");
        const normalized = target.name.toLowerCase();
        const match =
          res.collections?.find((c) => c.kind === "artist" && c.artistId && c.title.toLowerCase() === normalized) ??
          res.collections?.find((c) => c.kind === "artist" && c.artistId);
        artistId = match?.artistId;
        if (match?.artworkUrl) fallbackArt = fallbackArt || match.artworkUrl;
      }

      if (artistId) {
        const page = await catalog.getArtist(artistId, target.name);
        if (!content.isConnected) return;
        bodyHost.removeAttribute("aria-busy");
        if (!page.artworkUrl && fallbackArt) page.artworkUrl = fallbackArt;
        renderPage(page);
        return;
      }

      const fallbackSongs = target.name ? await catalog.searchSongs(target.name) : [];
      if (!content.isConnected) return;
      bodyHost.removeAttribute("aria-busy");
      renderPage({
        id: "",
        name: target.name,
        artworkUrl: fallbackArt || fallbackSongs[0]?.artworkUrl || "",
        topSongs: fallbackSongs,
        shelves: [],
      });
    } catch (err) {
      if (!content.isConnected) return;
      bodyHost.removeAttribute("aria-busy");
      const message = err instanceof CatalogError ? err.message : "Couldn't load this artist right now.";
      subtitleEl.textContent = target.name;
      bodyHost.replaceChildren(
        el("div", {
          className: "home__notice",
          children: [
            el("p", { className: "home__hint", text: message }),
            el("button", { className: "btn btn--secondary", text: "Try again", attrs: { type: "button" }, onClick: load }),
            el("button", {
              className: "btn btn--secondary",
              text: "Search in library",
              attrs: { type: "button" },
              onClick: () => {
                searchQuery.searchFor(target.name, "artists");
                router.navigate("/search");
              },
            }),
          ],
        }),
      );
    }
  };

  void load();
}
