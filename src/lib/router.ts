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

      const route = this.routes.find((r) => r.path === hash);
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

    window.addEventListener("hashchange", handleRoute);
    handleRoute();
  }
}

export const router = new Router();
