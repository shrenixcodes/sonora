/**
 * Player bar — persistent playback controls.
 *
 * Fully integrated with Sonora's PlaybackEngine, storage, and navigation.
 */

import { el, formatTime } from "@/lib/dom";
import { attachSlider, type Slider } from "@/lib/slider";
import { icon } from "@/icons";
import { playerEngine } from "@/lib/playback/engine";
import { storage } from "@/lib/storage";
import { router } from "@/lib/router";
import { queuePanel } from "@/components/queue-panel";
import type { Track, PlaybackState } from "@/types/music";

/** One wheel notch or arrow key on the progress bar. */
const SEEK_STEP_SECONDS = 5;
/** One wheel notch or arrow key on the volume bar. */
const VOLUME_STEP = 0.05;

class PlayerBar {
  private elements: {
    root: HTMLElement;
    playBtn: HTMLElement;
    shuffleBtn: HTMLElement;
    repeatBtn: HTMLElement;
    skipBackBtn: HTMLElement;
    skipFwdBtn: HTMLElement;
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

  private progressSlider: Slider | null = null;
  private volumeSlider: Slider | null = null;

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
      attrs: { "aria-label": "Like", title: "Like", "aria-pressed": "false" },
      onClick: () => this.handleToggleLike(),
    });

    // ── Volume ────────────────────────────────────────────
    const initialVol = playerEngine.currentState.volume;
    const volumeFill = el("div", { className: "player__volume-fill" });

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
    const queueBtn = el("button", {
      className: "player__extra-btn",
      html: icon("queue"),
      attrs: {
        "aria-label": queuePanel.isOpen ? "Close Up next" : "Up next",
        title: queuePanel.isOpen ? "Close Up next" : "Up next",
        "aria-pressed": String(queuePanel.isOpen),
      },
      onClick: () => queuePanel.toggle(),
    });
    queuePanel.on("change", (open) => {
      queueBtn.setAttribute("aria-pressed", String(open));
      queueBtn.classList.toggle("player__extra-btn--active", open);
      const queueLabel = open ? "Close Up next" : "Up next";
      queueBtn.setAttribute("aria-label", queueLabel);
      queueBtn.setAttribute("title", queueLabel);
    });

    const lyricsBtn = el("button", {
      className: "player__extra-btn",
      html: icon("lyrics"),
      attrs: { "aria-label": "Lyrics", title: "Lyrics" },
      onClick: () => {
        if (router.current === "/now-playing") {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            router.navigate("/");
          }
        } else {
          router.navigate("/now-playing");
        }
      },
    });

    const nowPlayingBtn = el("button", {
      className: "player__extra-btn",
      html: icon("fullscreen"),
      attrs: { "aria-label": "Now Playing", title: "Now Playing" },
      onClick: () => {
        if (router.current === "/now-playing") {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            router.navigate("/");
          }
        } else {
          router.navigate("/now-playing");
        }
      },
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
            queueBtn,
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
      skipBackBtn,
      skipFwdBtn,
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
    this.subscribeToRouter();

    return root;
  }

  private setupInteractivity(): void {
    if (!this.elements) return;
    const { progressBar, volumeBar, currentTime } = this.elements;
    const duration = () => playerEngine.currentState.duration || 0;

    // Dragging previews the position; the seek happens when the drag ends, so
    // YouTube Music isn't asked to seek dozens of times per second.
    this.progressSlider = attachSlider(progressBar, {
      label: "Seek",
      onInput: (ratio) => {
        currentTime.textContent = formatTime(ratio * duration());
      },
      onCommit: (ratio) => playerEngine.seekTo(ratio * duration()),
      step: () => (duration() > 0 ? SEEK_STEP_SECONDS / duration() : 0),
      valueText: (ratio) => `${formatTime(ratio * duration())} of ${formatTime(duration())}`,
    });

    this.volumeSlider = attachSlider(volumeBar, {
      label: "Volume",
      onInput: (ratio) => playerEngine.setVolume(ratio),
      onCommit: (ratio) => playerEngine.setVolume(ratio),
      step: () => VOLUME_STEP,
      valueText: (ratio) => `${Math.round(ratio * 100)}%`,
    });
    this.volumeSlider.setValue(playerEngine.currentState.volume);
    this.progressSlider.setValue(0);
  }

  private handleToggleLike(): void {
    const track = playerEngine.currentTrack;
    if (!track) return;
    storage.toggleLike(track);
  }

  private updateLikeButton(isLiked: boolean): void {
    if (!this.elements) return;
    this.elements.likeBtn.classList.toggle("player__btn--active", isLiked);
    this.elements.likeBtn.style.color = isLiked ? "var(--color-accent)" : "";
    this.elements.likeBtn.setAttribute("aria-pressed", String(isLiked));
    const label = isLiked ? "Unlike" : "Like";
    this.elements.likeBtn.setAttribute("aria-label", label);
    this.elements.likeBtn.setAttribute("title", label);
  }

  private subscribeToEngine(): void {
    playerEngine.on("stateChange", (state: PlaybackState) => {
      if (!this.elements) return;

      // Play/Pause icon
      const isPlaying = state.status === "playing";
      this.elements.playBtn.innerHTML = icon(isPlaying ? "pause" : "play");
      this.elements.playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");

      // Status line: ads, loading and errors replace the artist until they clear
      const track = state.currentTrack;
      const status = state.error
        ? state.error
        : state.isAd
          ? "Ad · your song plays after this"
          : state.status === "loading"
            ? "Loading…"
            : (track?.artist ?? "Select a song to start listening");
      this.elements.artist.textContent = status;
      this.elements.root.classList.toggle("player--ad", state.isAd);
      this.elements.root.classList.toggle("player--error", Boolean(state.error));
      // Ads must play out: no seeking or skipping until they end
      for (const btn of [this.elements.skipBackBtn, this.elements.skipFwdBtn]) {
        btn.toggleAttribute("disabled", state.isAd);
      }

      // Shuffle & Repeat state
      this.elements.shuffleBtn.classList.toggle("player__btn--active", state.shuffle);
      this.elements.shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
      const shuffleLabel = state.shuffle ? "Shuffle: On" : "Shuffle: Off";
      this.elements.shuffleBtn.setAttribute("aria-label", shuffleLabel);
      this.elements.shuffleBtn.setAttribute("title", shuffleLabel);

      const isRepeat = state.repeat !== "off";
      this.elements.repeatBtn.classList.toggle("player__btn--active", isRepeat);
      this.elements.repeatBtn.setAttribute("aria-pressed", String(isRepeat));
      if (state.repeat === "one") {
        this.elements.repeatBtn.innerHTML = icon("repeatOne");
        this.elements.repeatBtn.setAttribute("aria-label", "Repeat: One");
        this.elements.repeatBtn.setAttribute("title", "Repeat: One");
      } else if (state.repeat === "all") {
        this.elements.repeatBtn.innerHTML = icon("repeat");
        this.elements.repeatBtn.setAttribute("aria-label", "Repeat: All");
        this.elements.repeatBtn.setAttribute("title", "Repeat: All");
      } else {
        this.elements.repeatBtn.innerHTML = icon("repeat");
        this.elements.repeatBtn.setAttribute("aria-label", "Repeat: Off");
        this.elements.repeatBtn.setAttribute("title", "Repeat: Off");
      }

      // Volume slider & icon
      const vol = state.isMuted ? 0 : state.volume;
      this.volumeSlider?.setValue(vol);
      const volIcon = vol > 0.5 ? "volumeHigh" : vol > 0 ? "volumeLow" : "volumeMute";
      this.elements.volumeBtn.innerHTML = icon(volIcon);
      const isMuted = state.isMuted || state.volume === 0;
      const volLabel = isMuted ? "Unmute" : "Mute";
      this.elements.volumeBtn.setAttribute("aria-label", volLabel);
      this.elements.volumeBtn.setAttribute("title", volLabel);
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
        img.src = track.artworkUrl || "/artwork-placeholder.svg";
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

    storage.on("likeChange", ({ trackId, isLiked }) => {
      if (playerEngine.currentTrack?.id === trackId) {
        this.updateLikeButton(isLiked);
      }
    });

    playerEngine.on("timeUpdate", ({ currentTime, duration }) => {
      if (!this.elements || this.progressSlider?.dragging) return;

      this.elements.currentTime.textContent = formatTime(currentTime);
      if (duration > 0) {
        this.elements.duration.textContent = formatTime(duration);
        this.progressSlider?.setValue(currentTime / duration);
      }
    });
  }

  private subscribeToRouter(): void {
    const updateRoute = (path: string) => {
      if (!this.elements) return;
      const isNowPlaying = path === "/now-playing";
      this.elements.nowPlayingBtn.innerHTML = icon(isNowPlaying ? "minimize" : "fullscreen");
      const npLabel = isNowPlaying ? "Minimize Now Playing" : "Now Playing";
      this.elements.nowPlayingBtn.setAttribute("aria-label", npLabel);
      this.elements.nowPlayingBtn.setAttribute("title", npLabel);
      this.elements.nowPlayingBtn.setAttribute("aria-pressed", String(isNowPlaying));
      this.elements.nowPlayingBtn.classList.toggle("player__extra-btn--active", isNowPlaying);

      this.elements.lyricsBtn.setAttribute("aria-pressed", String(isNowPlaying));
      this.elements.lyricsBtn.classList.toggle("player__extra-btn--active", isNowPlaying);
    };

    router.onNavigate(updateRoute);
    requestAnimationFrame(() => updateRoute(router.current));
  }
}

const playerBar = new PlayerBar();

export function createPlayer(): HTMLElement {
  return playerBar.render();
}
