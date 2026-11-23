/**
 * Home view.
 *
 * Greeting, YouTube Music's mood chips and every Home shelf it sends: song
 * rows as compact tiles, and albums, playlists, mixes, videos and artists as
 * cards. A "Jump back in" shelf comes from local listening history. Every
 * tile is a real button that plays what it shows.
 */

import { el } from "@/lib/dom";
import { catalog, CatalogError, type HomeChip, type HomePage } from "@/lib/ytm/catalog";
import { account } from "@/lib/ytm/account";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { greetingFor } from "@/lib/greeting";
import { dedupeById } from "@/lib/tracks";
import { createSongCard, placeholderShelf, renderShelves, section } from "@/components/shelves";
import type { Track } from "@/types/music";

const RECENT_LIMIT = 10;

export function renderHome(container: HTMLElement): void {
  const recent = dedupeById(storage.getHistory()).slice(0, RECENT_LIMIT);
  const chipsHost = el("div", { className: "home__chips", attrs: { role: "toolbar", "aria-label": "Moods and genres" } });
  const shelvesHost = el("div", { className: "home__shelves", attrs: { "aria-live": "polite" } });
  /** The selected chip's params; null shows the unfiltered Home. */
  let selectedChip: string | null = null;

  const content = el("div", {
    className: "main__content home",
    children: [
      el("div", {
        className: "page-header",
        children: [el("h1", { className: "page-header__title", text: greetingFor(new Date()) })],
      }),

      chipsHost,
      shelvesHost,

      section(
        "Jump back in",
        recent.length > 0
          ? el("div", {
              className: "shelf",
              children: recent.map((track) => createSongCard(track, recent)),
            })
          : el("p", {
              className: "home__hint",
              text: "Songs you play will show up here so you can get back to them quickly.",
            }),
      ),
    ],
  });

  container.appendChild(content);

  // Highlight the playing track; stop listening once the user leaves Home.
  const markPlaying = (track: Track | null) => {
    content.querySelectorAll<HTMLElement>("[data-track-id]").forEach((node) => {
      const isCurrent = node.dataset.trackId === track?.id;
      node.classList.toggle("is-playing", isCurrent);
      if (isCurrent) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  };
  markPlaying(playerEngine.currentTrack);
  const stopTrackListener = playerEngine.on("trackChange", markPlaying);
  // Signing in or out changes what YouTube Music suggests.
  const stopAccountListener = account.on("change", () => {
    selectedChip = null;
    load(true);
  });
  const stopNavListener = router.onNavigate((path) => {
    if (path === "/") return;
    stopTrackListener();
    stopAccountListener();
    stopNavListener();
  });

  /** Chips of the unfiltered Home; they stay put while a chip's page loads. */
  let chips: HomeChip[] = [];
  const renderChips = () => {
    if (chips.length === 0) return;
    const chip = (title: string, params: string | null) =>
      el("button", {
        className: `search__filter-chip${params === selectedChip ? " search__filter-chip--active" : ""}`,
        text: title,
        attrs: { type: "button", "aria-pressed": String(params === selectedChip) },
        onClick: () => {
          if (params === selectedChip) return;
          selectedChip = params;
          renderChips();
          load();
        },
      });
    chipsHost.replaceChildren(chip("All", null), ...chips.map((c) => chip(c.title, c.params)));
  };

  const emptyText =
    "YouTube Music has no suggestions here yet. Sign in from Settings for a personal Home, or try Search.";
  const showPage = (page: HomePage) => {
    if (!selectedChip && page.chips.length > 0) {
      chips = page.chips;
      renderChips();
    }
    shelvesHost.replaceChildren(...renderShelves(page.shelves, emptyText));
    markPlaying(playerEngine.currentTrack);
  };

  /**
   * Shows Home as last seen at once (if there is a copy), then the fresh first
   * page, then appends further shelves as they arrive.
   */
  const load = async (refresh = false) => {
    const params = selectedChip;
    const stillWanted = () => shelvesHost.isConnected && params === selectedChip;
    const snapshot = !params && !refresh ? catalog.peekHome() : null;
    const showingSnapshot = !!snapshot && snapshot.shelves.length > 0;
    if (showingSnapshot) showPage(snapshot);
    else shelvesHost.replaceChildren(placeholderShelf("Loading your Home from YouTube Music"));

    shelvesHost.setAttribute("aria-busy", "true");
    let page: HomePage;
    try {
      page = await catalog.getHome({ refresh, params: params ?? undefined });
    } catch (err) {
      if (!stillWanted()) return;
      shelvesHost.removeAttribute("aria-busy");
      if (showingSnapshot) return; // keep the last Home rather than replace it with an error
      const message = err instanceof CatalogError ? err.message : "Something went wrong loading Home.";
      const canRetry = !(err instanceof CatalogError && err.reason === "unavailable");
      shelvesHost.replaceChildren(
        el("div", {
          className: "home__notice",
          children: [
            el("p", { className: "home__hint", text: message }),
            ...(canRetry
              ? [el("button", { className: "btn btn--secondary", text: "Try again", attrs: { type: "button" }, onClick: () => load(true) })]
              : []),
          ],
        }),
      );
      return;
    }
    if (!stillWanted()) return;
    if (page !== snapshot) showPage(page);

    try {
      while (page.more) {
        const more = await catalog.getMoreHome(page);
        if (!stillWanted() || more.length === 0) break;
        shelvesHost.append(...renderShelves(more, ""));
        markPlaying(playerEngine.currentTrack);
      }
    } catch {
      // The shelves already shown are enough; the rest can come with the next refresh.
    } finally {
      if (shelvesHost.isConnected) shelvesHost.removeAttribute("aria-busy");
    }
  };
  load();
}
