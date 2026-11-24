import { describe, it, expect, vi } from "vitest";
import { attachSlider } from "../src/lib/slider";

function setup(step = 0.1, elastic = true) {
  const bar = document.createElement("div");
  document.body.appendChild(bar);
  bar.getBoundingClientRect = () => ({ left: 100, width: 200, right: 300, top: 0, bottom: 10, height: 10, x: 100, y: 0, toJSON() {} });
  // jsdom has no pointer capture.
  bar.setPointerCapture = vi.fn();
  bar.releasePointerCapture = vi.fn();
  bar.hasPointerCapture = vi.fn(() => true);
  const onInput = vi.fn();
  const onCommit = vi.fn();
  const slider = attachSlider(bar, { label: "Volume", onInput, onCommit, step: () => step, elastic });
  return { bar, slider, onInput, onCommit };
}

const pointer = (type: string, clientX: number) =>
  Object.assign(new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true }), { pointerId: 1 });

describe("attachSlider", () => {
  it("follows a drag and commits once, where it was released", () => {
    const { bar, slider, onInput, onCommit } = setup();
    bar.dispatchEvent(pointer("pointerdown", 150));
    expect(slider.dragging).toBe(true);
    bar.dispatchEvent(pointer("pointermove", 250));
    // Past the end of the bar the value stays at the maximum.
    bar.dispatchEvent(pointer("pointermove", 900));
    bar.dispatchEvent(pointer("pointerup", 900));

    expect(onInput.mock.calls.map(([v]) => v)).toEqual([0.25, 0.75, 1]);
    expect(onCommit.mock.calls).toEqual([[1]]);
    expect(slider.dragging).toBe(false);
    expect(bar.style.getPropertyValue("--value")).toBe("1");
  });

  it("keeps a non-elastic volume handle within its bounds and does not rebound", () => {
    const { bar, onCommit } = setup(0.1, false);
    bar.dispatchEvent(pointer("pointerdown", 150));
    bar.dispatchEvent(pointer("pointermove", 900));
    bar.dispatchEvent(pointer("pointerup", 900));
    expect(bar.style.getPropertyValue("--value")).toBe("1");
    expect(bar.style.getPropertyValue("--rubberband-pull")).toBe("");
    expect(bar.classList.contains("is-rebounding")).toBe(false);
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it("ignores outside updates while dragging", () => {
    const { bar, slider } = setup();
    bar.dispatchEvent(pointer("pointerdown", 150));
    slider.setValue(0.9);
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
  });

  it("moves by one step per wheel notch and arrow key", () => {
    const { bar, slider, onCommit } = setup(0.1);
    slider.setValue(0.5);
    bar.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "End", cancelable: true }));

    expect(onCommit.mock.calls.map(([v]) => Number(v.toFixed(2)))).toEqual([0.6, 0.5, 0.4, 1]);
  });
});
