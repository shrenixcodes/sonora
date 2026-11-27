/**
 * Settings & Appearance Studio View.
 *
 * Full application customization including theme switcher, accent color palette,
 * interface density, ambient visual parameters, audio settings, and theme import/export.
 */

import { el } from "@/lib/dom";
import {
  AUDIO_ENHANCEMENT_OPTIONS,
  AUDIO_QUALITY_OPTIONS,
  audioEnhancementOption,
  audioQualityOption,
  formatAudioTelemetry,
} from "@/lib/audio-quality";
import { FALLBACK_APP_INFO, FALLBACK_PLATFORM_INFO, formatVersionSummary, getAppRuntimeInfo } from "@/lib/app-info";
import { showNoticeDialog } from "@/components/modal-dialog";
import { playerEngine } from "@/lib/playback/engine";
import { themeManager } from "@/lib/theme";
import { applyAccent } from "@/lib/accent";
import { syncShellAccent } from "@/lib/ambience";
import { ytmBridge } from "@/lib/playback/ytm-bridge";
import { account } from "@/lib/ytm/account";
import { router } from "@/lib/router";
import { storage } from "@/lib/storage";
import { showLaunchSplash } from "@/lib/visuals/splash-screen";
import { triggerRestoreAnimation } from "@/lib/visuals/symbiote";
import type { UserSettings, AmbientVisualMode, AudioEnhancementProfile, AudioQualityMode, PlaybackState } from "@/types/music";

const VALID_AMBIENT_MODES = new Set<AmbientVisualMode>(["aurora", "fluid", "glow", "cinematic", "minimal", "none"]);
const VALID_FPS_LIMITS = new Set<UserSettings["ambientFpsLimit"]>([15, 30, 60]);
const VALID_DENSITIES = new Set<UserSettings["density"]>(["comfortable", "compact"]);
const VALID_LYRICS_SIZES = new Set<NonNullable<UserSettings["lyricsFontSize"]>>(["sm", "md", "lg", "off"]);

export type ThemeSettings = Pick<
  UserSettings,
  "theme" | "accentColor" | "ambientMode" | "ambientFpsLimit" | "ambientIntensity" | "density" | "lyricsFontSize"
>;

export function pickThemeSettings(settings: UserSettings): ThemeSettings {
  return {
    theme: settings.theme,
    accentColor: settings.accentColor,
    ambientMode: settings.ambientMode,
    ambientFpsLimit: settings.ambientFpsLimit,
    ambientIntensity: settings.ambientIntensity,
    density: settings.density,
    lyricsFontSize: settings.lyricsFontSize ?? "md",
  };
}

export function parseThemeImport(raw: unknown): Partial<ThemeSettings> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme configuration must be a JSON object.");
  }
  const input = raw as Record<string, unknown>;
  const patch: Partial<ThemeSettings> = {};

  if (input.theme === "dark" || input.theme === "light") patch.theme = input.theme;
  if (input.accentColor === null || (typeof input.accentColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(input.accentColor))) {
    patch.accentColor = input.accentColor;
  }
  if (typeof input.ambientMode === "string" && VALID_AMBIENT_MODES.has(input.ambientMode as AmbientVisualMode)) {
    patch.ambientMode = input.ambientMode as AmbientVisualMode;
  }
  if (typeof input.ambientFpsLimit === "number" && VALID_FPS_LIMITS.has(input.ambientFpsLimit as UserSettings["ambientFpsLimit"])) {
    patch.ambientFpsLimit = input.ambientFpsLimit as UserSettings["ambientFpsLimit"];
  }
  if (typeof input.ambientIntensity === "number" && Number.isFinite(input.ambientIntensity)) {
    patch.ambientIntensity = Math.max(0.1, Math.min(1, input.ambientIntensity));
  }
  if (typeof input.density === "string" && VALID_DENSITIES.has(input.density as UserSettings["density"])) {
    patch.density = input.density as UserSettings["density"];
  }
  if (typeof input.lyricsFontSize === "string" && VALID_LYRICS_SIZES.has(input.lyricsFontSize as NonNullable<UserSettings["lyricsFontSize"]>)) {
    patch.lyricsFontSize = input.lyricsFontSize as UserSettings["lyricsFontSize"];
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No valid Sonora theme settings were found in this file.");
  }
  return patch;
}

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

      // ── Account ──────────────────────────────────────────
      createSettingsSection("Account", [createAccountRow()]),

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

        // Lyrics Text Size
        createSettingRow(
          "Lyrics Text Size",
          "Scale synchronized lyrics font size or hide them in Now Playing",
          createLyricsSizeSelector(currentSettings.lyricsFontSize),
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

        // Fluid Animations & Launch Splash
        createSettingRow(
          "Interface Animations",
          "Preview the launch splash and the liquid taskbar restore animation (F8 / F9)",
          createAnimationTester(),
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
        createAudioQualityRow(currentSettings.audioQuality),
        createAudioEnhancementRow(currentSettings.audioEnhancement),
        createSettingRow(
          "Normalize Volume",
          "Keep loudness consistent across quiet and loud songs using track gain leveling and peak protection",
          createToggle(currentSettings.normalizeVolume, (val) => {
            storage.saveSettings({ normalizeVolume: val });
          }),
        ),
        createAudioStatusRow(),
        createSettingRow(
          "Autoplay Next",
          "Continue playing recommended music when queue reaches the end",
          createToggle(currentSettings.autoPlayNext, (val) => {
            storage.saveSettings({ autoPlayNext: val });
          }),
        ),
        createSettingRow(
          "Discord Rich Presence",
          "Show current song, artist, and playback progress on your Discord profile",
          createToggle(currentSettings.enableDiscordRpc, (val) => {
            storage.saveSettings({ enableDiscordRpc: val });
          }),
        ),
      ]),

      // ── YouTube Music Service ────────────────────────────
      // ── Keyboard Shortcuts ───────────────────────────────
      createSettingsSection("Keyboard Shortcuts", [
        createShortcutRow("Ctrl + K", "Focus search"),
        createShortcutRow("Space", "Play / Pause playback"),
        createShortcutRow("← / →", "Seek 5 seconds backward / forward"),
        createShortcutRow("↑ / ↓", "Adjust volume up / down"),
        createShortcutRow("M", "Mute / Unmute audio"),
        createShortcutRow("L", "Toggle like for current track"),
        createShortcutRow("F", "Toggle fullscreen Now Playing"),
      ]),

      // ── About ────────────────────────────────────────────
      createSettingsSection("About Sonora", [
        createVersionRow(),
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

/** YouTube Music sign-in status with a Sign in / Sign out button that follows it. */
function createAccountRow(): HTMLElement {
  const description = el("span", { className: "settings__row-description" });
  const label = el("span", { className: "settings__row-label", text: "YouTube Music" });
  const avatar = el("img", { className: "settings__avatar", attrs: { alt: "", hidden: "" } });
  const button = el("button", { className: "btn btn--secondary", attrs: { type: "button" } });
  let busy = false;

  const render = () => {
    if (!ytmBridge.available) {
      description.textContent = "Signing in is available in the Sonora desktop app.";
      button.textContent = "Sign in";
      button.setAttribute("disabled", "");
      return;
    }
    const signedIn = account.isSignedIn;
    const profile = signedIn ? account.profile : null;
    label.textContent = profile ? profile.name : "YouTube Music";
    avatar.toggleAttribute("hidden", !profile?.photoUrl);
    if (profile?.photoUrl) avatar.setAttribute("src", profile.photoUrl);
    description.textContent =
      signedIn === null
        ? "Checking YouTube Music…"
        : profile
          ? [profile.email ?? profile.handle, "Signed in to YouTube Music"].filter(Boolean).join(" · ")
          : signedIn
            ? "Signed in. Home, likes and Premium come from your account."
            : "Sign in on YouTube Music's own page for your library, likes and Premium. The window closes by itself when you're done.";
    button.textContent = signedIn ? "Sign out" : "Sign in";
    // Still offer sign-in while the status is unknown, so a slow page can't lock the button.
    button.toggleAttribute("disabled", busy);
  };

  button.addEventListener("click", async () => {
    busy = true;
    render();
    try {
      if (account.isSignedIn) {
        await ytmBridge.signOut();
        account.update(false);
      } else {
        account.beginSignIn();
        await ytmBridge.setSignInVisible(true);
      }
    } catch (err) {
      console.error("[settings] YouTube Music account action failed:", err);
      description.textContent = "That didn't work. Try again in a moment.";
    } finally {
      busy = false;
      button.toggleAttribute("disabled", false);
    }
  });

  render();
  const stopListening = account.on("change", render);
  const stopProfile = account.on("profile", render);
  const stopNav = router.onNavigate((path) => {
    if (path === "/settings") return;
    stopListening();
    stopProfile();
    stopNav();
  });

  return el("div", {
    className: "settings__row",
    children: [
      el("div", {
        className: "settings__account",
        children: [
          avatar,
          el("div", { className: "settings__row-info", children: [label, description] }),
        ],
      }),
      button,
    ],
  });
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
        const updated = storage.saveSettings({ accentColor: hex });
        const shell = document.getElementById("app");
        if (shell) syncShellAccent(playerEngine.currentPalette, themeManager.theme, shell, updated.accentColor);
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

function createLyricsSizeSelector(currentSize: UserSettings["lyricsFontSize"] = "md"): HTMLElement {
  const container = el("div", { className: "settings__segmented" });
  const sizes: Array<{ val: NonNullable<UserSettings["lyricsFontSize"]>; label: string }> = [
    { val: "sm", label: "Small" },
    { val: "md", label: "Medium" },
    { val: "lg", label: "Large" },
    { val: "off", label: "Off" },
  ];

  const activeSize = sizes.some((s) => s.val === currentSize) ? currentSize! : "md";
  const buttons: HTMLElement[] = [];
  sizes.forEach(({ val, label }) => {
    const isActive = activeSize === val;
    const btn = el("button", {
      className: `settings__seg-btn${isActive ? " settings__seg-btn--active" : ""}`,
      text: label,
      attrs: { type: "button", "aria-pressed": String(isActive) },
      onClick: () => {
        storage.saveSettings({ lyricsFontSize: val });
        buttons.forEach((b) => {
          b.classList.remove("settings__seg-btn--active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("settings__seg-btn--active");
        btn.setAttribute("aria-pressed", "true");
      },
    });
    buttons.push(btn);
    container.appendChild(btn);
  });

  return container;
}

function createAudioQualityRow(currentQuality: AudioQualityMode): HTMLElement {
  const row = createSettingRow(
    "Audio Quality",
    audioQualityOption(currentQuality).description,
    el("div", { className: "settings__segmented settings__segmented--quality" }),
  );
  const description = row.querySelector<HTMLElement>(".settings__row-description")!;
  const container = row.querySelector<HTMLElement>(".settings__segmented")!;
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", "Audio Quality");

  const buttons = new Map<AudioQualityMode, HTMLElement>();
  for (const option of AUDIO_QUALITY_OPTIONS) {
    const isActive = option.id === currentQuality;
    const isLossless = option.id === "lossless";
    const btn = el("button", {
      className: `settings__seg-btn${isLossless ? " settings__seg-btn--lossless" : ""}${isActive ? " settings__seg-btn--active" : ""}`,
      text: option.label,
      attrs: {
        type: "button",
        role: "radio",
        "aria-checked": String(isActive),
        "data-audio-quality": option.id,
        title: option.description,
      },
      onClick: () => {
        storage.saveSettings({ audioQuality: option.id });
        description.textContent = option.description;
        for (const [id, item] of buttons) {
          const active = id === option.id;
          item.classList.toggle("settings__seg-btn--active", active);
          item.setAttribute("aria-checked", String(active));
        }
      },
    });
    buttons.set(option.id, btn);
    container.appendChild(btn);
  }

  return row;
}

function createAudioEnhancementRow(currentProfile: AudioEnhancementProfile): HTMLElement {
  const select = el("select", {
    className: "settings__select",
    attrs: { "aria-label": "Audio Enhancement Profile" },
  }) as HTMLSelectElement;

  for (const option of AUDIO_ENHANCEMENT_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = option.id;
    opt.textContent = option.label;
    if (option.id === currentProfile) opt.selected = true;
    select.appendChild(opt);
  }

  const row = createSettingRow(
    "Audio Enhancement",
    audioEnhancementOption(currentProfile).description,
    select,
  );
  const description = row.querySelector<HTMLElement>(".settings__row-description")!;

  select.addEventListener("change", () => {
    const next = select.value as AudioEnhancementProfile;
    storage.saveSettings({ audioEnhancement: next });
    description.textContent = audioEnhancementOption(next).description;
  });

  return row;
}

function createAudioStatusRow(): HTMLElement {
  const tag = el("span", { className: "settings__tag" });
  const row = createSettingRow("Audio Engine & Stream", "", tag);
  const description = row.querySelector<HTMLElement>(".settings__row-description")!;

  const update = (nextState?: PlaybackState) => {
    const settings = storage.getSettings();
    const state = nextState ?? playerEngine.currentState;
    const isLossless = settings.audioQuality === "lossless" && !state.audioInfo?.fallbackUsed;
    tag.classList.toggle("settings__tag--lossless", isLossless);
    if (state.audioInfo?.fallbackUsed && state.audioInfo.effectiveQuality) {
      tag.textContent = `Best (${audioQualityOption(state.audioInfo.effectiveQuality).label})`;
    } else {
      tag.textContent = audioQualityOption(settings.audioQuality).badge;
    }
    description.textContent = formatAudioTelemetry(settings, state.audioInfo);
  };

  update();
  const stopEngine = playerEngine.on("stateChange", (state) => update(state));
  const stopStorage = storage.on("settingsChange", () => update());
  const stopNav = router.onNavigate((path) => {
    if (path === "/settings") return;
    stopEngine();
    stopStorage();
    stopNav();
  });

  return row;
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

function createAnimationTester(): HTMLElement {
  const container = el("div", {
    className: "settings__actions-group",
    children: [
      el("button", {
        className: "settings__btn",
        text: "Preview Launch Splash",
        onClick: () => {
          showLaunchSplash({ force: true }).catch(() => {});
        },
      }),
      el("button", {
        className: "settings__btn",
        text: "Preview Taskbar Restore",
        onClick: () => {
          triggerRestoreAnimation({ force: true });
        },
      }),
    ],
  });

  return container;
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

function createVersionRow(): HTMLElement {
  const row = createSettingRow(
    "Sonora Desktop",
    formatVersionSummary(FALLBACK_APP_INFO, FALLBACK_PLATFORM_INFO),
    el("span", { className: "settings__tag", text: "Production Ready" }),
  );
  const description = row.querySelector<HTMLElement>(".settings__row-description");
  void getAppRuntimeInfo().then(({ app, platform }) => {
    if (description) {
      description.textContent = formatVersionSummary(app, platform);
    }
  });
  return row;
}

function createThemeImportExport(): HTMLElement {
  const container = el("div", {
    className: "settings__actions-group",
    children: [
      el("button", {
        className: "settings__btn",
        text: "Export Theme JSON",
        onClick: () => {
          const themeConfig = pickThemeSettings(storage.getSettings());
          const blob = new Blob([JSON.stringify(themeConfig, null, 2)], {
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
                const themePatch = parseThemeImport(JSON.parse(text));
                const updated = storage.saveSettings(themePatch);
                if (themePatch.theme) {
                  themeManager.set(themePatch.theme);
                }
                document.body.classList.toggle("density-compact", updated.density === "compact");
                applyAccent(updated.accentColor, themeManager.theme);
                const shell = document.getElementById("app");
                if (shell) syncShellAccent(playerEngine.currentPalette, themeManager.theme, shell, updated.accentColor);
                router.refresh();
              } catch (err) {
                showNoticeDialog({
                  title: "Could not import theme",
                  message: err instanceof Error ? err.message : "Failed to parse theme JSON file.",
                });
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
