import { describe, it, expect, vi } from "vitest";
import { Catalog } from "../src/lib/ytm/catalog";
import { CatalogError, type CatalogRequest } from "../src/lib/ytm/client";

const emptyHome = { contents: {} };

describe("Catalog", () => {
  it("serves Home from its short cache and refetches on request", async () => {
    let time = 0;
    const fetcher = vi.fn(async () => emptyHome);
    const catalog = new Catalog(fetcher, () => time);

    await catalog.getHome();
    time = 60_000;
    await catalog.getHome();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await catalog.getHome({ refresh: true });
    time = 10 * 60_000;
    await catalog.getHome();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("shares one call between identical requests in flight", async () => {
    let release!: (v: unknown) => void;
    const fetcher = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const catalog = new Catalog(fetcher);

    const a = catalog.searchSongs("lofi");
    const b = catalog.searchSongs("  lofi ");
    release({});
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("waits for the YouTube Music page to finish loading", async () => {
    const fetcher = vi
      .fn<(r: CatalogRequest, timeoutMs: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new CatalogError("starting", "not-ready"))
      .mockRejectedValueOnce(new CatalogError("starting", "not-ready"))
      .mockResolvedValue({});
    const sleep = vi.fn(async () => {});
    const catalog = new Catalog(fetcher, Date.now, sleep);

    await expect(catalog.searchSongs("jazz")).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries a request lost while the page reloads", async () => {
    const fetcher = vi
      .fn<(r: CatalogRequest, timeoutMs: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new CatalogError("slow", "timeout"))
      .mockResolvedValue({});
    const catalog = new Catalog(fetcher, Date.now, async () => {});

    await expect(catalog.getHome()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toBeLessThan(15_000);
  });

  it("gives up after a bounded number of attempts", async () => {
    const fetcher = vi.fn(async () => {
      throw new CatalogError("slow", "timeout");
    });
    const catalog = new Catalog(fetcher, Date.now, async () => {});

    await expect(catalog.getHome()).rejects.toMatchObject({ reason: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("passes other failures straight through", async () => {
    const fetcher = vi.fn(async () => {
      throw new CatalogError("refused", "http-403");
    });
    const catalog = new Catalog(fetcher, Date.now, async () => {});

    await expect(catalog.getHome()).rejects.toMatchObject({ reason: "http-403" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not search for blank text", async () => {
    const fetcher = vi.fn();
    await expect(new Catalog(fetcher).searchSongs("   ")).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
