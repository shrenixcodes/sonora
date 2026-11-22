import { describe, it, expect, vi } from "vitest";
import { AccountStatus } from "../src/lib/ytm/account";

describe("AccountStatus", () => {
  it("starts unknown and reports only real changes", () => {
    const status = new AccountStatus(null);
    const onChange = vi.fn();
    status.on("change", onChange);

    expect(status.isSignedIn).toBeNull();
    status.update(false);
    status.update(false);
    status.update(true);

    expect(onChange.mock.calls).toEqual([[false], [true]]);
    expect(status.isSignedIn).toBe(true);
  });
});
