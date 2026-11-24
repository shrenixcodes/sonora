import { el } from "@/lib/dom";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import type { Track } from "@/types/music";

/** Chooses a Sonora playlist; account playlists are read-only in the current client. */
export function showPlaylistPicker(track: Track): void {
  document.querySelector<HTMLDialogElement>(".playlist-picker")?.close();
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const status = el("p", { className: "playlist-picker__status", attrs: { role: "status", "aria-live": "polite" } });
  const playlists = storage.getPlaylists();
  const entries = playlists.map((playlist) => {
    const added = playlist.tracks.some((item) => item.id === track.id);
    const entry = el("button", {
      className: "playlist-picker__item",
      attrs: { type: "button", ...(added ? { disabled: "" } : {}) },
      children: [el("span", { className: "truncate", text: playlist.title }), el("span", { className: "playlist-picker__detail", text: added ? "Already added" : `${playlist.tracks.length} songs` })],
      onClick: () => {
        const result = storage.addTrackToPlaylist(playlist.id, track);
        if (result === "added") {
          status.textContent = `Added to ${playlist.title}`;
          entry.setAttribute("disabled", "");
          entry.lastElementChild!.textContent = "Added";
        } else {
          status.textContent = result === "duplicate" ? "This song is already in that playlist." : "Could not update the playlist. Try again.";
        }
      },
    });
    return entry;
  });
  const done = el("button", { className: "btn btn--secondary", text: "Done", attrs: { type: "button" }, onClick: () => dialog.close() });
  const create = el("button", { className: "btn btn--primary", text: "Create a playlist", attrs: { type: "button" }, onClick: () => { dialog.close(); router.navigate("/playlists"); } });
  const dialog = el("dialog", {
    className: "playlist-picker",
    attrs: { "aria-labelledby": "playlist-picker-title" },
    children: [
      el("h2", { className: "playlist-picker__title", text: "Add to Playlist", attrs: { id: "playlist-picker-title" } }),
      el("p", { className: "playlist-picker__subtitle", text: track.title }),
      ...(entries.length ? [el("div", { className: "playlist-picker__list", children: entries })] : [el("p", { className: "playlist-picker__empty", text: "Create a Sonora playlist first." })]),
      status,
      el("div", { className: "playlist-picker__actions", children: entries.length ? [done] : [create, done] }),
    ],
  }) as HTMLDialogElement;
  dialog.addEventListener("close", () => { dialog.remove(); previouslyFocused?.focus(); });
  document.body.appendChild(dialog);
  dialog.showModal();
  (entries.find((entry) => !entry.hasAttribute("disabled")) ?? done).focus();
}
