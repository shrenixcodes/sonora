/**
 * Player bar — persistent playback controls.
 *
 * Fully integrated with Sonora's PlaybackEngine, storage, and navigation.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import type { Track, PlaybackState } from "@/types/music";

class PlayerBar {
  private elements: {
    root: HTMLElement;
    playBtn: HTMLElement;
    shuffleBtn: HTMLElement;
    repeatBtn: HTMLElement;
    title: HTMLElement;
    artist: HTMLElement;
    artwork: HTMLElement;
    likeBtn: HTMLElement;
    currentTime: HTMLElement;
    duration: HTMLElement;
    progressBar: HTMLElement;
    progressFill: HTMLElement;
    volumeBar: HTMLElement;
    volumeFill: HTMLElement;
    volumeBtn: HTMLElement;
    lyricsBtn: HTMLElement;
    nowPlayingBtn: HTMLElement;
  } | null = null;

  private isDraggingProgress = false;
  private isDraggingVolume = false;

  render(): HTMLElement {
    // ── Controls ──────────────────────────────────────────
    const shuffleBtn = el("button", {
      className: "player__btn",
      html: icon("shuffle"),
      attrs: { "aria-label": "Shuffle", title: "Shuffle" },
      onClick: () => playerEngine.toggleShuffle(),
    });

    const skipBackBtn = el("button", {
      className: "player__btn",
      html: icon("skipBack"),
      attrs: { "aria-label": "Previous", title: "Previous" },
      onClick: () => playerEngine.previous(),
    });

    const playBtn = el("button", {
      className: "player__play-btn",
      html: icon("play"),
      attrs: { "aria-label": "Play", title: "Play" },
      onClick: () => playerEngine.togglePlay(),
    });

    const skipFwdBtn = el("button", {
      className: "player__btn",
      html: icon("skipForward"),
      attrs: { "aria-label": "Next", title: "Next" },
      onClick: () => playerEngine.next(),
    });

    const repeatBtn = el("button", {
      className: "player__btn",
      html: icon("repeat"),
      attrs: { "aria-label": "Repeat", title: "Repeat" },
      onClick: () => playerEngine.cycleRepeat(),
    });

    // ── Progress Bar ──────────────────────────────────────
    const progressFill = el("div", { className: "player__progress-fill" });
    progressFill.style.width = "0%";

    const progressBar = el("div", {
      className: "player__progress-bar",
      children: [progressFill],
    });

    const currentTime = el("span", {
      className: "player__time",
      text: formatTime(0),
    });

    const duration = el("span", {
      className: "player__time",
      text: formatTime(0),
    });

    // ── Track Info ────────────────────────────────────────
    const artwork = el("div", {
      className: "player__artwork",
      attrs: { role: "button", title: "Open Now Playing" },
      onClick: () => router.navigate("/now-playing"),
    });

    const title = el("span", {
      className: "player__title truncate",
      text: "Nothing playing",
      attrs: { role: "button", title: "Open Now Playing" },
      onClick: () => router.navigate("/now-playing"),
    });

    const artist = el("span", {
      className: "player__artist truncate",
      text: "Select a song to start listening",
    });

    const likeBtn = el("button", {
      className: "player__like-btn",
      html: icon("heart"),
      attrs: { "aria-label": "Like", title: "Like" },
      onClick: () => this.handleToggleLike(),
    });

    // ── Volume ────────────────────────────────────────────
    const initialVol = playerEngine.currentState.volume;
    const volumeFill = el("div", { className: "player__volume-fill" });
    volumeFill.style.width = `${initialVol * 100}%`;

    const volumeBar = el("div", {
      className: "player__volume-slider",
      children: [volumeFill],
    });

    const volumeBtn = el("button", {
      className: "player__volume-btn",
      html: icon(initialVol > 0.5 ? "volumeHigh" : initialVol > 0 ? "volumeLow" : "volumeMute"),
      attrs: { "aria-label": "Volume", title: "Mute/Unmute" },
      onClick: () => playerEngine.toggleMute(),
    });

    // ── Extras ────────────────────────────────────────────
    const lyricsBtn = el("button", {
      className: "player__extra-btn",
      html: icon("lyrics"),
      attrs: { "aria-label": "Lyrics", title: "Lyrics" },
      onClick: () => router.navigate("/now-playing"),
    });

    const nowPlayingBtn = el("button", {
      className: "player__extra-btn",
      html: icon("fullscreen"),
      attrs: { "aria-label": "Now Playing", title: "Now Playing" },
      onClick: () => router.navigate("/now-playing"),
    });

    const root = el("div", {
      className: "player",
      children: [
        // Left: Track Info
        el("div", {
          className: "player__track",
          children: [
            artwork,
            el("div", { className: "player__meta", children: [title, artist] }),
            likeBtn,
          ],
        }),

        // Center: Controls + Progress
        el("div", {
          className: "player__controls",
          children: [
            el("div", {
              className: "player__buttons",
              children: [shuffleBtn, skipBackBtn, playBtn, skipFwdBtn, repeatBtn],
            }),
            el("div", {
              className: "player__progress",
              children: [currentTime, progressBar, duration],
            }),
          ],
        }),

        // Right: Volume & Extras
        el("div", {
          className: "player__right",
          children: [
            el("div", {
              className: "player__volume",
              children: [volumeBtn, volumeBar],
            }),
            lyricsBtn,
            nowPlayingBtn,
          ],
        }),
      ],
    });

    this.elements = {
      root,
      playBtn,
      shuffleBtn,
      repeatBtn,
      title,
      artist,
      artwork,
      likeBtn,
      currentTime,
      duration,
      progressBar,
      progressFill,
      volumeBar,
      volumeFill,
      volumeBtn,
      lyricsBtn,
      nowPlayingBtn,
    };

    this.setupInteractivity();
    this.subscribeToEngine();

    return root;
  }

  private setupInteractivity(): void {
    if (!this.elements) return;
    const { progressBar, volumeBar } = this.elements;

    // Progress bar seeking
    progressBar.addEventListener("pointerdown", (e) => {
      this.isDraggingProgress = true;
      this.seekFromPointer(e);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (this.isDraggingProgress) {
          this.seekFromPointer(moveEvent);
        }
      };

      const onPointerUp = () => {
        this.isDraggingProgress = false;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });

    // Volume bar scrubbing
    volumeBar.addEventListener("pointerdown", (e) => {
      this.isDraggingVolume = true;
      this.volumeFromPointer(e);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (this.isDraggingVolume) {
          this.volumeFromPointer(moveEvent);
        }
      };

      const onPointerUp = () => {
        this.isDraggingVolume = false;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  private seekFromPointer(e: PointerEvent): void {
    if (!this.elements) return;
    const rect = this.elements.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * (playerEngine.currentState.duration || 0);

    this.elements.progressFill.style.width = `${ratio * 100}%`;
    this.elements.currentTime.textContent = formatTime(targetTime);
    playerEngine.seekTo(targetTime);
  }

  private volumeFromPointer(e: PointerEvent): void {
    if (!this.elements) return;
    const rect = this.elements.volumeBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    playerEngine.setVolume(ratio);
  }

  private handleToggleLike(): void {
    const track = playerEngine.currentTrack;
    if (!track) return;
    const isLiked = storage.toggleLike(track);
    this.updateLikeButton(isLiked);
  }

  private updateLikeButton(isLiked: boolean): void {
    if (!this.elements) return;
    this.elements.likeBtn.classList.toggle("player__btn--active", isLiked);
    this.elements.likeBtn.style.color = isLiked ? "var(--color-accent)" : "";
  }

  private subscribeToEngine(): void {
    playerEngine.on("stateChange", (state: PlaybackState) => {
      if (!this.elements) return;

      // Play/Pause icon
      const isPlaying = state.status === "playing";
      this.elements.playBtn.innerHTML = icon(isPlaying ? "pause" : "play");
      this.elements.playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");

      // Shuffle & Repeat state
      this.elements.shuffleBtn.classList.toggle("player__btn--active", state.shuffle);
      this.elements.repeatBtn.classList.toggle("player__btn--active", state.repeat !== "off");

      // Volume slider & icon
      if (!this.isDraggingVolume) {
        const vol = state.isMuted ? 0 : state.volume;
        this.elements.volumeFill.style.width = `${vol * 100}%`;
        const volIcon = vol > 0.5 ? "volumeHigh" : vol > 0 ? "volumeLow" : "volumeMute";
        this.elements.volumeBtn.innerHTML = icon(volIcon);
      }
    });

    playerEngine.on("trackChange", (track: Track | null) => {
      if (!this.elements) return;

      if (track) {
        this.elements.title.textContent = track.title;
        this.elements.artist.textContent = track.artist;
        this.elements.duration.textContent = formatTime(track.duration || 0);

        // Update artwork
        this.elements.artwork.innerHTML = "";
        const img = document.createElement("img");
        img.src = track.artworkUrl;
        img.alt = track.title;
        img.className = "player__artwork-img";
        this.elements.artwork.appendChild(img);

        // Check liked state
        this.updateLikeButton(storage.isLiked(track.id));
      } else {
        this.elements.title.textContent = "Nothing playing";
        this.elements.artist.textContent = "Select a song to start listening";
        this.elements.duration.textContent = formatTime(0);
        this.elements.artwork.innerHTML = "";
        this.updateLikeButton(false);
      }
    });

    playerEngine.on("timeUpdate", ({ currentTime, duration }) => {
      if (!this.elements || this.isDraggingProgress) return;

      this.elements.currentTime.textContent = formatTime(currentTime);
      if (duration > 0) {
        this.elements.duration.textContent = formatTime(duration);
        const percent = Math.min(100, (currentTime / duration) * 100);
        this.elements.progressFill.style.width = `${percent}%`;
      }
    });
  }
}

const playerBar = new PlayerBar();

export function createPlayer(): HTMLElement {
  return playerBar.render();
}
