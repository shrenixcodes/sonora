import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showAboutPopup } from "../src/components/about-popup";
import { createSidebar } from "../src/components/sidebar";

describe("About Sonora Pop-up and centered brand logo", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.querySelector(".about-popup")?.remove();
    vi.useRealTimers();
  });

  it("renders sidebar brand with only the centered logo icon and no text", () => {
    const sidebar = createSidebar();
    const brand = sidebar.querySelector(".sidebar__brand");
    expect(brand).not.toBeNull();

    const logoIcon = brand?.querySelector(".sidebar__brand-icon");
    expect(logoIcon).not.toBeNull();
    expect(logoIcon?.querySelector("svg")).not.toBeNull();

    // Verify no text node or title exists beside the logo
    const title = brand?.querySelector(".sidebar__brand-title");
    expect(title).toBeNull();
    expect(brand?.textContent?.trim()).toBe("");
  });

  it("opens about popup dialog with version, branding, and metadata when clicked", async () => {
    const sidebar = createSidebar();
    const brand = sidebar.querySelector(".sidebar__brand") as HTMLElement;
    expect(brand).not.toBeNull();

    brand.click();
    await vi.runAllTimersAsync();

    const dialog = document.querySelector<HTMLDialogElement>("dialog.about-popup");
    expect(dialog).not.toBeNull();

    const title = dialog?.querySelector(".about-popup__title");
    expect(title?.textContent).toBe("Sonora");

    const version = dialog?.querySelector(".about-popup__version");
    expect(version?.textContent).toContain("v0.5.1");

    const metaList = dialog?.querySelector(".about-popup__meta-list");
    expect(metaList?.textContent).toContain("Runtime");
    expect(metaList?.textContent).toContain("Shreyan Bag");
  });

  it("dismisses about popup on close button or tap outside", async () => {
    await showAboutPopup();

    const dialog = document.querySelector<HTMLDialogElement>("dialog.about-popup");
    expect(dialog).not.toBeNull();

    // Simulate clicking outside dialog boundaries
    if (dialog) {
      dialog.getBoundingClientRect = () =>
        ({ left: 100, top: 100, right: 400, bottom: 400, width: 300, height: 300 }) as DOMRect;
    }

    const clickOutsideEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
    dialog?.dispatchEvent(clickOutsideEvent);

    vi.advanceTimersByTime(250);
    expect(document.querySelector("dialog.about-popup")).toBeNull();
  });
});
