import { describe, it, expect } from "vitest";
import { parseLrc } from "../src/lib/lyrics/synced-lyrics";

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
