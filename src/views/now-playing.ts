/**
 * Now Playing View.
 *
 * Sonora's signature immersive visualizer experience.
 * Features WebGL ambient shaders, synchronized lyrics with click-to-seek,
 * high-res artwork display, and fullscreen immersion.
 */

import { el } from "@/lib/dom";
import { icon } from "@/icons";
import { formatCompactQualityBadge } from "@/lib/audio-quality";
import { openAlbum, openArtist } from "@/lib/navigation";
import { playerEngine } from "@/lib/playback/engine";
import { LyricsController } from "@/lib/lyrics/synced-lyrics";
import { AmbientVisualRenderer } from "@/lib/visuals/ambient-renderer";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Track, UserSettings } from "@/types/music";

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
  type LyricsSizeOption = NonNullable<UserSettings["lyricsFontSize"]>;
  const sizeLabels: Record<LyricsSizeOption, string> = {
    sm: "Small",
    md: "Medium",
    lg: "Large",
    off: "Off",
  };
  const sizeCycle: LyricsSizeOption[] = ["sm", "md", "lg", "off"];
  let lyricsSize: LyricsSizeOption =
    settings.lyricsFontSize && sizeCycle.includes(settings.lyricsFontSize)
      ? settings.lyricsFontSize
      : "md";

  const formatLyricsLabel = (size: LyricsSizeOption): string =>
    size === "off" ? "Lyrics: Off" : `Lyrics text size: ${sizeLabels[size]}`;

  const fontBtn = el("button", {
    className: `now-playing__mode-btn${lyricsSize === "off" ? " now-playing__mode-btn--off" : ""}`,
    text: "Aa",
    attrs: {
      type: "button",
      "aria-label": formatLyricsLabel(lyricsSize),
      title: formatLyricsLabel(lyricsSize),
      "aria-pressed": String(lyricsSize === "off"),
    },
    onClick: () => {
      const nextIdx = (sizeCycle.indexOf(lyricsSize) + 1) % sizeCycle.length;
      lyricsSize = sizeCycle[nextIdx];
      storage.saveSettings({ lyricsFontSize: lyricsSize });
      nowPlayingRoot.dataset.lyricsSize = lyricsSize;
      const label = formatLyricsLabel(lyricsSize);
      fontBtn.setAttribute("aria-label", label);
      fontBtn.setAttribute("title", label);
      fontBtn.setAttribute("aria-pressed", String(lyricsSize === "off"));
      fontBtn.classList.toggle("now-playing__mode-btn--off", lyricsSize === "off");
    },
  });

  const qualityBadgeBtn = el("button", {
    className: "now-playing__quality-badge",
    attrs: {
      type: "button",
      title: "Open audio quality settings",
      "aria-label": "Audio quality settings",
      hidden: "",
    },
    onClick: () => {
      if (immersive) void setImmersive(false);
      router.navigate("/settings");
    },
  });

  const updateQualityBadge = () => {
    const currentSettings = storage.getSettings();
    const label = formatCompactQualityBadge(currentSettings, playerEngine.currentState.audioInfo);
    qualityBadgeBtn.toggleAttribute("hidden", !label);
    qualityBadgeBtn.classList.toggle("now-playing__quality-badge--lossless", currentSettings.audioQuality === "lossless");
    if (label) {
      qualityBadgeBtn.textContent = label;
      qualityBadgeBtn.setAttribute("aria-label", `Audio quality: ${label}. Open settings.`);
    }
  };
  updateQualityBadge();

  const topBar = el("div", {
    className: "now-playing__topbar",
    children: [
      closeBtn,
      el("div", {
        className: "now-playing__topbar-actions",
        children: [qualityBadgeBtn, fontBtn, fullscreenBtn],
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

  const openCurrentArtist = () => {
    const activeTrack = playerEngine.currentTrack;
    if (!activeTrack?.artist.trim()) return;
    if (immersive) void setImmersive(false);
    openArtist({ id: activeTrack.artistId, name: activeTrack.artist });
  };

  const openCurrentAlbum = () => {
    const activeTrack = playerEngine.currentTrack;
    const albumTitle = activeTrack?.album?.trim();
    if (!activeTrack || !albumTitle) return;
    if (immersive) void setImmersive(false);
    openAlbum({
      id: activeTrack.albumId,
      title: albumTitle,
      artist: activeTrack.artist,
      artworkUrl: activeTrack.artworkUrl,
    });
  };

  const artistEl = el("button", {
    className: "now-playing__artist truncate",
    text: currentTrack?.artist || "Select a song from the library",
    attrs: {
      type: "button",
      ...(currentTrack?.artist.trim()
        ? { title: `Open artist: ${currentTrack.artist}`, "aria-label": `Open artist ${currentTrack.artist}` }
        : { disabled: "" }),
    },
    onClick: openCurrentArtist,
  });

  const albumEl = el("button", {
    className: "now-playing__album truncate",
    text: currentTrack?.album || "",
    attrs: {
      type: "button",
      ...(currentTrack?.album?.trim()
        ? { title: `Open album: ${currentTrack.album}`, "aria-label": `Open album ${currentTrack.album}` }
        : { disabled: "" }),
    },
    onClick: openCurrentAlbum,
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
        const hasArtist = Boolean(track.artist.trim());
        artistEl.toggleAttribute("disabled", !hasArtist);
        if (hasArtist) {
          artistEl.setAttribute("title", `Open artist: ${track.artist}`);
          artistEl.setAttribute("aria-label", `Open artist ${track.artist}`);
        } else {
          artistEl.removeAttribute("title");
          artistEl.removeAttribute("aria-label");
        }
        const albumTitle = track.album?.trim() ?? "";
        albumEl.textContent = albumTitle;
        albumEl.toggleAttribute("disabled", !albumTitle);
        if (albumTitle) {
          albumEl.setAttribute("title", `Open album: ${albumTitle}`);
          albumEl.setAttribute("aria-label", `Open album ${albumTitle}`);
        } else {
          albumEl.removeAttribute("title");
          albumEl.removeAttribute("aria-label");
        }
      } else {
        artImg.src = "/artwork-placeholder.svg";
        artImg.alt = "Track artwork";
        titleEl.textContent = "No track playing";
        artistEl.textContent = "Select a song from the library";
        artistEl.setAttribute("disabled", "");
        artistEl.removeAttribute("title");
        artistEl.removeAttribute("aria-label");
        albumEl.textContent = "";
        albumEl.setAttribute("disabled", "");
        albumEl.removeAttribute("title");
        albumEl.removeAttribute("aria-label");
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

  unsubs.push(playerEngine.on("stateChange", updateQualityBadge));
  unsubs.push(storage.on("settingsChange", updateQualityBadge));

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
