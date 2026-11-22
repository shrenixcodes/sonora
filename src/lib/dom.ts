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

/** Format seconds into mm:ss. */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
