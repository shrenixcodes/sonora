/**
 * About Sonora Pop-up Dialog.
 *
 * Displays current application version, branding, platform runtime details,
 * and quick actions. Dismisses on tap/click outside or escape key.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { getAppRuntimeInfo, type PlatformInfo } from "@/lib/app-info";
import { showLaunchSplash } from "@/lib/visuals/splash-screen";
import { describeUpdateSnapshot, openExternalUrl, SONORA_REPO_URL, updater } from "@/lib/updater";

function formatPlatformDisplay(info: PlatformInfo): string {
  const osMap: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    darwin: "macOS",
    linux: "Linux",
  };
  const archMap: Record<string, string> = {
    x86_64: "x64",
    amd64: "x64",
    aarch64: "ARM64",
    arm64: "ARM64",
    x86: "x86",
  };
  const os = osMap[info.os.toLowerCase()] ?? info.os;
  const arch = archMap[info.arch.toLowerCase()] ?? info.arch;
  return `${os} (${arch})`;
}

export async function showAboutPopup(): Promise<void> {
  // Remove any previously open about dialog
  document.querySelector(".about-popup")?.remove();

  const { app: appInfo, platform: platformInfo } = await getAppRuntimeInfo();

  let isClosing = false;
  let stopUpdater: (() => void) | null = null;
  const closeDialog = () => {
    if (isClosing) return;
    isClosing = true;
    stopUpdater?.();
    stopUpdater = null;
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

  const updateStatusLabel = el("span", { className: "about-popup__update-status" });
  const updateDetailText = el("span", { className: "about-popup__update-detail" });
  const updateBox = el("div", {
    className: "about-popup__update",
    attrs: { role: "status", "aria-live": "polite" },
    children: [
      el("div", {
        className: "about-popup__update-row",
        children: [
          el("span", { className: "about-popup__meta-label", text: "Updates" }),
          updateStatusLabel,
        ],
      }),
      updateDetailText,
    ],
  });

  const updateBtn = el("button", {
    className: "btn btn--secondary about-popup__update-btn",
    attrs: { type: "button" },
    text: "Check for Updates",
    onClick: () => {
      const state = updater.state;
      if (state.status === "available") {
        void updater.installUpdate();
      } else {
        void updater.checkForUpdates({ force: true });
      }
    },
  }) as HTMLButtonElement;

  const syncUpdateUi = () => {
    const snap = updater.state;
    const summary = describeUpdateSnapshot(snap);
    updateStatusLabel.textContent = summary.label;
    updateDetailText.textContent = summary.detail;
    updateBox.dataset.state = snap.status;

    const busy = snap.status === "checking" || snap.status === "downloading" || snap.status === "installing";
    updateBtn.disabled = busy;
    if (snap.status === "available") {
      const actionLabel = snap.info?.installerUrl ? `Update to v${snap.info.latestVersion}` : `Download v${snap.info?.latestVersion ?? ""}`;
      updateBtn.textContent = actionLabel;
      updateBtn.className = "btn btn--primary about-popup__update-btn";
    } else if (snap.status === "checking") {
      updateBtn.textContent = "Checking…";
      updateBtn.className = "btn btn--secondary about-popup__update-btn";
    } else if (snap.status === "downloading" || snap.status === "installing") {
      updateBtn.textContent = "Updating…";
      updateBtn.className = "btn btn--primary about-popup__update-btn";
    } else if (snap.status === "error") {
      updateBtn.textContent = "Retry Check";
      updateBtn.className = "btn btn--secondary about-popup__update-btn";
    } else {
      updateBtn.textContent = "Check for Updates";
      updateBtn.className = "btn btn--secondary about-popup__update-btn";
    }
  };
  syncUpdateUi();
  stopUpdater = updater.on("change", syncUpdateUi);

  const replayBtn = el("button", {
    className: "btn btn--secondary about-popup__replay-btn",
    attrs: { type: "button", title: "Replay launch splash screen" },
    children: [
      el("span", { html: icon("refresh") }),
      el("span", { text: "Relaunch" }),
    ],
    onClick: () => {
      closeDialog();
      showLaunchSplash({ force: true }).catch(() => {});
    },
  });

  const authorLink = el("a", {
    className: "about-popup__meta-val about-popup__meta-link",
    attrs: {
      href: SONORA_REPO_URL,
      target: "_blank",
      rel: "noopener noreferrer",
      title: SONORA_REPO_URL,
      "aria-label": "shrenixcodes — Open Sonora repository on GitHub",
    },
    children: [
      el("span", { text: "shrenixcodes" }),
      el("span", {
        className: "about-popup__meta-link-icon",
        html: icon("externalLink"),
        attrs: { "aria-hidden": "true" },
      }),
    ],
    onClick: (e) => {
      e.preventDefault();
      void openExternalUrl(SONORA_REPO_URL);
    },
  });

  const dialog = el("dialog", {
    className: "about-popup",
    attrs: { "aria-labelledby": "about-popup-title", tabindex: "-1" },
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
                    text: formatPlatformDisplay(platformInfo),
                  }),
                ],
              }),
              el("div", {
                className: "about-popup__meta-item",
                children: [
                  el("span", { className: "about-popup__meta-label", text: "Author" }),
                  authorLink,
                ],
              }),
            ],
          }),
          updateBox,
        ],
      }),
      el("div", {
        className: "about-popup__actions",
        children: [updateBtn, replayBtn],
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
  dialog.focus({ preventScroll: true });
  if (updater.state.status === "idle") {
    void updater.checkForUpdates();
  }
}
