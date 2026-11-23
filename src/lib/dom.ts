/**
 * Lightweight DOM utility helpers.
 *
 * Provides terse element creation and query shortcuts
 * without pulling in a framework.
 */

/** Create an element with optional class, attributes, and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    attrs?: Record<string, string>;
    text?: string;
    html?: string;
    children?: (HTMLElement | string)[];
    onClick?: (e: Event) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onMouseDown?: (e: MouseEvent) => void;
  },
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options?.className) {
    element.className = options.className;
  }

  if (options?.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      element.setAttribute(key, value);
    }
  }

  if (options?.text) {
    element.textContent = options.text;
  } else if (options?.html) {
    element.innerHTML = options.html;
  }

  if (options?.children) {
    for (const child of options.children) {
      if (typeof child === "string") {
        element.appendChild(document.createTextNode(child));
      } else {
        element.appendChild(child);
      }
    }
  }

  if (options?.onClick) {
    element.addEventListener("click", options.onClick);
  }

  if (options?.onKeyDown) {
    element.addEventListener("keydown", (e) => options.onKeyDown!(e as KeyboardEvent));
  }

  if (options?.onMouseDown) {
    element.addEventListener("mousedown", (e) => options.onMouseDown!(e as MouseEvent));
  }

  return element;
}

/** Query a single element, throwing if not found. */
export function qs<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  return element;
}

/** Query all matching elements. */
export function qsa<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T[] {
  return Array.from(parent.querySelectorAll<T>(selector));
}

/** Format seconds into mm:ss (or h:mm:ss for tracks an hour or longer). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
