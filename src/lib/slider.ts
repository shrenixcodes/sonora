/**
 * Horizontal slider behaviour for the player's progress and volume bars.
 *
 * Drag anywhere on the bar (the pointer is captured, so the drag keeps going
 * past its ends), scroll the mouse wheel over it, or use the arrow keys when
 * it has focus. The value is exposed to CSS as `--value` (0 to 1).
 */

export interface SliderOptions {
  label: string;
  /** Called as the value changes during a drag, for live feedback. */
  onInput: (ratio: number) => void;
  /** Called with the value the user settled on: drag released, wheel or key. */
  onCommit: (ratio: number) => void;
  /** How far one wheel notch or arrow key moves the value, as a ratio. */
  step: () => number;
  /** Spoken value, e.g. "1:23 of 3:45" or "40%". */
  valueText?: (ratio: number) => string;
}

export interface Slider {
  /** Shows a value that changed elsewhere; ignored while the user is dragging. */
  setValue(ratio: number): void;
  readonly dragging: boolean;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function attachSlider(bar: HTMLElement, options: SliderOptions): Slider {
  let value = 0;
  let dragging = false;

  bar.setAttribute("role", "slider");
  bar.setAttribute("tabindex", "0");
  bar.setAttribute("aria-label", options.label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");

  const show = (ratio: number) => {
    value = clamp(ratio);
    bar.style.setProperty("--value", String(value));
    bar.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    if (options.valueText) bar.setAttribute("aria-valuetext", options.valueText(value));
  };

  const ratioAt = (clientX: number) => {
    const rect = bar.getBoundingClientRect();
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width) : value;
  };

  const nudge = (by: number) => {
    show(value + by);
    options.onInput(value);
    options.onCommit(value);
  };

  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.focus({ preventScroll: true });
    bar.setPointerCapture(e.pointerId);
    dragging = true;
    bar.classList.add("is-dragging");
    show(ratioAt(e.clientX));
    options.onInput(value);
  });

  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    show(ratioAt(e.clientX));
    options.onInput(value);
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove("is-dragging");
    if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    options.onCommit(value);
  };
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  bar.addEventListener(
    "wheel",
    (e) => {
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      nudge(Math.sign(delta) * options.step());
    },
    { passive: false },
  );

  bar.addEventListener("keydown", (e) => {
    const step = options.step();
    const moves: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: step * 2,
      PageDown: -step * 2,
      Home: -1,
      End: 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    e.stopPropagation(); // keep the global arrow-key shortcuts out of it
    nudge(moves[e.key]);
  });

  return {
    setValue(ratio: number) {
      if (!dragging) show(ratio);
    },
    get dragging() {
      return dragging;
    },
  };
}
