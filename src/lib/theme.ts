/**
 * Theme manager.
 *
 * Controls dark/light theme switching and persists the user's preference.
 * Respects the system preference as a default when no explicit choice is stored.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "sonora-theme";

class ThemeManager {
  private current: Theme;
  private listeners: Array<(theme: Theme) => void> = [];

  constructor() {
    this.current = this.loadSavedTheme();
    this.apply(this.current);
  }

  /** Get the active theme. */
  get theme(): Theme {
    return this.current;
  }

  /** Set and persist a theme. */
  set(theme: Theme): void {
    this.current = theme;
    this.apply(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    this.listeners.forEach((fn) => fn(theme));
  }

  /** Toggle between dark and light. */
  toggle(): void {
    this.set(this.current === "dark" ? "light" : "dark");
  }

  /** Subscribe to theme changes. */
  onChange(listener: (theme: Theme) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private apply(theme: Theme): void {
    document.documentElement.setAttribute("data-theme", theme);
  }

  private loadSavedTheme(): Theme {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;

    // Fall back to system preference
    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  }
}

export const themeManager = new ThemeManager();
