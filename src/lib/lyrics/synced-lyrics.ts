/**
 * LRC parser and synchronized lyrics manager.
 *
 * Parses standard LRC format strings ([mm:ss.xx] or [mm:ss.xxx]),
 * matches current playback time to active lyrics line, and manages
 * auto-scroll without fighting user manual scrolling.
 */

import type { LyricsLine, LyricsData } from "@/types/music";

export function parseLrc(lrcText: string, trackId = ""): LyricsData {
  const lines: LyricsLine[] = [];
  const rawLines = lrcText.split("\n");

  // Regex matches [mm:ss.xx] or [mm:ss.xxx] or [mm:ss]
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Reset regex index
    timeRegex.lastIndex = 0;
    const matches = Array.from(trimmed.matchAll(timeRegex));
    if (matches.length === 0) continue;

    // Strip time tags to get text
    const text = trimmed.replace(timeRegex, "").trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let millis = 0;
      if (match[3]) {
        millis = parseInt(match[3].padEnd(3, "0").slice(0, 3), 10);
      }
      const timeMs = minutes * 60 * 1000 + seconds * 1000 + millis;
      lines.push({ timeMs, text });
    }
  }

  // Sort chronologically
  lines.sort((a, b) => a.timeMs - b.timeMs);

  return {
    trackId,
    isSynced: lines.length > 0,
    lines,
    plainLyrics: lines.map((l) => l.text).join("\n"),
  };
}

export class LyricsController {
  private data: LyricsData | null = null;
  private activeIndex = -1;
  private container: HTMLElement | null = null;
  private isUserScrolling = false;
  private userScrollTimeout: number | null = null;
  private scrollLockIndicator: HTMLElement | null = null;
  private onSeekRequest?: (timeSeconds: number) => void;

  constructor(options?: { onSeekRequest?: (timeSeconds: number) => void }) {
    this.onSeekRequest = options?.onSeekRequest;
  }

  setLyrics(lyrics: LyricsData | null): void {
    this.data = lyrics;
    this.activeIndex = -1;
    this.hideScrollLockIndicator();
    this.render();
  }

  bindContainer(container: HTMLElement): void {
    this.container = container;
    this.container.addEventListener("wheel", () => this.handleUserScroll(), { passive: true });
    this.container.addEventListener("touchmove", () => this.handleUserScroll(), { passive: true });
    this.render();
  }

  private handleUserScroll(): void {
    if (!this.data || !this.data.isSynced || this.data.lines.length === 0) return;
    this.isUserScrolling = true;
    this.showScrollLockIndicator();

    if (this.userScrollTimeout !== null) {
      window.clearTimeout(this.userScrollTimeout);
    }
    // Resume auto-scroll 5 seconds after user stops scrolling
    this.userScrollTimeout = window.setTimeout(() => {
      this.resumeAutoScroll();
    }, 5000);
  }

  resumeAutoScroll(): void {
    if (this.userScrollTimeout !== null) {
      window.clearTimeout(this.userScrollTimeout);
      this.userScrollTimeout = null;
    }
    this.isUserScrolling = false;
    this.hideScrollLockIndicator();
    this.scrollToActive();
  }

  private showScrollLockIndicator(): void {
    if (!this.container || this.scrollLockIndicator) return;
    const indicator = document.createElement("button");
    indicator.className = "lyrics__scroll-lock";
    indicator.type = "button";
    indicator.setAttribute("aria-label", "Auto-scroll paused. Click to sync with lyrics.");
    indicator.innerHTML = `<span class="lyrics__scroll-lock-dot"></span><span>Sync to lyrics</span>`;
    indicator.addEventListener("click", (e) => {
      e.stopPropagation();
      this.resumeAutoScroll();
    });
    this.scrollLockIndicator = indicator;
    this.container.appendChild(indicator);
  }

  private hideScrollLockIndicator(): void {
    if (this.scrollLockIndicator) {
      this.scrollLockIndicator.remove();
      this.scrollLockIndicator = null;
    }
  }

  updateTime(currentTimeSeconds: number): void {
    if (!this.data || !this.data.isSynced || this.data.lines.length === 0) return;

    const currentMs = currentTimeSeconds * 1000;
    const lines = this.data.lines;

    // Find the current active line
    let newIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= currentMs + 200) { // 200ms lead for natural feel
        newIndex = i;
      } else {
        break;
      }
    }

    if (newIndex !== this.activeIndex) {
      this.activeIndex = newIndex;
      this.updateHighlight();
      if (!this.isUserScrolling) {
        this.scrollToActive();
      }
    }
  }

  private render(): void {
    if (!this.container) return;
    this.container.innerHTML = "";

    if (!this.data || this.data.lines.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lyrics__empty";
      empty.textContent = "No lyrics available for this track";
      this.container.appendChild(empty);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "lyrics__list";

    this.data.lines.forEach((line, index) => {
      const p = document.createElement("p");
      p.className = "lyrics__line";
      p.dataset.index = String(index);
      p.textContent = line.text || "♪";

      if (this.data?.isSynced) {
        p.classList.add("lyrics__line--synced");
        p.addEventListener("click", () => {
          if (this.onSeekRequest) {
            this.onSeekRequest(line.timeMs / 1000);
          }
        });
      }

      wrapper.appendChild(p);
    });

    this.container.appendChild(wrapper);
    this.updateHighlight();
  }

  private updateHighlight(): void {
    if (!this.container) return;
    const lineElements = this.container.querySelectorAll(".lyrics__line");

    lineElements.forEach((el, idx) => {
      if (idx === this.activeIndex) {
        el.classList.add("lyrics__line--active");
        el.classList.remove("lyrics__line--passed");
      } else if (idx < this.activeIndex) {
        el.classList.remove("lyrics__line--active");
        el.classList.add("lyrics__line--passed");
      } else {
        el.classList.remove("lyrics__line--active");
        el.classList.remove("lyrics__line--passed");
      }
    });
  }

  private scrollToActive(): void {
    if (!this.container || this.activeIndex < 0) return;
    const activeEl = this.container.querySelector(
      `.lyrics__line[data-index="${this.activeIndex}"]`,
    ) as HTMLElement | null;

    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  destroy(): void {
    if (this.userScrollTimeout !== null) {
      window.clearTimeout(this.userScrollTimeout);
    }
    this.hideScrollLockIndicator();
  }
}
