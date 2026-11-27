/**
 * Sidebar navigation.
 *
 * Primary navigation component with sections for main routes,
 * library access, and playlist listing.
 */

import { el } from "@/lib/dom";
import { icon, type IconName } from "@/icons";
import { openCollection } from "@/lib/navigation";
import { router } from "@/lib/router";
import { storage } from "@/lib/storage";
import { account } from "@/lib/ytm/account";
import { catalog, type LibraryPlaylist } from "@/lib/ytm/catalog";
import { catalogAvailable } from "@/lib/ytm/client";
import { showAboutPopup } from "@/components/about-popup";
import { shouldReduceMotion } from "@/lib/visuals/motion";

interface NavItem {
  label: string;
  icon: IconName;
  path: string;
}

const mainNav: NavItem[] = [
  { label: "Home", icon: "home", path: "/" },
  { label: "Explore", icon: "explore", path: "/explore" },
  { label: "Search", icon: "search", path: "/search" },
];

const libraryNav: NavItem[] = [
  { label: "Liked Music", icon: "heart", path: "/liked" },
  { label: "Playlists", icon: "playlist", path: "/playlists" },
  { label: "Albums", icon: "album", path: "/albums" },
  { label: "Artists", icon: "artist", path: "/artists" },
  { label: "History", icon: "history", path: "/history" },
];

const bottomNav: NavItem[] = [
  { label: "Settings", icon: "settings", path: "/settings" },
];

function createNavLink(item: NavItem): HTMLElement {
  const link = el("a", {
    className: "sidebar__link",
    // title gives the icon-only floating rail a tooltip
    attrs: { href: `#${item.path}`, "data-path": item.path, title: item.label },
    children: [
      el("span", { className: "sidebar__link-icon", html: icon(item.icon) }),
      el("span", { className: "sidebar__link-label", text: item.label }),
    ],
  });

  link.addEventListener("click", (e) => {
    e.preventDefault();
    router.navigate(item.path);
  });

  return link;
}

function createNavSection(label: string | null, items: NavItem[]): HTMLElement {
  const children: HTMLElement[] = [];

  if (label) {
    children.push(el("div", { className: "sidebar__label", text: label }));
  }

  const nav = el("nav", {
    className: "sidebar__nav",
    children: items.map(createNavLink),
  });
  children.push(nav);

  return el("div", { className: "sidebar__section", children });
}

export function createSidebar(): HTMLElement {
  const brand = el("button", {
    className: "sidebar__brand",
    attrs: { type: "button", title: "About Sonora", "aria-label": "About Sonora" },
    children: [
      el("span", { className: "sidebar__brand-icon", html: icon("sonoraLogo") }),
    ],
  });
  brand.addEventListener("click", (e) => {
    e.preventDefault();
    void showAboutPopup();
  });

  const playlistsHost = el("div", { className: "sidebar__playlists" });

  const sidebar = el("aside", {
    className: "sidebar",
    children: [
      brand,
      createNavSection(null, mainNav),
      createNavSection("Library", libraryNav),
      playlistsHost,
      createNavSection(null, bottomNav),
    ],
  });

  // Single-tap rubberband jiggle when pressing any sidebar control (never on scroll).
  const triggerJiggle = (): void => {
    if (shouldReduceMotion()) return;
    if (sidebar.classList.contains("sidebar--jiggle")) {
      const anims = typeof sidebar.getAnimations === "function" ? sidebar.getAnimations() : [];
      if (anims.length > 0) {
        for (const anim of anims) {
          anim.currentTime = 0;
          anim.play();
        }
        return;
      }
      sidebar.classList.remove("sidebar--jiggle");
      requestAnimationFrame(() => sidebar.classList.add("sidebar--jiggle"));
      return;
    }
    sidebar.classList.add("sidebar--jiggle");
  };

  sidebar.addEventListener("click", (e) => {
    const target = e.target;
    if (target instanceof Element && target.closest(".sidebar__brand, .sidebar__link, .sidebar__playlist-item, button")) {
      triggerJiggle();
    }
  });
  sidebar.addEventListener("animationend", (e) => {
    if (e.target === sidebar && e.animationName === "sidebarTapJiggle") {
      sidebar.classList.remove("sidebar--jiggle");
    }
  });

  let ytmPlaylists: LibraryPlaylist[] = [];
  let activePath = window.location.hash.slice(1) || "/";

  const createPlaylistLink = (opts: {
    source: "local" | "ytm";
    id: string;
    title: string;
    artworkUrl: string;
    onOpen: () => void;
  }): HTMLElement => {
    const link = el("a", {
      className: "sidebar__playlist-item",
      attrs: {
        href: `#/playlist?source=${encodeURIComponent(opts.source)}&id=${encodeURIComponent(opts.id)}`,
        "data-playlist-source": opts.source,
        "data-playlist-id": opts.id,
        title: opts.title,
      },
      children: [
        el("img", {
          className: "sidebar__playlist-art",
          attrs: { src: opts.artworkUrl || "/artwork-placeholder.svg", alt: "", loading: "lazy" },
        }),
        el("span", { className: "sidebar__playlist-title truncate", text: opts.title }),
      ],
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      opts.onOpen();
    });
    return link;
  };

  const renderPlaylists = () => {
    const local = storage.getPlaylists();
    const items: HTMLElement[] = [
      ...local.map((pl) =>
        createPlaylistLink({
          source: "local",
          id: pl.id,
          title: pl.title,
          artworkUrl: pl.tracks[0]?.artworkUrl || pl.artworkUrl || "/artwork-placeholder.svg",
          onOpen: () => openCollection({ source: "local", id: pl.id }),
        }),
      ),
      ...ytmPlaylists.map((pl) =>
        createPlaylistLink({
          source: "ytm",
          id: pl.id,
          title: pl.title,
          artworkUrl: pl.artworkUrl || "/artwork-placeholder.svg",
          onOpen: () =>
            openCollection({
              source: "ytm",
              id: pl.id,
              kind: "playlist",
              title: pl.title,
              subtitle: pl.subtitle,
              artworkUrl: pl.artworkUrl,
            }),
        }),
      ),
    ];

    if (items.length === 0) {
      playlistsHost.replaceChildren();
      return;
    }

    playlistsHost.replaceChildren(
      el("div", { className: "sidebar__label", text: "Playlists" }),
      el("nav", { className: "sidebar__nav", attrs: { "aria-label": "Playlists" }, children: items }),
    );
    updateActive(activePath);
  };

  // Track active route
  function updateActive(path: string): void {
    activePath = path || activePath;
    const links = sidebar.querySelectorAll<HTMLElement>(".sidebar__link");
    links.forEach((link) => {
      const linkPath = link.dataset.path;
      link.classList.toggle("sidebar__link--active", linkPath === path);
    });

    const queryIdx = path.indexOf("?");
    const pathname = queryIdx === -1 ? path : path.slice(0, queryIdx);
    const params = queryIdx === -1 ? null : new URLSearchParams(path.slice(queryIdx + 1));
    const currentSource = pathname === "/playlist" ? params?.get("source") : null;
    const currentId = pathname === "/playlist" ? params?.get("id") : null;

    sidebar.querySelectorAll<HTMLElement>(".sidebar__playlist-item").forEach((item) => {
      const isActive =
        Boolean(currentId) &&
        item.dataset.playlistSource === currentSource &&
        item.dataset.playlistId === currentId;
      item.classList.toggle("sidebar__playlist-item--active", isActive);
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  let wasConnected = false;
  const checkCleanup = (): boolean => {
    if (sidebar.isConnected) {
      wasConnected = true;
      return false;
    }
    if (!wasConnected) return false;
    stopNav();
    stopPlaylists();
    stopAccount();
    return true;
  };

  const refreshYtmPlaylists = () => {
    if (!catalogAvailable() || account.isSignedIn !== true) {
      ytmPlaylists = [];
      renderPlaylists();
      return;
    }
    void catalog
      .getLibraryPlaylists()
      .then((list) => {
        if (checkCleanup()) return;
        ytmPlaylists = list;
        renderPlaylists();
      })
      .catch(() => {});
  };

  const stopNav = router.onNavigate((path) => {
    if (checkCleanup()) return;
    updateActive(path);
  });
  const stopPlaylists = storage.on("playlistChange", () => {
    if (checkCleanup()) return;
    renderPlaylists();
  });
  const stopAccount = account.on("change", () => {
    if (checkCleanup()) return;
    refreshYtmPlaylists();
  });

  renderPlaylists();
  refreshYtmPlaylists();

  // Set initial active state after a tick (router hasn't started yet)
  requestAnimationFrame(() => {
    const hash = window.location.hash.slice(1) || "/";
    updateActive(hash);
  });

  return sidebar;
}
