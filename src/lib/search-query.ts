/**
 * Shared search query.
 *
 * The titlebar search field owns the text; the search view listens and renders
 * results. Kept separate so neither component depends on the other.
 */

import { EventEmitter } from "@/lib/events";

interface SearchQueryEvents {
  change: string;
  focusRequest: void;
}

class SearchQuery extends EventEmitter<SearchQueryEvents> {
  private current = "";

  get value(): string {
    return this.current;
  }

  set(query: string): void {
    if (query === this.current) return;
    this.current = query;
    this.emit("change", query);
  }

  /** Asks the search field to take keyboard focus. */
  requestFocus(): void {
    this.emit("focusRequest", undefined);
  }
}

export const searchQuery = new SearchQuery();
