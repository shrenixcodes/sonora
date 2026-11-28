import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Track } from "../src/types/music";
import type { YtmCommand } from "../src/lib/playback/ytm-bridge";
import { createPlayer } from "../src/components/player";
import { PlaybackEngine, playerEngine } from "../src/lib/playback/engine";
import { storage } from "../src/lib/storage";

const track = (id: string): Track => ({ id, title: `Song ${id}`, artist: "Artist", duration: 200, artworkUrl: "" });

function engineWithBridge() {
  const sent: YtmCommand[] = [];
  const engine = new PlaybackEngine({
    available: true,
    control: vi.fn(async (command: YtmCommand) => {
      sent.push(command);
    }),
    onState: vi.fn(async () => () => {}),
  });
  return { engine, sent };
}

describe("end of queue feedback", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the end of the queue when Next has nothing left and autoplay is off", () => {
    storage.saveSettings({ autoPlayNext: false });
    const { engine, sent } = engineWithBridge();
    const onEnd = vi.fn();
    engine.on("queueEnd", onEnd);

    engine.playTrack(track("aaaaaaaaaaa"), [track("aaaaaaaaaaa")]);
    const before = sent.length;
    engine.next();

    expect(onEnd).toHaveBeenCalledWith({ autoplay: false });
    expect(sent.slice(before)).toEqual([]);
  });

  it("hands over to autoplay instead of reporting the end when autoplay is on", () => {
    storage.saveSettings({ autoPlayNext: true });
    const { engine, sent } = engineWithBridge();
    const onEnd = vi.fn();
    engine.on("queueEnd", onEnd);

    engine.playTrack(track("aaaaaaaaaaa"), [track("aaaaaaaaaaa")]);
    engine.next();

    expect(onEnd).not.toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ action: "next" });
  });

  it("shows a polite hint above the player and hides it again", () => {
    vi.useFakeTimers();
    const player = createPlayer();
    document.body.appendChild(player);
    const hint = player.querySelector<HTMLElement>(".queue-end-hint")!;

    expect(hint.getAttribute("role")).toBe("status");
    expect(hint.classList.contains("is-visible")).toBe(false);

    playerEngine.emit("queueEnd", { autoplay: false });
    expect(hint.classList.contains("is-visible")).toBe(true);
    expect(hint.textContent).toContain("End of queue");
    expect(hint.textContent).toContain("Autoplay is off");

    // Pressing again keeps it up for the full time from the latest press.
    vi.advanceTimersByTime(2000);
    playerEngine.emit("queueEnd", { autoplay: false });
    vi.advanceTimersByTime(2000);
    expect(hint.classList.contains("is-visible")).toBe(true);

    vi.advanceTimersByTime(500);
    expect(hint.classList.contains("is-visible")).toBe(false);
  });
});
