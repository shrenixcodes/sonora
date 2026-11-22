/**
 * Settings & Appearance Studio View.
 *
 * Full application customization including theme switcher, accent color palette,
 * interface density, ambient visual parameters, audio settings, and theme import/export.
 */

import { el } from "@/lib/dom";
import { themeManager } from "@/lib/theme";
import { applyAccent } from "@/lib/accent";
import { storage } from "@/lib/storage";
import type { UserSettings, AmbientVisualMode } from "@/types/music";

const ACCENT_COLORS = [
  { name: "Dusty Purple", hex: "#A78BFA" },
  { name: "Bottle Green", hex: "#315E48" },
  { name: "Electric Blue", hex: "#3B82F6" },
  { name: "Muted Gold", hex: "#C9A96E" },
  { name: "Coral", hex: "#D95342" },
  { name: "Rose Pink", hex: "#F472B6" },
  { name: "Emerald", hex: "#10B981" },
  { name: "Teal", hex: "#14B8A6" },
];

export function renderSettings(container: HTMLElement): void {
  const currentSettings = storage.getSettings();

  const content = el("div", {
    className: "main__content",
    children: [
      el("div", {
        className: "page-header",
        children: [
          el("h1", { className: "page-header__title", text: "Settings" }),
          el("p", {
            className: "page-header__subtitle",
            text: "Personalize your Sonora listening experience",
          }),
        ],
      }),

      // ── Appearance Studio ────────────────────────────────
      createSettingsSection("Appearance Studio", [
        // Theme
        createSettingRow(
          "Color Theme",
          "Select between dark charcoal and light bone themes",
          createThemeSelector(),
        ),

        // Accent Color
        createSettingRow(
          "Accent Color",
          "Choose the primary brand and interaction accent tone",
          createAccentPalette(currentSettings.accentColor),
        ),

        // Interface Density
        createSettingRow(
          "Interface Density",
          "Adjust spacing and compactness of navigation and lists",
          createDensitySelector(currentSettings.density),
        ),

        // Ambient Visual Mode
        createSettingRow(
          "Ambient Visualizer Mode",
          "Default atmospheric shader style for Now Playing",
          createVisualModeSelector(currentSettings.ambientMode),
        ),

        // Ambient FPS
        createSettingRow(
          "Visualizer Frame Rate",
          "Cap ambient GPU frame rate for maximum power efficiency",
          createFpsSelector(currentSettings.ambientFpsLimit),
        ),

        // Theme Import / Export
        createSettingRow(
          "Theme Configuration",
          "Export or import your personalized theme configuration",
          createThemeImportExport(),
        ),
      ]),

      // ── Playback & Sound ─────────────────────────────────
      createSettingsSection("Playback & Sound", [
        createSettingRow(
          "Normalize Volume",
          "Maintain consistent audio loudness across different tracks",
          createToggle(currentSettings.normalizeVolume, (val) => {
            storage.saveSettings({ normalizeVolume: val });
          }),
        ),
        createSettingRow(
          "Autoplay Next",
          "Continue playing recommended music when queue reaches the end",
          createToggle(currentSettings.autoPlayNext, (val) => {
            storage.saveSettings({ autoPlayNext: val });
          }),
        ),
      ]),

      // ── YouTube Music Service ────────────────────────────
      createSettingsSection("Service & Account", [
        createSettingRow(
          "YouTube Music",
          "Active session: Guest / Local Library Mode",
          el("button", {
            className: "settings__btn",
            text: "Manage Account",
            onClick: () => {
              alert(
                "Sonora is running in native guest mode with full YouTube catalog discovery and local library persistence.",
              );
            },
          }),
        ),
      ]),

      // ── Keyboard Shortcuts ───────────────────────────────
      createSettingsSection("Keyboard Shortcuts", [
        createShortcutRow("Space", "Play / Pause playback"),
        createShortcutRow("← / →", "Seek 5 seconds backward / forward"),
        createShortcutRow("↑ / ↓", "Adjust volume up / down"),
        createShortcutRow("M", "Mute / Unmute audio"),
        createShortcutRow("L", "Toggle like for current track"),
        createShortcutRow("F", "Toggle fullscreen Now Playing"),
      ]),

      // ── About ────────────────────────────────────────────
      createSettingsSection("About Sonora", [
        createSettingRow(
          "Sonora Desktop",
          "Version 0.1.0 (Windows x64 Native)",
          el("span", { className: "settings__tag", text: "Production Ready" }),
        ),
        createSettingRow(
          "Architecture",
          "Tauri 2 • Rust Backend • WebGL Ambient Shaders • Vite",
          el("span", { className: "settings__tag", text: "Lightweight" }),
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

function createShortcutRow(key: string, description: string): HTMLElement {
  return el("div", {
    className: "settings__row",
    children: [
      el("div", {
        className: "settings__row-info",
        children: [
          el("span", { className: "settings__row-label", text: description }),
        ],
      }),
      el("kbd", { className: "settings__kbd", text: key }),
    ],
  });
}

function createThemeSelector(): HTMLElement {
  const current = themeManager.theme;
  const container = el("div", { className: "settings__segmented" });

  const darkBtn = el("button", {
    className: `settings__seg-btn${current === "dark" ? " settings__seg-btn--active" : ""}`,
    text: "Dark",
    onClick: () => {
      themeManager.set("dark");
      darkBtn.classList.add("settings__seg-btn--active");
      lightBtn.classList.remove("settings__seg-btn--active");
    },
  });

  const lightBtn = el("button", {
    className: `settings__seg-btn${current === "light" ? " settings__seg-btn--active" : ""}`,
    text: "Light",
    onClick: () => {
      themeManager.set("light");
      lightBtn.classList.add("settings__seg-btn--active");
      darkBtn.classList.remove("settings__seg-btn--active");
    },
  });

  container.appendChild(darkBtn);
  container.appendChild(lightBtn);
  return container;
}

function createAccentPalette(currentAccent: string | null): HTMLElement {
  const container = el("div", { className: "settings__accent-palette" });

  // null = each theme's own accent (purple on charcoal, green on bone)
  const options: Array<{ name: string; hex: string | null }> = [
    { name: "Theme default", hex: null },
    ...ACCENT_COLORS,
  ];

  options.forEach(({ name, hex }) => {
    const isActive = currentAccent === hex;
    const swatch = el("button", {
      className: `settings__accent-swatch${hex ? "" : " settings__accent-swatch--default"}${isActive ? " settings__accent-swatch--active" : ""}`,
      attrs: { title: name, "aria-label": name, "aria-pressed": String(isActive) },
      onClick: () => {
        container.querySelectorAll(".settings__accent-swatch").forEach((s) => {
          s.classList.remove("settings__accent-swatch--active");
          s.setAttribute("aria-pressed", "false");
        });
        swatch.classList.add("settings__accent-swatch--active");
        swatch.setAttribute("aria-pressed", "true");
        applyAccent(hex, themeManager.theme);
        storage.saveSettings({ accentColor: hex });
      },
    });
    if (hex) swatch.style.backgroundColor = hex;
    container.appendChild(swatch);
  });

  return container;
}

function createDensitySelector(currentDensity: UserSettings["density"]): HTMLElement {
  const container = el("div", { className: "settings__segmented" });

  const comfy = el("button", {
    className: `settings__seg-btn${currentDensity === "comfortable" ? " settings__seg-btn--active" : ""}`,
    text: "Comfortable",
    onClick: () => {
      storage.saveSettings({ density: "comfortable" });
      comfy.classList.add("settings__seg-btn--active");
      compact.classList.remove("settings__seg-btn--active");
      document.body.classList.remove("density-compact");
    },
  });

  const compact = el("button", {
    className: `settings__seg-btn${currentDensity === "compact" ? " settings__seg-btn--active" : ""}`,
    text: "Compact",
    onClick: () => {
      storage.saveSettings({ density: "compact" });
      compact.classList.add("settings__seg-btn--active");
      comfy.classList.remove("settings__seg-btn--active");
      document.body.classList.add("density-compact");
    },
  });

  container.appendChild(comfy);
  container.appendChild(compact);
  return container;
}

function createVisualModeSelector(currentMode: AmbientVisualMode): HTMLElement {
  const select = el("select", {
    className: "settings__select",
    attrs: { "aria-label": "Ambient Visualizer Mode" },
  });

  const options: Array<{ val: AmbientVisualMode; label: string }> = [
    { val: "aurora", label: "Aurora (Ribbon waves)" },
    { val: "fluid", label: "Fluid (Organic metaballs)" },
    { val: "glow", label: "Glow (Pulsing bloom)" },
    { val: "cinematic", label: "Cinematic (Vignette backlight)" },
    { val: "minimal", label: "Minimal (Subtle gradient)" },
    { val: "none", label: "Disabled (Off)" },
  ];

  options.forEach(({ val, label }) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    if (val === currentMode) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    storage.saveSettings({ ambientMode: select.value as AmbientVisualMode });
  });

  return select;
}

function createFpsSelector(currentFps: number): HTMLElement {
  const select = el("select", {
    className: "settings__select",
    attrs: { "aria-label": "Visualizer FPS Limit" },
  });

  const options = [
    { val: 15, label: "15 FPS (Power Saver)" },
    { val: 30, label: "30 FPS (Recommended)" },
    { val: 60, label: "60 FPS (High Performance)" },
  ];

  options.forEach(({ val, label }) => {
    const opt = document.createElement("option");
    opt.value = String(val);
    opt.textContent = label;
    if (val === currentFps) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    storage.saveSettings({
      ambientFpsLimit: parseInt(select.value, 10) as 15 | 30 | 60,
    });
  });

  return select;
}

function createToggle(
  initialState: boolean,
  onChange: (state: boolean) => void,
): HTMLElement {
  let isChecked = initialState;

  const toggle = el("button", {
    className: `settings__toggle${isChecked ? " settings__toggle--active" : ""}`,
    attrs: {
      role: "switch",
      "aria-checked": String(isChecked),
    },
    children: [el("span", { className: "settings__toggle-handle" })],
    onClick: () => {
      isChecked = !isChecked;
      toggle.classList.toggle("settings__toggle--active", isChecked);
      toggle.setAttribute("aria-checked", String(isChecked));
      onChange(isChecked);
    },
  });

  return toggle;
}

function createThemeImportExport(): HTMLElement {
  const container = el("div", {
    className: "settings__actions-group",
    children: [
      el("button", {
        className: "settings__btn",
        text: "Export Theme JSON",
        onClick: () => {
          const settings = storage.getSettings();
          const blob = new Blob([JSON.stringify(settings, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "sonora-theme.json";
          a.click();
          URL.revokeObjectURL(url);
        },
      }),
      el("button", {
        className: "settings__btn",
        text: "Import Theme",
        onClick: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json";
          input.onchange = async () => {
            if (input.files && input.files[0]) {
              try {
                const text = await input.files[0].text();
                const json = JSON.parse(text);
                storage.saveSettings(json);
                if (json.theme === "dark" || json.theme === "light") {
                  themeManager.set(json.theme);
                }
                applyAccent(storage.getSettings().accentColor, themeManager.theme);
                alert("Theme configuration imported successfully!");
              } catch {
                alert("Failed to parse theme JSON file.");
              }
            }
          };
          input.click();
        },
      }),
    ],
  });

  return container;
}
