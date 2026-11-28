import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(import.meta.dirname, "../src/styles/main.css"), "utf8");
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`))![1];

describe("horizontal shelves", () => {
  it("leave room on every side for a card's hover fill, which a scroller would clip", () => {
    // Cards reach past their track by the negative margin; the shelf must pad at least that much.
    expect(rule(".shelf-card")).toMatch(/margin: calc\(var\(--space-2\) \* -1\);/);
    const shelf = rule(".shelf");
    expect(shelf).toMatch(/overflow-x: auto;/);
    expect(shelf).toMatch(/\n\s*padding: var\(--space-2\);/);
    expect(shelf).not.toMatch(/padding-(top|block|inline|bottom)/);
  });
});
