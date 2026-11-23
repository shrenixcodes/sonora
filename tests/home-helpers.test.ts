import { describe, it, expect } from "vitest";
import { greetingFor } from "../src/lib/greeting";
import { dedupeById } from "../src/lib/tracks";
import { formatTime } from "../src/lib/dom";
import type { Track } from "../src/types/music";

const at = (hour: number) => new Date(2026, 0, 1, hour, 30);

describe("greetingFor", () => {
  it("follows the time of day", () => {
    expect(greetingFor(at(8))).toBe("Good morning");
    expect(greetingFor(at(14))).toBe("Good afternoon");
    expect(greetingFor(at(21))).toBe("Good evening");
  });

  it("does not say good morning in the middle of the night", () => {
    expect(greetingFor(at(2))).toBe("Good evening");
  });
});

describe("dedupeById", () => {
  const track = (id: string, title = id): Track => ({
    id,
    title,
    artist: "Artist",
    duration: 200,
    artworkUrl: "",
  });

  it("keeps only the most recent play of each track", () => {
    const history = [track("a", "latest a"), track("b"), track("a", "older a"), track("c")];

    expect(dedupeById(history).map((t) => t.title)).toEqual(["latest a", "b", "c"]);
  });
});

describe("formatTime", () => {
  it("formats standard minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(45)).toBe("0:45");
    expect(formatTime(125)).toBe("2:05");
  });

  it("formats hours, minutes, and seconds when >= 1 hour", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3665)).toBe("1:01:05");
    expect(formatTime(7325)).toBe("2:02:05");
  });

  it("guards against negative and non-finite seconds", () => {
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });
});
