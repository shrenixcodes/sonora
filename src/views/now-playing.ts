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
import { router } from "@/lib/router";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Track } from "@/types/music";

export function renderNowPlaying(container: HTMLElement): void {
  // Ensure scrolled views don't offset the absolute-positioned Now Playing stage.
  if (container.parentElement) container.parentElement.scrollTop = 0;
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

  // Opening part-way through a song misses the events that carried the lyrics
  // and the artwork colors, so take what the engine already holds and line the
  // words up with where the song is now.
  lyricsController.setLyrics(playerEngine.currentLyrics);
  lyricsController.updateTime(playerEngine.currentState.currentTime);
  const openingPalette = playerEngine.currentPalette;
  if (openingPalette) visualEngine.setPalette(openingPalette);

  // ── Top Bar Controls ────────────────────────────────────
  const closeBtn = el("button", {
    className: "now-playing__close-btn",
    html: icon("chevronLeft"),
    attrs: { "aria-label": "Close Now Playing", title: "Back to library" },
    onClick: () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.navigate("/");
      }
    },
  });

  // ── Immersive lyrics ──────────────────────
  // Not the same thing as a maximized window: the rest of the interface steps
  // aside and the screen becomes artwork on the left, lyrics on the right.
  let immersive = false;

  const applyImmersiveUi = (on: boolean): void => {
    immersive = on;
    if (on) document.documentElement.dataset.immersive = "";
    else delete document.documentElement.dataset.immersive;
    fullscreenBtn.innerHTML = icon(on ? "minimize" : "fullscreen");
    fullscreenBtn.setAttribute("aria-pressed", String(on));
    const label = on ? "Leave fullscreen lyrics" : "Fullscreen lyrics";
    fullscreenBtn.setAttribute("title", label);
    fullscreenBtn.setAttribute("aria-label", label);
    requestAnimationFrame(() => visualEngine.handleResize());
  };

  const setImmersive = async (on: boolean): Promise<void> => {
    applyImmersiveUi(on);

    try {
      if (isTauri()) {
        await getCurrentWindow().setFullscreen(on);
      } else if (on && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (!on && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) {
      // The presentation still stands if the window refuses to go fullscreen.
      console.error("[now-playing] fullscreen failed:", err);
    }
  };

  const onFullscreenChange = (): void => {
    if (!isTauri() && immersive && !document.fullscreenElement) {
      applyImmersiveUi(false);
    }
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  const fullscreenBtn = el("button", {
    className: "now-playing__fs-btn",
    html: icon("fullscreen"),
    attrs: {
      "aria-label": "Fullscreen lyrics",
      title: "Fullscreen lyrics",
      "aria-pressed": "false",
    },
    onClick: () => void setImmersive(!immersive),
  });

  // Escape is the way out of the presentation.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && immersive) {
      e.preventDefault();
      void setImmersive(false);
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // ── Lyrics typography scaling ─────────────
  let lyricsSize: "sm" | "md" | "lg" = settings.lyricsFontSize ?? "md";
  const sizeLabels: Record<"sm" | "md" | "lg", string> = {
    sm: "Small",
    md: "Medium",
    lg: "Large",
  };
  const sizeCycle: Array<"sm" | "md" | "lg"> = ["sm", "md", "lg"];

  const fontBtn = el("button", {
    className: "now-playing__mode-btn",
    text: "Aa",
    attrs: {
      "aria-label": `Lyrics text size: ${sizeLabels[lyricsSize]}`,
      title: `Lyrics text size: ${sizeLabels[lyricsSize]}`,
    },
    onClick: () => {
      const nextIdx = (sizeCycle.indexOf(lyricsSize) + 1) % sizeCycle.length;
      lyricsSize = sizeCycle[nextIdx];
      storage.saveSettings({ lyricsFontSize: lyricsSize });
      nowPlayingRoot.dataset.lyricsSize = lyricsSize;
      const label = `Lyrics text size: ${sizeLabels[lyricsSize]}`;
      fontBtn.setAttribute("aria-label", label);
      fontBtn.setAttribute("title", label);
    },
  });

  const topBar = el("div", {
    className: "now-playing__topbar",
    children: [
      closeBtn,
      el("div", {
        className: "now-playing__topbar-actions",
        children: [fontBtn, fullscreenBtn],
      }),
    ],
  });

  // ── Left: Artwork & Info ────────────────────────────────
  const artImg = el("img", {
    className: "now-playing__art-img",
    attrs: {
      src: currentTrack?.artworkUrl || "/artwork-placeholder.svg",
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
    attrs: { "data-lyrics-size": lyricsSize },
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
        artImg.src = track.artworkUrl || "/artwork-placeholder.svg";
        artImg.alt = track.title || "Track artwork";
        titleEl.textContent = track.title;
        artistEl.textContent = track.artist;
        albumEl.textContent = track.album || "";
      } else {
        artImg.src = "/artwork-placeholder.svg";
        artImg.alt = "Track artwork";
        titleEl.textContent = "No track playing";
        artistEl.textContent = "Select a song from the library";
        albumEl.textContent = "";
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

  // Clean up immediately when leaving Now Playing
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    // Leaving the page must not strand the window in a lyrics presentation.
    if (immersive) void setImmersive(false);
    visualEngine.destroy();
    lyricsController.destroy();
    unsubs.forEach((unsub) => unsub());
  };

  const stopNav = router.onNavigate((path) => {
    if (path === "/now-playing") return;
    destroy();
    stopNav();
  });
}
