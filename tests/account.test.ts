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

  it("loads the profile when signed in and clears it on sign-out", async () => {
    const profile = { name: "Alex", handle: "@alex", photoUrl: "https://lh3.googleusercontent.com/a=s176" };
    const status = new AccountStatus(null, async () => profile);
    const onProfile = vi.fn();
    status.on("profile", onProfile);

    status.update(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(status.profile).toEqual(profile);

    status.update(false);
    expect(status.profile).toBeNull();
    expect(onProfile.mock.calls).toEqual([[profile], [null]]);
  });

  it("confirms only sign-ins started from Sonora", () => {
    const status = new AccountStatus(null);
    const onComplete = vi.fn();
    status.on("signInComplete", onComplete);

    status.update(false);
    status.update(true);
    expect(onComplete).not.toHaveBeenCalled();

    status.update(false);
    status.beginSignIn();
    status.update(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
