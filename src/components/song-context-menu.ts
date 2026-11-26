import { el } from "@/lib/dom";
import { showPlaylistPicker } from "@/components/playlist-picker";
import { launchSongRadio } from "@/components/song-radio";
import { icon } from "@/icons";
import { playerEngine } from "@/lib/playback/engine";
import { openAlbum, openArtist } from "@/lib/navigation";
import type { Track } from "@/types/music";

let closeMenu: (() => void) | null = null;

async function copyLink(url: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // WebView2 may not expose the async clipboard in its local origin.
    }
  }
  const input = document.createElement("textarea");
  input.value = url;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand?.("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
  }
}

/** Adds song actions without changing the element's normal play behavior. */
export function attachSongContextMenu(element: HTMLElement, track: Track): void {
  const open = (x: number, y: number) => {
    closeMenu?.();
    const menu = el("div", {
      className: "song-context-menu",
      attrs: { role: "menu", "aria-label": `Actions for ${track.title}` },
    });
    let dismiss: () => void;
    const action = (label: string, glyph: Parameters<typeof icon>[0], run: () => void, disabled = false, title = label, closeOnClick = true) => {
      const button = el("button", {
        className: "song-context-menu__item",
        attrs: { type: "button", role: "menuitem", title, ...(disabled ? { disabled: "" } : {}) },
        children: [el("span", { className: "song-context-menu__icon", html: icon(glyph), attrs: { "aria-hidden": "true" } }), el("span", { text: label })],
        onClick: () => { if (closeOnClick) dismiss(); run(); },
      });
      menu.appendChild(button);
      return button;
    };
    const queue = (next: boolean) => {
      if (!playerEngine.currentTrack) void playerEngine.playTrack(track);
      else if (next) playerEngine.playNext(track);
      else playerEngine.addToQueue(track);
    };
    action("Play Next", "skipForward", () => queue(true));
    action("Add to Queue", "queue", () => queue(false));
    action("Add to Playlist", "playlist", () => showPlaylistPicker(track));
    action("Start Song Radio", "radio", () => { void launchSongRadio(track); });
    const artistName = track.artist?.trim();
    action("Go to Artist", "artist", () => {
      if (artistName) openArtist({ id: track.artistId, name: artistName });
    }, !artistName, artistName ? `Open artist: ${artistName}` : "Artist information is unavailable");
    const albumTitle = track.album?.trim();
    action("Go to Album", "album", () => {
      if (albumTitle) {
        openAlbum({
          id: track.albumId,
          title: albumTitle,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
        });
      }
    }, !albumTitle, albumTitle ? `Open album: ${albumTitle}` : "Album information is unavailable");
    const copyButton = action("Copy Link", "link", async () => {
      try {
        await copyLink(`https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`);
        dismiss();
      } catch {
        if (!menu.isConnected) return;
        copyButton.lastElementChild!.textContent = "Could not copy link";
        copyButton.focus();
      }
    }, false, "Copy song link", false);
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) dismiss(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); element.focus(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
        (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    dismiss = () => {
      menu.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("hashchange", dismiss);
      document.removeEventListener("scroll", dismiss, true);
      if (closeMenu === dismiss) closeMenu = null;
    };
    closeMenu = dismiss;
    menu.addEventListener("keydown", (event) => event.stopPropagation());
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("hashchange", dismiss);
    document.addEventListener("scroll", dismiss, true);
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    open(keyboard ? rect.left : event.clientX, keyboard ? rect.bottom : event.clientY);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    open(rect.left, rect.bottom);
  });
}
