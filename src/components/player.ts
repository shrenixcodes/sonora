/**
 * Player bar — persistent playback controls.
 *
 * Displays track information, playback controls, progress bar,
 * and volume controls. Designed to integrate with a playback
 * engine once music service integration is implemented.
 *
 * Currently renders in an idle state awaiting playback connection.
 */

import { el, formatTime } from "@/lib/dom";
import { icon } from "@/icons";

interface PlayerState {
  isPlaying: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  volume: number;
  currentTime: number;
  duration: number;
  title: string;
  artist: string;
  artworkUrl: string | null;
}

const defaultState: PlayerState = {
  isPlaying: false,
  shuffle: false,
  repeat: "off",
  volume: 0.7,
  currentTime: 0,
  duration: 0,
  title: "Nothing playing",
  artist: "Play something to get started",
  artworkUrl: null,
};

class PlayerBar {
  private state: PlayerState = { ...defaultState };
  private elements: {
    playBtn: HTMLElement;
    shuffleBtn: HTMLElement;
    repeatBtn: HTMLElement;
    title: HTMLElement;
    artist: HTMLElement;
    artwork: HTMLElement;
    currentTime: HTMLElement;
    duration: HTMLElement;
    progressFill: HTMLElement;
    volumeFill: HTMLElement;
    volumeBtn: HTMLElement;
  } | null = null;

  render(): HTMLElement {
    const shuffleBtn = el("button", {
      className: "player__btn",
      html: icon("shuffle"),
      attrs: { "aria-label": "Shuffle", title: "Shuffle" },
      onClick: () => this.toggleShuffle(),
    });

    const skipBackBtn = el("button", {
      className: "player__btn",
      html: icon("skipBack"),
      attrs: { "aria-label": "Previous", title: "Previous" },
    });

    const playBtn = el("button", {
      className: "player__play-btn",
      html: icon("play"),
      attrs: { "aria-label": "Play", title: "Play" },
      onClick: () => this.togglePlayback(),
    });

    const skipFwdBtn = el("button", {
      className: "player__btn",
      html: icon("skipForward"),
      attrs: { "aria-label": "Next", title: "Next" },
    });

    const repeatBtn = el("button", {
      className: "player__btn",
      html: icon("repeat"),
      attrs: { "aria-label": "Repeat", title: "Repeat" },
      onClick: () => this.cycleRepeat(),
    });

    const progressFill = el("div", { className: "player__progress-fill" });
    progressFill.style.width = "0%";

    const currentTime = el("span", {
      className: "player__time",
      text: formatTime(0),
    });

    const duration = el("span", {
      className: "player__time",
      text: formatTime(0),
    });

    const artwork = el("div", { className: "player__artwork" });

    const title = el("span", {
      className: "player__title truncate",
      text: this.state.title,
    });

    const artist = el("span", {
      className: "player__artist truncate",
      text: this.state.artist,
    });

    const volumeFill = el("div", { className: "player__volume-fill" });
    volumeFill.style.width = `${this.state.volume * 100}%`;

    const volumeBtn = el("button", {
      className: "player__volume-btn",
      html: icon("volumeHigh"),
      attrs: { "aria-label": "Volume", title: "Volume" },
    });

    this.elements = {
      playBtn,
      shuffleBtn,
      repeatBtn,
      title,
      artist,
      artwork,
      currentTime,
      duration,
      progressFill,
      volumeFill,
      volumeBtn,
    };

    return el("div", {
      className: "player",
      children: [
        // Left: track info
        el("div", {
          className: "player__track",
          children: [
            artwork,
            el("div", { className: "player__meta", children: [title, artist] }),
            el("button", {
              className: "player__like-btn",
              html: icon("heart"),
              attrs: { "aria-label": "Like", title: "Like" },
            }),
          ],
        }),

        // Center: controls + progress
        el("div", {
          className: "player__controls",
          children: [
            el("div", {
              className: "player__buttons",
              children: [shuffleBtn, skipBackBtn, playBtn, skipFwdBtn, repeatBtn],
            }),
            el("div", {
              className: "player__progress",
              children: [
                currentTime,
                el("div", {
                  className: "player__progress-bar",
                  children: [progressFill],
                }),
                duration,
              ],
            }),
          ],
        }),

        // Right: volume + extras
        el("div", {
          className: "player__right",
          children: [
            el("div", {
              className: "player__volume",
              children: [
                volumeBtn,
                el("div", {
                  className: "player__volume-slider",
                  children: [volumeFill],
                }),
              ],
            }),
            el("button", {
              className: "player__extra-btn",
              html: icon("lyrics"),
              attrs: { "aria-label": "Lyrics", title: "Lyrics" },
            }),
            el("button", {
              className: "player__extra-btn",
              html: icon("queue"),
              attrs: { "aria-label": "Queue", title: "Queue" },
            }),
            el("button", {
              className: "player__extra-btn",
              html: icon("fullscreen"),
              attrs: {
                "aria-label": "Now Playing",
                title: "Now Playing",
              },
            }),
          ],
        }),
      ],
    });
  }

  private togglePlayback(): void {
    this.state.isPlaying = !this.state.isPlaying;
    if (this.elements) {
      this.elements.playBtn.innerHTML = icon(
        this.state.isPlaying ? "pause" : "play",
      );
      this.elements.playBtn.setAttribute(
        "aria-label",
        this.state.isPlaying ? "Pause" : "Play",
      );
    }
  }

  private toggleShuffle(): void {
    this.state.shuffle = !this.state.shuffle;
    if (this.elements) {
      this.elements.shuffleBtn.classList.toggle(
        "player__btn--active",
        this.state.shuffle,
      );
    }
  }

  private cycleRepeat(): void {
    const modes: Array<"off" | "all" | "one"> = ["off", "all", "one"];
    const idx = modes.indexOf(this.state.repeat);
    this.state.repeat = modes[(idx + 1) % modes.length];
    if (this.elements) {
      this.elements.repeatBtn.classList.toggle(
        "player__btn--active",
        this.state.repeat !== "off",
      );
    }
  }
}

// Singleton player bar
const playerBar = new PlayerBar();

export function createPlayer(): HTMLElement {
  return playerBar.render();
}
