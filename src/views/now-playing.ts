/**
 * Now Playing View.
 *
 * Sonora's signature immersive visualizer experience.
 * Features WebGL ambient shaders, synchronized lyrics with click-to-seek,
 * high-res artwork display, and fullscreen immersion.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { playerEngine } from "@/lib/playback/engine";
import { LyricsController } from "@/lib/lyrics/synced-lyrics";
import { AmbientVisualRenderer } from "@/lib/visuals/ambient-renderer";
import { storage } from "@/lib/storage";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AmbientVisualMode, Track } from "@/types/music";

export function renderNowPlaying(container: HTMLElement): void {
  const currentTrack = playerEngine.currentTrack;
  const settings = storage.getSettings();

  // Create canvas for ambient WebGL visuals
  const canvas = document.createElement("canvas");
  canvas.className = "now-playing__canvas";

  const scrim = el("div", { className: "now-playing__scrim" });

  // Visual engine instance
  const visualEngine = new AmbientVisualRenderer(canvas);
  visualEngine.setMode(settings.ambientMode);
  visualEngine.setFpsLimit(settings.ambientFpsLimit);
  visualEngine.setIntensity(settings.ambientIntensity);

  // Synchronized lyrics controller
  const lyricsController = new LyricsController({
    onSeekRequest: (seconds) => {
      playerEngine.seekTo(seconds);
    },
  });

  const lyricsContainer = el("div", { className: "now-playing__lyrics" });
  lyricsController.bindContainer(lyricsContainer);

  // ── Top Bar Controls ────────────────────────────────────
  const closeBtn = el("button", {
    className: "now-playing__close-btn",
    html: icon("chevronLeft"),
    attrs: { "aria-label": "Close Now Playing", title: "Back to library" },
    onClick: () => {
      window.history.back();
    },
  });

  // Visual mode selector
  const modes: Array<{ mode: AmbientVisualMode; label: string }> = [
    { mode: "aurora", label: "Aurora" },
    { mode: "fluid", label: "Fluid" },
    { mode: "glow", label: "Glow" },
    { mode: "cinematic", label: "Cinema" },
    { mode: "minimal", label: "Minimal" },
    { mode: "none", label: "Off" },
  ];

  const visualSelector = el("div", {
    className: "now-playing__visual-selector",
    children: modes.map(({ mode, label }) => {
      const chip = el("button", {
        className: `now-playing__visual-chip${settings.ambientMode === mode ? " now-playing__visual-chip--active" : ""}`,
        text: label,
        onClick: () => {
          visualSelector.querySelectorAll(".now-playing__visual-chip").forEach((c) => {
            c.classList.remove("now-playing__visual-chip--active");
          });
          chip.classList.add("now-playing__visual-chip--active");
          visualEngine.setMode(mode);
          storage.saveSettings({ ambientMode: mode });
        },
      });
      return chip;
    }),
  });

  // Fullscreen button
  let isFullscreen = false;
  const fullscreenBtn = el("button", {
    className: "now-playing__fs-btn",
    html: icon("fullscreen"),
    attrs: { "aria-label": "Toggle fullscreen", title: "Fullscreen" },
    onClick: async () => {
      try {
        const appWindow = getCurrentWindow();
        isFullscreen = !isFullscreen;
        await appWindow.setFullscreen(isFullscreen);
      } catch {
        // Fallback to DOM fullscreen API
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      }
    },
  });

  const topBar = el("div", {
    className: "now-playing__topbar",
    children: [closeBtn, visualSelector, fullscreenBtn],
  });

  // ── Left: Artwork & Info ────────────────────────────────
  const artImg = el("img", {
    className: "now-playing__art-img",
    attrs: {
      src: currentTrack?.artworkUrl || "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
      alt: currentTrack?.title || "Track artwork",
    },
  });

  const artWrapper = el("div", {
    className: "now-playing__art-wrapper",
    children: [artImg],
  });

  const titleEl = el("h2", {
    className: "now-playing__title truncate",
    text: currentTrack?.title || "No track playing",
  });

  const artistEl = el("p", {
    className: "now-playing__artist truncate",
    text: currentTrack?.artist || "Select a song from the library",
  });

  const albumEl = el("p", {
    className: "now-playing__album truncate",
    text: currentTrack?.album || "",
  });

  const infoCol = el("div", {
    className: "now-playing__left",
    children: [
      artWrapper,
      el("div", {
        className: "now-playing__info",
        children: [titleEl, artistEl, albumEl],
      }),
    ],
  });

  const body = el("div", {
    className: "now-playing__body",
    children: [infoCol, lyricsContainer],
  });

  const content = el("div", {
    className: "now-playing__content",
    children: [topBar, body],
  });

  const nowPlayingRoot = el("div", {
    className: "now-playing",
    children: [canvas, scrim, content],
  });

  container.appendChild(nowPlayingRoot);

  // ── Subscriptions ───────────────────────────────────────
  const unsubs: Array<() => void> = [];

  unsubs.push(
    playerEngine.on("timeUpdate", ({ currentTime }) => {
      lyricsController.updateTime(currentTime);
    }),
  );

  unsubs.push(
    playerEngine.on("trackChange", (track: Track | null) => {
      if (track) {
        artImg.src = track.artworkUrl;
        titleEl.textContent = track.title;
        artistEl.textContent = track.artist;
        albumEl.textContent = track.album || "";
      }
    }),
  );

  unsubs.push(
    playerEngine.on("paletteChange", (palette) => {
      visualEngine.setPalette(palette);
    }),
  );

  unsubs.push(
    playerEngine.on("lyricsChange", (lyrics) => {
      lyricsController.setLyrics(lyrics);
    }),
  );

  // Clean up when this view is replaced / unmounted
  const checkInterval = setInterval(() => {
    if (!document.body.contains(nowPlayingRoot)) {
      clearInterval(checkInterval);
      visualEngine.destroy();
      lyricsController.destroy();
      unsubs.forEach((unsub) => unsub());
    }
  }, 500);
}
