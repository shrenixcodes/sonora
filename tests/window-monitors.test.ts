import { describe, it, expect, vi, beforeAll } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

const { droppedOutside, frameAtPointer, initWindowMode } = await import("../src/lib/window-mode");

describe("floating frame across monitors", () => {
  it("treats a drop past any edge of the window as leaving its monitor", () => {
    const view = { width: 1920, height: 1040 };
    expect(droppedOutside(500, 400, view)).toBe(false);
    expect(droppedOutside(-1, 400, view)).toBe(true);
    expect(droppedOutside(1920, 400, view)).toBe(true);
    expect(droppedOutside(500, 1040, view)).toBe(true);
  });

  it("keeps the frame under the point it was grabbed by on the new monitor", () => {
    const frame = { x: 300, y: 120, width: 1180, height: 780 };
    const pointer = { x: 900, y: 40, width: 0, height: 0, viewportWidth: 1280, viewportHeight: 696 };
    // Grabbed 200 px into the titlebar; the new monitor is smaller, so it clamps.
    expect(frameAtPointer(frame, pointer, { x: 200, y: 20 })).toEqual({ x: 100, y: 0, width: 1180, height: 696 });
  });

  describe("dragging the frame off the screen", () => {
    beforeAll(async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 1040 });
      history.replaceState(null, "", "/?window=floating");
      await initWindowMode();
    });

    function drag(to: { x: number; y: number }) {
      const titlebar = document.createElement("div");
      titlebar.dataset.dragRegion = "";
      document.body.appendChild(titlebar);
      const pointer = (type: string, x: number, y: number) =>
        Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), {
          pointerId: 1,
          isPrimary: true,
        });
      titlebar.dispatchEvent(pointer("pointerdown", 600, 200));
      window.dispatchEvent(pointer("pointermove", 700, 210));
      window.dispatchEvent(pointer("pointerup", to.x, to.y));
      titlebar.remove();
    }

    it("moves the window to the monitor the frame was dropped on", async () => {
      isTauriMock.mockReturnValue(true);
      invokeMock.mockReset();
      invokeMock.mockImplementation(async (command: string) =>
        command === "follow_cursor_to_monitor"
          ? { x: 400, y: 300, width: 0, height: 0, viewportWidth: 2560, viewportHeight: 1392 }
          : undefined,
      );

      drag({ x: 2100, y: 300 });
      await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("follow_cursor_to_monitor"));
      // The centered frame (370, 130) was grabbed 230 px in and 70 px down.
      await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue("--frame-x")).toBe("170px"));
      expect(document.documentElement.style.getPropertyValue("--frame-y")).toBe("230px");
    });

    it("stays put when the frame is dropped on its own monitor", () => {
      invokeMock.mockClear();
      drag({ x: 900, y: 300 });
      expect(invokeMock).not.toHaveBeenCalledWith("follow_cursor_to_monitor");
    });
  });
});
