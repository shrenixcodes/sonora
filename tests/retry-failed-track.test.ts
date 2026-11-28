import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Track } from "../src/types/music";
import type { YtmCommand } from "../src/lib/playback/ytm-bridge";
import { createPlayer } from "../src/components/player";
import { PlaybackEngine, playerEngine } from "../src/lib/playback/engine";

const track = (id: string): Track => ({ id, title: `Song ${id}`, artist: "Artist", duration: 200, artworkUrl: "" });
const song = track("aaaaaaaaaaa");

/** An engine whose first load is refused by the bridge. */
function failingOnce() {
  const sent: YtmCommand[] = [];
  let refused = false;
  const engine = new PlaybackEngine({
    available: true,
    control: vi.fn(async (command: YtmCommand) => {
      sent.push(command);
      if (command.action === "load" && !refused) {
        refused = true;
        throw new Error("no answer");
      }
    }),
    onState: vi.fn(async () => () => {}),
  });
  return { engine, sent };
}

describe("retrying a track that failed to load", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("reloads the song when Play is pressed after the error", async () => {
    const { engine, sent } = failingOnce();
    engine.playTrack(song, [song]);
    await vi.waitFor(() => expect(engine.currentState.status).toBe("error"));
    expect(engine.currentState.error).toBe("YouTube Music did not respond.");
    expect(engine.canRetry).toBe(true);

    sent.length = 0;
    engine.togglePlay();
    expect(sent).toEqual([{ action: "load", value: "aaaaaaaaaaa" }]);
    expect(engine.currentState.status).toBe("loading");
    expect(engine.currentState.error).toBeUndefined();
  });

  it("does not offer a retry where playback cannot work at all", () => {
    const engine = new PlaybackEngine({ available: false, control: vi.fn(), onState: vi.fn() });
    engine.playTrack(song, [song]);
    expect(engine.currentState.status).toBe("error");
    expect(engine.canRetry).toBe(false);
  });

  it("shows a Try again link on the player that loads the song again", () => {
    const player = createPlayer();
    document.body.appendChild(player);
    vi.spyOn(playerEngine, "canRetry", "get").mockReturnValue(true);
    const retry = vi.spyOn(playerEngine, "retry").mockImplementation(() => {});

    playerEngine.emit("trackChange", song);
    playerEngine.emit("stateChange", {
      ...playerEngine.currentState,
      currentTrack: song,
      status: "error",
      error: "YouTube Music did not respond.",
    });

    const line = player.querySelector<HTMLButtonElement>(".player__artist")!;
    expect(line.disabled).toBe(false);
    expect(line.querySelector(".player__retry")?.textContent).toBe("Try again");
    expect(line.textContent).toBe("Try again · YouTube Music did not respond.");
    expect(line.getAttribute("aria-label")).toBe("YouTube Music did not respond. Try again");

    line.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
