/**
 * Rubberband UX — elastic overscroll and rebound physics for scroll containers.
 */

export interface RubberbandOptions {
  axis?: "vertical" | "horizontal" | "both";
  maxOffset?: number;
  damping?: number;
  target?: HTMLElement;
}

export interface RubberbandInstance {
  destroy(): void;
  reset(): void;
  readonly offset: { x: number; y: number };
}

/**
 * Calculates damped elastic stretch offset.
 */
export function calculateRubberbandOffset(
  delta: number,
  current: number,
  maxOffset = 48,
  damping = 0.35,
): number {
  const resistance = 1 / (1 + Math.abs(current) * 0.05);
  const next = current + delta * damping * resistance;
  return Math.max(-maxOffset, Math.min(maxOffset, next));
}

/**
 * Attaches elastic rubberband overscroll behavior to a scrollable element.
 */
export function attachRubberband(
  element: HTMLElement,
  options: RubberbandOptions = {},
): RubberbandInstance {
  const axis = options.axis ?? "vertical";
  const maxOffset = options.maxOffset ?? 44;
  const damping = options.damping ?? 0.35;
  const target = options.target ?? element;

  target.classList.add("rubberband-target");

  let offsetX = 0;
  let offsetY = 0;
  let reboundTimer: ReturnType<typeof setTimeout> | null = null;

  const applyOffset = (x: number, y: number) => {
    offsetX = x;
    offsetY = y;
    target.style.setProperty("--rubberband-x", `${x.toFixed(1)}px`);
    target.style.setProperty("--rubberband-y", `${y.toFixed(1)}px`);
  };

  const rebound = () => {
    if (offsetX === 0 && offsetY === 0) return;
    target.classList.add("is-rebounding");
    applyOffset(0, 0);

    if (reboundTimer !== null) clearTimeout(reboundTimer);
    reboundTimer = setTimeout(() => {
      target.classList.remove("is-rebounding");
      reboundTimer = null;
    }, 360);
  };

  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const handleWheel = (e: WheelEvent) => {
    // Respect user reduced-motion preference
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let handled = false;

    // Vertical boundary checks
    if (axis === "vertical" || axis === "both") {
      const atTop = element.scrollTop <= 0 && e.deltaY < 0;
      const atBottom =
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && e.deltaY > 0;

      if (atTop || atBottom || offsetY !== 0) {
        // e.deltaY < 0 means scrolling up, pulling down (+y)
        const delta = -e.deltaY;
        const nextY = calculateRubberbandOffset(delta, offsetY, maxOffset, damping);
        applyOffset(offsetX, nextY);
        handled = true;
      }
    }

    // Horizontal boundary checks
    if (axis === "horizontal" || axis === "both") {
      const atLeft = element.scrollLeft <= 0 && e.deltaX < 0;
      const atRight =
        element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 && e.deltaX > 0;

      if (atLeft || atRight || offsetX !== 0) {
        const delta = -e.deltaX;
        const nextX = calculateRubberbandOffset(delta, offsetX, maxOffset, damping);
        applyOffset(nextX, offsetY);
        handled = true;
      }
    }

    if (handled) {
      if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => {
        rebound();
        wheelIdleTimer = null;
      }, 90);
    }
  };

  element.addEventListener("wheel", handleWheel, { passive: true });

  return {
    destroy() {
      element.removeEventListener("wheel", handleWheel);
      if (reboundTimer !== null) clearTimeout(reboundTimer);
      if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
      target.classList.remove("rubberband-target", "is-rebounding");
      target.style.removeProperty("--rubberband-x");
      target.style.removeProperty("--rubberband-y");
    },
    reset() {
      rebound();
    },
    get offset() {
      return { x: offsetX, y: offsetY };
    },
  };
}

const ATTACHED_ELEMENTS = new WeakSet<HTMLElement>();

/**
 * Initializes rubberband UX across all major scroll areas in the app.
 */
export function initRubberbandUX(root: ParentNode = document): void {
  const selectors: Array<{ sel: string; axis: "vertical" | "horizontal" | "both" }> = [
    { sel: "main.main", axis: "vertical" },
    { sel: ".sidebar", axis: "vertical" },
    { sel: ".queue-panel", axis: "vertical" },
    { sel: ".queue-panel__list", axis: "vertical" },
    { sel: ".now-playing__lyrics-scroll", axis: "vertical" },
    { sel: ".shelf__scroll", axis: "horizontal" },
  ];

  const attachMatches = (node: ParentNode) => {
    for (const { sel, axis } of selectors) {
      const elements = node.querySelectorAll<HTMLElement>(sel);
      elements.forEach((el) => {
        if (!ATTACHED_ELEMENTS.has(el)) {
          ATTACHED_ELEMENTS.add(el);
          attachRubberband(el, { axis });
        }
      });
    }
  };

  attachMatches(root);

  // Watch for dynamically added scroll containers (e.g. shelves or route transitions)
  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          m.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              attachMatches(node);
            }
          });
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  }
}
