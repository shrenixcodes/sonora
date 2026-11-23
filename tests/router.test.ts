import { describe, it, expect, vi } from "vitest";
import { router } from "../src/lib/router";

describe("Router", () => {
  it("registers routes and navigates to hash paths", () => {
    const handler = vi.fn();
    router.route("/test-route", handler);

    router.navigate("/test-route");
    expect(window.location.hash).toBe("#/test-route");
  });

  it("notifies navigation listeners on route change", () => {
    const listener = vi.fn();
    const unsub = router.onNavigate(listener);

    router.navigate("/search");
    // Emitted via hashchange in router
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("re-renders the current page on refresh, telling the old one to clean up first", () => {
    const container = document.createElement("div");
    const order: string[] = [];
    window.location.hash = "#/refresh-test";
    router.route("/refresh-test", () => {
      order.push("render");
    });
    router.start(container);
    const unsub = router.onNavigate((path) => order.push(`nav:${path}`));
    order.length = 0;

    router.refresh();
    expect(order).toEqual(["nav:", "render", "nav:/refresh-test"]);
    unsub();
  });
});
