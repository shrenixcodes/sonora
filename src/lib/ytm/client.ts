/**
 * Catalog requests to YouTube Music.
 *
 * The hidden YouTube Music page makes the actual API call (with the user's
 * session) and sends back the raw JSON, which the parsers in parse.ts turn
 * into Sonora's types. Requests are matched to replies by id.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type CatalogRequest =
  | { kind: "home"; params?: string }
  | { kind: "search"; query: string }
  | { kind: "likedSongs" }
  | { kind: "libraryPlaylists" }
  | { kind: "accountInfo" }
  | { kind: "explore" }
  | { kind: "playlist"; id: string }
  | { kind: "watchPlaylist"; id: string }
  | { kind: "continuation"; token: string };

interface CatalogResponse {
  id: number;
  ok: boolean;
  body: string;
}

export class CatalogError extends Error {
  constructor(
    message: string,
    /** Short reason from the page, e.g. "not-ready" or "http-403". */
    readonly reason: string,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

let nextId = 1;
const waiting = new Map<number, { resolve: (json: unknown) => void; reject: (err: Error) => void }>();
let listening: Promise<unknown> | null = null;

function ensureListening(): Promise<unknown> {
  listening ??= listen<CatalogResponse>("ytm://response", ({ payload }) => {
    const entry = waiting.get(payload.id);
    if (!entry) return;
    waiting.delete(payload.id);
    if (!payload.ok) {
      entry.reject(new CatalogError(messageFor(payload.body), payload.body));
      return;
    }
    try {
      entry.resolve(JSON.parse(payload.body));
    } catch {
      entry.reject(new CatalogError("YouTube Music sent something Sonora couldn't read.", "bad-json"));
    }
  });
  return listening;
}

function messageFor(reason: string): string {
  if (reason === "not-ready") return "YouTube Music is still starting. Try again in a moment.";
  if (reason.startsWith("http-")) return "YouTube Music refused the request. Try again later.";
  return "Couldn't reach YouTube Music. Check your connection and try again.";
}

export function catalogAvailable(): boolean {
  return isTauri();
}

export async function requestCatalog(
  request: CatalogRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (!isTauri()) {
    throw new CatalogError("Music from YouTube Music shows up in the Sonora desktop app.", "unavailable");
  }
  await ensureListening();

  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      reject(new CatalogError("YouTube Music took too long to answer. Try again.", "timeout"));
    }, timeoutMs);

    waiting.set(id, {
      resolve: (json) => {
        window.clearTimeout(timer);
        resolve(json);
      },
      reject: (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    });

    invoke("ytm_request", { id, request }).catch((err) => {
      waiting.delete(id);
      window.clearTimeout(timer);
      console.warn("[catalog] could not send request:", err);
      reject(new CatalogError("Couldn't ask YouTube Music for that.", "send-failed"));
    });
  });
}
