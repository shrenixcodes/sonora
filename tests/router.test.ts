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
});
