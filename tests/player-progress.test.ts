import { describe, it, expect } from "vitest";
import { createPlayer } from "../src/components/player";
import { playerEngine } from "../src/lib/playback/engine";

describe("player progress", () => {
  it("redraws once per second of playback, not on every engine tick", () => {
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    const player = createPlayer();
    document.body.appendChild(player);
    const label = player.querySelectorAll<HTMLElement>(".player__time")[0];

    playerEngine.emit("timeUpdate", { currentTime: 10.1, duration: 200 });
    expect(label.textContent).toBe("0:10");

    // A marker the in-between ticks would overwrite if they still drew.
    label.textContent = "untouched";
    playerEngine.emit("timeUpdate", { currentTime: 10.35, duration: 200 });
    playerEngine.emit("timeUpdate", { currentTime: 10.6, duration: 200 });
    expect(label.textContent).toBe("untouched");

    playerEngine.emit("timeUpdate", { currentTime: 11.02, duration: 200 });
    expect(label.textContent).toBe("0:11");

    // A new duration (another track) draws even within the same second.
    label.textContent = "untouched";
    playerEngine.emit("timeUpdate", { currentTime: 11.5, duration: 180 });
    expect(label.textContent).toBe("0:11");
    player.remove();
  });
});
