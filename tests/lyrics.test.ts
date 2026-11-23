import { describe, it, expect, vi } from "vitest";
import { parseLrc, LyricsController } from "../src/lib/lyrics/synced-lyrics";

describe("parseLrc", () => {
  it("parses standard minute:second.hundredths timestamps", () => {
    const lrc = `
      [00:12.50]First line of lyrics
      [00:15.00]Second line of lyrics
      [01:02.12]One minute line
    `;

    const parsed = parseLrc(lrc, "test-track-1");
    expect(parsed.isSynced).toBe(true);
    expect(parsed.lines).toHaveLength(3);

    expect(parsed.lines[0]).toEqual({
      timeMs: 12500,
      text: "First line of lyrics",
    });

    expect(parsed.lines[1]).toEqual({
      timeMs: 15000,
      text: "Second line of lyrics",
    });

    expect(parsed.lines[2]).toEqual({
      timeMs: 62120,
      text: "One minute line",
    });
  });

  it("parses multiple timestamps per line and sorts chronologically", () => {
    const lrc = `
      [00:20.00][00:10.00]Repeated chorus line
    `;

    const parsed = parseLrc(lrc);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].timeMs).toBe(10000);
    expect(parsed.lines[1].timeMs).toBe(20000);
  });

  it("handles empty or invalid LRC strings gracefully", () => {
    const parsed = parseLrc("");
    expect(parsed.isSynced).toBe(false);
    expect(parsed.lines).toHaveLength(0);
  });
});

describe("LyricsController auto-scroll lock", () => {
  it("shows scroll lock indicator on user wheel and resumes after clicking indicator", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const controller = new LyricsController();
    controller.bindContainer(container);

    const lrc = "[00:01.00]Line 1\n[00:05.00]Line 2\n[00:10.00]Line 3";
    controller.setLyrics(parseLrc(lrc));

    controller.updateTime(1);
    expect(container.querySelector(".lyrics__line--active")?.textContent).toBe("Line 1");

    // Simulate user scroll
    container.dispatchEvent(new Event("wheel"));
    const indicator = container.querySelector(".lyrics__scroll-lock") as HTMLButtonElement | null;
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Sync to lyrics");

    // Clicking indicator resumes auto-scroll
    indicator?.click();
    expect(container.querySelector(".lyrics__scroll-lock")).toBeNull();

    controller.destroy();
    vi.useRealTimers();
  });

  it("automatically resumes auto-scroll after 5 seconds of inactivity", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const controller = new LyricsController();
    controller.bindContainer(container);

    const lrc = "[00:01.00]Line 1\n[00:05.00]Line 2";
    controller.setLyrics(parseLrc(lrc));

    container.dispatchEvent(new Event("wheel"));
    expect(container.querySelector(".lyrics__scroll-lock")).not.toBeNull();

    // Advance 4999ms -> still locked
    vi.advanceTimersByTime(4999);
    expect(container.querySelector(".lyrics__scroll-lock")).not.toBeNull();

    // Advance 1ms -> 5000ms reached -> unlocked
    vi.advanceTimersByTime(1);
    expect(container.querySelector(".lyrics__scroll-lock")).toBeNull();

    controller.destroy();
    vi.useRealTimers();
  });
});
