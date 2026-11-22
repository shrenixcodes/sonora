import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "../src/lib/events";

describe("EventEmitter", () => {
  it("subscribes and receives emitted events", () => {
    const bus = new EventEmitter<{ test: string }>();
    const handler = vi.fn();

    const unsub = bus.on("test", handler);
    bus.emit("test", "hello");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("hello");

    unsub();
    bus.emit("test", "world");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles once listeners correctly", () => {
    const bus = new EventEmitter<{ trigger: number }>();
    const handler = vi.fn();

    bus.once("trigger", handler);
    bus.emit("trigger", 42);
    bus.emit("trigger", 43);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it("clears all listeners without throwing", () => {
    const bus = new EventEmitter<{ a: void; b: void }>();
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    bus.on("a", fn1);
    bus.on("b", fn2);
    bus.clear();

    bus.emit("a", undefined);
    bus.emit("b", undefined);

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });
});
