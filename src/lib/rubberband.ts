/**
 * Rubberband UX — elastic overscroll and rebound physics for scroll containers.
 */

export interface RubberbandOptions {
  axis?: "vertical" | "horizontal" | "both";
  maxOffset?: number;
  damping?: number;
  target?: HTMLElement;
  listenOn?: HTMLElement;
  shouldHandle?: (event: WheelEvent) => boolean;
  onStateChange?: (state: { x: number; y: number; stretching: boolean; rebounding: boolean }) => void;
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
  const listenOn = options.listenOn ?? element;

  target.classList.add("rubberband-target");

  let offsetX = 0;
  let offsetY = 0;
  let reboundTimer: ReturnType<typeof setTimeout> | null = null;

  const notify = (x: number, y: number, stretching: boolean, rebounding: boolean) => {
    options.onStateChange?.({ x, y, stretching, rebounding });
  };

  const applyOffset = (x: number, y: number) => {
    offsetX = x;
    offsetY = y;
    const stretching = x !== 0 || y !== 0;
    if (stretching) {
      if (reboundTimer !== null) {
        clearTimeout(reboundTimer);
        reboundTimer = null;
      }
      target.classList.remove("is-rebounding");
    }
    target.classList.toggle("is-stretching", stretching);
    target.style.setProperty("--rubberband-x", `${x.toFixed(1)}px`);
    target.style.setProperty("--rubberband-y", `${y.toFixed(1)}px`);
    notify(x, y, stretching, target.classList.contains("is-rebounding"));
  };

  const rebound = () => {
    if (offsetX === 0 && offsetY === 0) return;
    target.classList.remove("is-stretching");
    target.classList.add("is-rebounding");
    offsetX = 0;
    offsetY = 0;
    target.style.setProperty("--rubberband-x", "0.0px");
    target.style.setProperty("--rubberband-y", "0.0px");
    notify(0, 0, false, true);

    if (reboundTimer !== null) clearTimeout(reboundTimer);
    reboundTimer = setTimeout(() => {
      target.classList.remove("is-rebounding");
      reboundTimer = null;
      notify(0, 0, false, false);
    }, 360);
  };

  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const handleWheel = (e: WheelEvent) => {
    if (e.defaultPrevented) return;
    // Respect user reduced-motion preference
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    if (options.shouldHandle && !options.shouldHandle(e)) {
      if (offsetX !== 0 || offsetY !== 0) rebound();
      return;
    }

    let handled = false;
    let nextX = offsetX;
    let nextY = offsetY;

    // Vertical elastic follow (both during normal scrolling and at boundaries)
    if ((axis === "vertical" || axis === "both") && e.deltaY !== 0) {
      const atTop = element.scrollTop <= 0 && e.deltaY < 0;
      const atBottom =
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && e.deltaY > 0;
      const effectiveDamping = atTop || atBottom ? damping : damping * 0.6;
      // e.deltaY < 0 means scrolling up, pulling down (+y)
      const delta = -e.deltaY;
      nextY = calculateRubberbandOffset(delta, offsetY, maxOffset, effectiveDamping);
      handled = true;
    }

    // Horizontal elastic follow (both during normal scrolling and at boundaries)
    if ((axis === "horizontal" || axis === "both") && e.deltaX !== 0) {
      const atLeft = element.scrollLeft <= 0 && e.deltaX < 0;
      const atRight =
        element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 && e.deltaX > 0;
      const effectiveDamping = atLeft || atRight ? damping : damping * 0.6;
      const delta = -e.deltaX;
      nextX = calculateRubberbandOffset(delta, offsetX, maxOffset, effectiveDamping);
      handled = true;
    }

    if (handled) {
      applyOffset(nextX, nextY);
      if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => {
        rebound();
        wheelIdleTimer = null;
      }, 90);
    }
  };

  listenOn.addEventListener("wheel", handleWheel, { passive: true });

  return {
    destroy() {
      listenOn.removeEventListener("wheel", handleWheel);
      if (reboundTimer !== null) clearTimeout(reboundTimer);
      if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
      target.classList.remove("rubberband-target", "is-stretching", "is-rebounding");
      target.style.removeProperty("--rubberband-x");
      target.style.removeProperty("--rubberband-y");
      notify(0, 0, false, false);
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
  const selectors: Array<{
    sel: string;
    axis: "vertical" | "horizontal" | "both";
    target?: string;
    listenOnTarget?: boolean;
    maxOffset?: number;
  }> = [
    { sel: "main.main", axis: "vertical", maxOffset: 12 },
    // Transform and listen on the single .queue-panel shell, reading scroll bounds from .queue-panel__list,
    // so header and list move as one capsule without double-transform jitter.
    { sel: ".queue-panel__list", axis: "vertical", target: ".queue-panel", listenOnTarget: true, maxOffset: 12 },
    { sel: ".shelf__scroll", axis: "horizontal" },
  ];

  const attachMatches = (node: ParentNode) => {
    for (const { sel, axis, target, listenOnTarget, maxOffset } of selectors) {
      const elements = node.querySelectorAll<HTMLElement>(sel);
      elements.forEach((el) => {
        if (!ATTACHED_ELEMENTS.has(el)) {
          const targetElement = target ? el.closest<HTMLElement>(target) : el;
          if (!targetElement) return;
          ATTACHED_ELEMENTS.add(el);

          const isMain = el.matches("main.main");
          const appShell = isMain ? el.closest<HTMLElement>("#app") : null;

          attachRubberband(el, {
            axis,
            target: targetElement,
            listenOn: listenOnTarget ? targetElement : el,
            maxOffset,
            shouldHandle: isMain
              ? (event) => {
                  if (document.documentElement.hasAttribute("data-immersive")) return false;
                  if (el.querySelector(".now-playing")) return false;
                  if (event.target instanceof Element && event.target.closest("dialog, .song-context-menu")) {
                    return false;
                  }
                  return true;
                }
              : undefined,
            onStateChange: appShell
              ? ({ x, y, stretching, rebounding }) => {
                  appShell.classList.toggle("is-stage-stretching", stretching);
                  appShell.classList.toggle("is-stage-rebounding", rebounding);
                  if (stretching || rebounding) {
                    appShell.style.setProperty("--stage-rubberband-x", `${x.toFixed(1)}px`);
                    appShell.style.setProperty("--stage-rubberband-y", `${y.toFixed(1)}px`);
                  } else {
                    appShell.style.removeProperty("--stage-rubberband-x");
                    appShell.style.removeProperty("--stage-rubberband-y");
                  }
                }
              : undefined,
          });
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
