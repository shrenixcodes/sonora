/**
 * Simple hash-based router.
 *
 * Maps route paths to view render functions. Supports navigation,
 * back/forward history, and active-link detection.
 */

export type RouteHandler = (container: HTMLElement) => void | Promise<void>;

interface Route {
  path: string;
  handler: RouteHandler;
}

type NavigationListener = (path: string) => void;

const HISTORY_STATE_KEY = "__sonoraNavIdx";

function readHistoryIndex(): number | null {
  try {
    const state = window.history.state as Record<string, unknown> | null;
    return state && typeof state[HISTORY_STATE_KEY] === "number"
      ? (state[HISTORY_STATE_KEY] as number)
      : null;
  } catch {
    return null;
  }
}

function writeHistoryIndex(index: number): void {
  try {
    const current = window.history.state;
    const nextState =
      current && typeof current === "object"
        ? { ...(current as Record<string, unknown>), [HISTORY_STATE_KEY]: index }
        : { [HISTORY_STATE_KEY]: index };
    window.history.replaceState(nextState, "");
  } catch {
    // Some embedded contexts restrict history.replaceState.
  }
}

class Router {
  private routes: Route[] = [];
  private listeners: NavigationListener[] = [];
  private currentPath = "";
  private render: (() => void) | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private pendingIndex: number | null = null;
  private boundHashChange: (() => void) | null = null;

  /** Register a route. */
  route(path: string, handler: RouteHandler): this {
    this.routes.push({ path, handler });
    return this;
  }

  /** Navigate to a path. */
  navigate(path: string): void {
    if (path === this.currentPath) return;
    window.location.hash = path;
  }

  /** Whether there is an earlier route in the session stack. */
  get canGoBack(): boolean {
    return this.historyIndex > 0;
  }

  /** Whether there is a forward route in the session stack. */
  get canGoForward(): boolean {
    return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
  }

  /** Navigate to the previous route if available. */
  back(): void {
    if (!this.canGoBack) return;
    this.pendingIndex = this.historyIndex - 1;
    window.history.back();
  }

  /** Navigate to the next route if available. */
  forward(): void {
    if (!this.canGoForward) return;
    this.pendingIndex = this.historyIndex + 1;
    window.history.forward();
  }

  /** Renders the current page again, e.g. after its data was refreshed. */
  refresh(): void {
    if (!this.render) return;
    // Views clean up when told the route changed; an empty path tells the
    // outgoing page to do so before its replacement renders.
    this.listeners.forEach((l) => l(""));
    this.render();
  }

  /** Get the current route path. */
  get current(): string {
    return this.currentPath;
  }

  /** Listen for navigation changes. */
  onNavigate(listener: NavigationListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Keep the navigation stack synchronized with hash transitions. */
  private syncHistory(hash: string): void {
    const pending = this.pendingIndex;
    this.pendingIndex = null;

    if (this.history.length === 0) {
      this.history = [hash];
      this.historyIndex = 0;
      writeHistoryIndex(0);
      return;
    }

    if (
      pending !== null &&
      pending >= 0 &&
      pending < this.history.length &&
      this.history[pending] === hash
    ) {
      this.historyIndex = pending;
      writeHistoryIndex(pending);
      return;
    }

    const stateIdx = readHistoryIndex();
    if (
      stateIdx !== null &&
      stateIdx !== this.historyIndex &&
      stateIdx >= 0 &&
      stateIdx < this.history.length &&
      this.history[stateIdx] === hash
    ) {
      this.historyIndex = stateIdx;
      return;
    }

    if (this.history[this.historyIndex] === hash) {
      writeHistoryIndex(this.historyIndex);
      return;
    }

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(hash);
    this.historyIndex = this.history.length - 1;
    writeHistoryIndex(this.historyIndex);
  }

  /** Start listening to hash changes and render the initial route. */
  start(container: HTMLElement): void {
    if (this.boundHashChange) {
      window.removeEventListener("hashchange", this.boundHashChange);
    }

    this.history = [];
    this.historyIndex = -1;
    this.pendingIndex = null;

    const handleRoute = (recordHistory = true) => {
      const hash = window.location.hash.slice(1) || "/";
      this.currentPath = hash;
      if (recordHistory) this.syncHistory(hash);

      const pathname = hash.split("?")[0] || "/";
      const route = this.routes.find((r) => r.path === hash || r.path === pathname);
      if (route) {
        container.innerHTML = "";
        route.handler(container);
      } else {
        // Fall back to home
        const home = this.routes.find((r) => r.path === "/");
        if (home) {
          container.innerHTML = "";
          home.handler(container);
        }
      }

      this.listeners.forEach((l) => l(hash));
    };

    this.render = () => handleRoute(false);
    this.boundHashChange = () => handleRoute(true);
    window.addEventListener("hashchange", this.boundHashChange);
    handleRoute(true);
  }
}

export const router = new Router();
