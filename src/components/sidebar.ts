/**
 * Sidebar navigation.
 *
 * Primary navigation component with sections for main routes,
 * library access, and playlist listing.
 */

import { el } from "@/lib/dom";
import { icon, type IconName } from "@/icons";
import { router } from "@/lib/router";
import { showAboutPopup } from "@/components/about-popup";

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

  const sidebar = el("aside", {
    className: "sidebar",
    children: [
      brand,
      createNavSection(null, mainNav),
      createNavSection("Library", libraryNav),
      el("div", { className: "sidebar__playlists" }), // future: playlist list
      createNavSection(null, bottomNav),
    ],
  });

  // Track active route
  function updateActive(path: string): void {
    const links = sidebar.querySelectorAll<HTMLElement>(".sidebar__link");
    links.forEach((link) => {
      const linkPath = link.dataset.path;
      link.classList.toggle("sidebar__link--active", linkPath === path);
    });
  }

  router.onNavigate(updateActive);

  // Set initial active state after a tick (router hasn't started yet)
  requestAnimationFrame(() => {
    const hash = window.location.hash.slice(1) || "/";
    updateActive(hash);
  });

  return sidebar;
}
