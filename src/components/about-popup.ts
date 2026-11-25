/**
 * About Sonora Pop-up Dialog.
 *
 * Displays current application version, branding, platform runtime details,
 * and quick actions. Dismisses on tap/click outside or escape key.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { showLaunchSplash } from "@/lib/visuals/splash-screen";

interface AppInfo {
  name: string;
  version: string;
}

interface PlatformInfo {
  os: string;
  arch: string;
}

export async function showAboutPopup(): Promise<void> {
  // Remove any previously open about dialog
  document.querySelector(".about-popup")?.remove();

  let appInfo: AppInfo = { name: "Sonora", version: "0.6.1" };
  let platformInfo: PlatformInfo = { os: "windows", arch: "x64" };

  if (isTauri()) {
    try {
      const [app, plat] = await Promise.all([
        invoke<AppInfo>("get_app_info"),
        invoke<PlatformInfo>("get_platform_info"),
      ]);
      if (app) appInfo = app;
      if (plat) platformInfo = plat;
    } catch {
      // Retain fallback app info
    }
  }

  let isClosing = false;
  const closeDialog = () => {
    if (isClosing) return;
    isClosing = true;
    dialog.classList.add("is-closing");
    setTimeout(() => {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      dialog.remove();
    }, 180);
  };

  const closeBtn = el("button", {
    className: "about-popup__close",
    attrs: { type: "button", "aria-label": "Close", title: "Close" },
    html: icon("close"),
    onClick: closeDialog,
  });

  const replayBtn = el("button", {
    className: "btn btn--secondary about-popup__replay-btn",
    attrs: { type: "button", title: "Replay launch splash screen" },
    children: [
      el("span", { html: icon("refresh") }),
      el("span", { text: "Replay Splash" }),
    ],
    onClick: () => {
      closeDialog();
      showLaunchSplash({ force: true }).catch(() => {});
    },
  });

  const doneBtn = el("button", {
    className: "btn btn--primary",
    attrs: { type: "button" },
    text: "Done",
    onClick: closeDialog,
  });

  const dialog = el("dialog", {
    className: "about-popup",
    attrs: { "aria-labelledby": "about-popup-title" },
    children: [
      closeBtn,
      el("div", {
        className: "about-popup__header",
        children: [
          el("div", {
            className: "about-popup__logo",
            html: icon("sonoraLogo"),
          }),
          el("h2", {
            className: "about-popup__title",
            text: appInfo.name,
            attrs: { id: "about-popup-title" },
          }),
          el("span", {
            className: "about-popup__version",
            text: `v${appInfo.version}`,
          }),
          el("p", {
            className: "about-popup__tagline",
            text: "Resonant Sound · Pure Clarity",
          }),
        ],
      }),
      el("div", {
        className: "about-popup__body",
        children: [
          el("p", {
            className: "about-popup__desc",
            text: "An immersive, fluid YouTube Music client with magnetic window awareness and synchronized lyrics.",
          }),
          el("div", {
            className: "about-popup__meta-list",
            children: [
              el("div", {
                className: "about-popup__meta-item",
                children: [
                  el("span", { className: "about-popup__meta-label", text: "Runtime" }),
                  el("span", { className: "about-popup__meta-val", text: "Tauri 2 · WebView2" }),
                ],
              }),
              el("div", {
                className: "about-popup__meta-item",
                children: [
                  el("span", { className: "about-popup__meta-label", text: "Platform" }),
                  el("span", {
                    className: "about-popup__meta-val",
                    text: `${platformInfo.os} (${platformInfo.arch})`,
                  }),
                ],
              }),
              el("div", {
                className: "about-popup__meta-item",
                children: [
                  el("span", { className: "about-popup__meta-label", text: "Author" }),
                  el("span", { className: "about-popup__meta-val", text: "Shreyan Bag" }),
                ],
              }),
            ],
          }),
        ],
      }),
      el("div", {
        className: "about-popup__actions",
        children: [replayBtn, doneBtn],
      }),
    ],
  }) as HTMLDialogElement;

  // Tap or click outside the dialog bounding box immediately closes it
  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;
    if (!isInDialog) {
      closeDialog();
    }
  });

  // Handle escape key
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog();
  });

  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  doneBtn.focus();
}
