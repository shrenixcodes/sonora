/**
 * Settings view.
 *
 * Application configuration including account, appearance,
 * playback, and about sections.
 */

import { el } from "@/lib/dom";
import { themeManager } from "@/lib/theme";

export function renderSettings(container: HTMLElement): void {
  const currentTheme = themeManager.theme;

  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Settings" }),
        ],
      }),

      // Account section
      createSettingsSection("Account", [
        createSettingRow(
          "YouTube Music",
          "Sign in to access your library and playlists",
          el("button", {
            className: "settings__btn",
            text: "Sign in",
            attrs: { disabled: "" },
          }),
        ),
      ]),

      // Appearance section
      createSettingsSection("Appearance", [
        createSettingRow(
          "Theme",
          "Choose between dark and light mode",
          createThemeToggle(currentTheme),
        ),
      ]),

      // About section
      createSettingsSection("About", [
        createSettingRow("Version", "0.1.0", el("span")),
        createSettingRow(
          "Built with",
          "Tauri 2 + TypeScript",
          el("span"),
        ),
      ]),
    ],
  });

  container.appendChild(content);
}

function createSettingsSection(
  title: string,
  rows: HTMLElement[],
): HTMLElement {
  return el("div", {
    className: "settings__section",
    children: [
      el("h2", { className: "settings__section-title", text: title }),
      el("div", { className: "settings__rows", children: rows }),
    ],
  });
}

function createSettingRow(
  label: string,
  description: string,
  control: HTMLElement,
): HTMLElement {
  return el("div", {
    className: "settings__row",
    children: [
      el("div", {
        className: "settings__row-info",
        children: [
          el("span", { className: "settings__row-label", text: label }),
          el("span", {
            className: "settings__row-description",
            text: description,
          }),
        ],
      }),
      control,
    ],
  });
}

function createThemeToggle(currentTheme: string): HTMLElement {
  const btn = el("button", {
    className: "settings__btn",
    text: currentTheme === "dark" ? "Dark" : "Light",
    onClick: () => {
      themeManager.toggle();
      btn.textContent = themeManager.theme === "dark" ? "Dark" : "Light";
    },
  });

  return btn;
}
