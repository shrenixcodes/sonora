import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { startSongRadio } from "@/lib/playback/song-radio";
import type { Track } from "@/types/music";

let statusTimer: number | undefined;
function announce(message: string): void {
  let status = document.querySelector<HTMLElement>(".song-radio-status");
  if (!status) {
    status = el("div", { className: "song-radio-status", attrs: { role: "status", "aria-live": "polite" } });
    document.body.appendChild(status);
  }
  status.textContent = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => status?.remove(), 4000);
}

export async function launchSongRadio(track: Track): Promise<void> {
  announce("Starting song radio...");
  try {
    const result = await startSongRadio(track);
    if (result.status === "queued") announce(`Radio ready: ${result.count} songs queued`);
    else if (result.status === "empty") announce("No radio recommendations available for this song.");
  } catch {
    announce("Could not load song radio. Try again.");
  }
}

export function createSongRadioButton(track: Track): HTMLButtonElement {
  const button = el("button", {
    className: "song-radio-btn",
    html: icon("radio"),
    attrs: { type: "button", "aria-label": `Start song radio for ${track.title}`, title: "Start song radio" },
    onClick: (event) => { event.stopPropagation(); void launchSongRadio(track); },
  });
  button.addEventListener("keydown", (event) => event.stopPropagation());
  return button;
}
