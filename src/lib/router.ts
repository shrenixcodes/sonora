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

class Router {
  private routes: Route[] = [];
  private listeners: NavigationListener[] = [];
  private currentPath = "";
  private render: (() => void) | null = null;

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

  /** Start listening to hash changes and render the initial route. */
  start(container: HTMLElement): void {
    const handleRoute = () => {
      const hash = window.location.hash.slice(1) || "/";
      this.currentPath = hash;
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

    this.render = handleRoute;
    window.addEventListener("hashchange", handleRoute);
    handleRoute();
  }
}

export const router = new Router();
