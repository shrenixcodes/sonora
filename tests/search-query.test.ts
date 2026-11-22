import { describe, it, expect, vi } from "vitest";
import { searchQuery } from "../src/lib/search-query";

describe("searchQuery", () => {
  it("notifies listeners only when the query actually changes", () => {
    const onChange = vi.fn();
    const off = searchQuery.on("change", onChange);

    searchQuery.set("lofi");
    searchQuery.set("lofi");
    searchQuery.set("jazz");

    expect(onChange.mock.calls).toEqual([["lofi"], ["jazz"]]);
    expect(searchQuery.value).toBe("jazz");
    off();
    searchQuery.set("");
  });

  it("forwards focus requests to the search field", () => {
    const onFocus = vi.fn();
    const off = searchQuery.on("focusRequest", onFocus);

    searchQuery.requestFocus();

    expect(onFocus).toHaveBeenCalledTimes(1);
    off();
  });
});
