import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTitlebar } from "../src/components/titlebar";
import { router } from "../src/lib/router";
import { searchQuery } from "../src/lib/search-query";

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe("Titlebar controls", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    searchQuery.set("");
  });

  it("toggles Back and Forward disabled states as router history changes", async () => {
    const view = document.createElement("div");
    window.history.replaceState(null, "", "#/home");
    router.route("/home", vi.fn());
    router.route("/library", vi.fn());
    router.start(view);

    const titlebar = createTitlebar();
    document.body.appendChild(titlebar);

    const backBtn = titlebar.querySelector('[aria-label="Go back"]') as HTMLButtonElement;
    const forwardBtn = titlebar.querySelector('[aria-label="Go forward"]') as HTMLButtonElement;
    expect(backBtn.disabled).toBe(true);
    expect(forwardBtn.disabled).toBe(true);

    router.navigate("/library");
    await tick();
    expect(backBtn.disabled).toBe(false);
    expect(forwardBtn.disabled).toBe(true);

    backBtn.click();
    await tick();
    expect(router.current).toBe("/home");
    expect(backBtn.disabled).toBe(true);
    expect(forwardBtn.disabled).toBe(false);

    forwardBtn.click();
    await tick();
    expect(router.current).toBe("/library");
    expect(backBtn.disabled).toBe(false);
    expect(forwardBtn.disabled).toBe(true);
  });

  it("shows the search clear button only when text is present and clears on click", () => {
    const titlebar = createTitlebar();
    document.body.appendChild(titlebar);

    const searchBox = titlebar.querySelector(".titlebar__search") as HTMLElement;
    const input = titlebar.querySelector(".titlebar__search-input") as HTMLInputElement;
    const clearBtn = titlebar.querySelector(".titlebar__search-clear") as HTMLButtonElement;

    expect(clearBtn.hidden).toBe(true);
    expect(searchBox.classList.contains("titlebar__search--has-value")).toBe(false);

    input.value = "ambient";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(clearBtn.hidden).toBe(false);
    expect(searchBox.classList.contains("titlebar__search--has-value")).toBe(true);
    expect(searchQuery.value).toBe("ambient");

    clearBtn.click();
    expect(input.value).toBe("");
    expect(searchQuery.value).toBe("");
    expect(clearBtn.hidden).toBe(true);
    expect(searchBox.classList.contains("titlebar__search--has-value")).toBe(false);
    expect(document.activeElement).toBe(input);

    searchQuery.set("jazz");
    expect(clearBtn.hidden).toBe(false);
    expect(input.value).toBe("jazz");
  });
});
