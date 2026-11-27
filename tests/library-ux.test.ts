import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderLibrary } from "../src/views/library";
import { account } from "../src/lib/ytm/account";
import { catalog } from "../src/lib/ytm/catalog";
import * as ytmClient from "../src/lib/ytm/client";
import { ytmBridge } from "../src/lib/playback/ytm-bridge";
import { router } from "../src/lib/router";

describe("Library sign-in prompts, read-only labels, and playlist empty state", () => {
  beforeEach(() => {
    localStorage.clear();
    account.update(false);
    window.location.hash = "#/liked";
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders interactive Sign in and Open Settings buttons when signed out in Liked Music and History", async () => {
    vi.spyOn(ytmClient, "catalogAvailable").mockReturnValue(true);
    vi.spyOn(ytmBridge, "available", "get").mockReturnValue(true);
    const setSignInVisible = vi.spyOn(ytmBridge, "setSignInVisible").mockResolvedValue();
    const navigate = vi.spyOn(router, "navigate").mockImplementation(() => {});

    const host = document.createElement("div");
    document.body.appendChild(host);
    renderLibrary(host);

    const signInBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Sign in");
    const settingsBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Open Settings");
    expect(signInBtn).toBeDefined();
    expect(settingsBtn).toBeDefined();

    signInBtn!.click();
    expect(setSignInVisible).toHaveBeenCalledWith(true);

    settingsBtn!.click();
    expect(navigate).toHaveBeenCalledWith("/settings");

    // History view also presents interactive buttons when signed out
    host.replaceChildren();
    window.location.hash = "#/history";
    renderLibrary(host);
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Sign in")).toBe(true);
  });

  it("labels remote history as read-only when YouTube Music history loads", async () => {
    vi.spyOn(ytmClient, "catalogAvailable").mockReturnValue(true);
    account.update(true);
    vi.spyOn(catalog, "getHistory").mockResolvedValue([
      { id: "h1", title: "Remote Track", artist: "Artist", duration: 120, artworkUrl: "" },
    ]);

    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/history";
    renderLibrary(host);

    await vi.waitFor(() => {
      expect(host.textContent).toContain("Remote Track");
    });
    expect(host.textContent).toContain("YouTube Music account history is read-only");
  });

  it("uses a compact hint instead of the empty-state banner when YouTube Music playlists exist", async () => {
    vi.spyOn(ytmClient, "catalogAvailable").mockReturnValue(true);
    account.update(true);
    vi.spyOn(catalog, "getLibraryPlaylists").mockResolvedValue([
      { id: "PL_YTM", title: "Cloud Mix", subtitle: "10 songs", artworkUrl: "" },
    ]);

    const host = document.createElement("div");
    document.body.appendChild(host);
    window.location.hash = "#/playlists";
    renderLibrary(host);

    await vi.waitFor(() => {
      expect(host.textContent).toContain("Cloud Mix");
    });
    expect(host.querySelector(".empty-state")).toBeNull();
    expect(host.textContent).toContain("No local Sonora playlists yet.");

    // When both YouTube Music and local playlists are empty, show the full empty-state block
    host.replaceChildren();
    vi.spyOn(catalog, "getLibraryPlaylists").mockResolvedValue([]);
    renderLibrary(host);

    await vi.waitFor(() => {
      expect(host.querySelector(".empty-state")?.textContent).toContain("No playlists yet");
    });
  });
});
