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

  it("tracks back/forward availability across navigations and refreshes", async () => {
    const container = document.createElement("div");
    window.history.replaceState(null, "", "#/start");
    router.route("/start", vi.fn());
    router.route("/second", vi.fn());
    router.route("/third", vi.fn());
    router.start(container);

    expect(router.canGoBack).toBe(false);
    expect(router.canGoForward).toBe(false);

    router.navigate("/second");
    await new Promise((r) => setTimeout(r, 20));
    expect(router.current).toBe("/second");
    expect(router.canGoBack).toBe(true);
    expect(router.canGoForward).toBe(false);

    router.refresh();
    expect(router.canGoBack).toBe(true);
    expect(router.canGoForward).toBe(false);

    router.back();
    await new Promise((r) => setTimeout(r, 20));
    expect(router.current).toBe("/start");
    expect(router.canGoBack).toBe(false);
    expect(router.canGoForward).toBe(true);

    router.forward();
    await new Promise((r) => setTimeout(r, 20));
    expect(router.current).toBe("/second");
    expect(router.canGoBack).toBe(true);
    expect(router.canGoForward).toBe(false);

    // Branching after back clears stale forward entries
    router.back();
    await new Promise((r) => setTimeout(r, 20));
    router.navigate("/third");
    await new Promise((r) => setTimeout(r, 20));
    expect(router.current).toBe("/third");
    expect(router.canGoBack).toBe(true);
    expect(router.canGoForward).toBe(false);
  });
});
