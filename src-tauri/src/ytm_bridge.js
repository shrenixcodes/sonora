// Injected into the hidden music.youtube.com window. Reports playback state to
// Sonora and exposes a small set of controls. Runs on every document load.
(() => {
  if (location.hostname !== "music.youtube.com" || window.top !== window) return;
  if (window.__sonoraBridge) return;

  const TIME_REPORT_INTERVAL_MS = 1000;
  const VIDEO_LOOKUP_INTERVAL_MS = 500;
  // The page updates mediaSession metadata shortly after the track switches.
  const METADATA_SETTLE_MS = 600;

  let video = null;
  let lastTimeReport = 0;

  const player = () => document.getElementById("movie_player");
  // The player marks itself while an ad runs; the media metadata then describes the ad.
  const isAdPlaying = () => {
    const p = player();
    return !!(p && p.classList.contains("ad-showing"));
  };

  const send = (reason) => {
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;

    const metadata = navigator.mediaSession ? navigator.mediaSession.metadata : null;
    const artwork = metadata && metadata.artwork && metadata.artwork.length
      ? metadata.artwork[metadata.artwork.length - 1].src
      : null;
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;

    invoke("ytm_report", {
      state: {
        reason,
        videoId: new URLSearchParams(location.search).get("v"),
        title: metadata ? metadata.title || null : null,
        artist: metadata ? metadata.artist || null : null,
        album: metadata ? metadata.album || null : null,
        artworkUrl: artwork,
        paused: video ? video.paused : true,
        currentTime: video ? video.currentTime : 0,
        duration,
        volume: video ? video.volume : 1,
        muted: video ? video.muted : false,
        ad: isAdPlaying(),
        signedIn: !!(window.ytcfg && window.ytcfg.get && window.ytcfg.get("LOGGED_IN")),
      },
    }).catch(() => {});
  };

  const attach = (element) => {
    video = element;
    for (const type of ["play", "pause", "ended", "volumechange", "seeked"]) {
      element.addEventListener(type, () => send(type));
    }
    element.addEventListener("loadedmetadata", () => {
      send("track");
      setTimeout(() => send("track"), METADATA_SETTLE_MS);
    });
    element.addEventListener("timeupdate", () => {
      const now = Date.now();
      if (now - lastTimeReport >= TIME_REPORT_INTERVAL_MS) {
        lastTimeReport = now;
        send("time");
      }
    });
    send("ready");
  };

  // The app keeps one <video> element for the whole session; find it once.
  const lookup = setInterval(() => {
    const element = document.querySelector("video");
    if (element) {
      clearInterval(lookup);
      attach(element);
    }
  }, VIDEO_LOOKUP_INTERVAL_MS);

  const clickButton = (selector) => {
    const button = document.querySelector(selector);
    if (button) button.click();
  };

  // Seeking or skipping during an ad would cut it short, which YouTube does not allow.
  const BLOCKED_DURING_AD = new Set(["next", "previous", "seek"]);

  // ── Catalog requests ───────────────────────────────────────
  // Uses the same API and session the YouTube Music web app uses for its own
  // pages, so results match what the signed-in user sees on the site.
  const SONGS_ONLY = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

  const readCookie = (name) => {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? match[1] : null;
  };

  // The site signs its own API calls with this header when the user is signed in.
  const authorization = async () => {
    const sapisid = readCookie("SAPISID") || readCookie("__Secure-3PAPISID");
    if (!sapisid || !crypto.subtle) return null;
    const timestamp = Math.floor(Date.now() / 1000);
    const data = new TextEncoder().encode(timestamp + " " + sapisid + " " + location.origin);
    const digest = await crypto.subtle.digest("SHA-1", data);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return "SAPISIDHASH " + timestamp + "_" + hex;
  };

  const catalogRequest = async (id, request) => {
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;
    const reply = (ok, body) => invoke("ytm_response", { id, ok, body }).catch(() => {});

    try {
      const context = window.ytcfg && window.ytcfg.get && window.ytcfg.get("INNERTUBE_CONTEXT");
      if (!context) return reply(false, "not-ready");

      let endpoint = "browse";
      let query = "";
      let body;
      if (request.kind === "home") {
        body = { browseId: "FEmusic_home" };
      } else if (request.kind === "search") {
        endpoint = "search";
        body = { query: String(request.query), params: SONGS_ONLY };
      } else if (request.kind === "likedSongs") {
        body = { browseId: "FEmusic_liked_videos" };
      } else if (request.kind === "libraryPlaylists") {
        body = { browseId: "FEmusic_liked_playlists" };
      } else if (request.kind === "playlist") {
        const id = String(request.id);
        body = { browseId: id.startsWith("VL") ? id : "VL" + id };
      } else if (request.kind === "continuation") {
        // Older list pages read the token from the URL, newer ones from the body.
        const token = encodeURIComponent(decodeURIComponent(String(request.token)));
        query = "&ctoken=" + token + "&continuation=" + token + "&type=next";
        body = { continuation: decodeURIComponent(String(request.token)) };
      } else {
        return reply(false, "unknown-request");
      }

      const headers = { "Content-Type": "application/json", "X-Goog-AuthUser": "0", "X-Origin": location.origin };
      const auth = await authorization();
      if (auth) headers.Authorization = auth;

      const response = await fetch("/youtubei/v1/" + endpoint + "?prettyPrint=false" + query, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(Object.assign({ context }, body)),
      });
      if (!response.ok) return reply(false, "http-" + response.status);
      reply(true, await response.text());
    } catch (err) {
      reply(false, String((err && err.message) || err));
    }
  };

  window.__sonoraBridge = Object.freeze({
    request(id, request) {
      catalogRequest(id, request);
    },
    exec(action, value) {
      if (BLOCKED_DURING_AD.has(action) && isAdPlaying()) {
        send("blocked-ad");
        return;
      }
      const p = player();
      switch (action) {
        case "play":
          if (video) video.play().catch(() => send("blocked"));
          break;
        case "pause":
          if (video) video.pause();
          break;
        case "toggle":
          if (video) {
            if (video.paused) video.play().catch(() => send("blocked"));
            else video.pause();
          }
          break;
        case "next":
          if (p && typeof p.nextVideo === "function") p.nextVideo();
          else clickButton("ytmusic-player-bar .next-button");
          break;
        case "previous":
          if (p && typeof p.previousVideo === "function") p.previousVideo();
          else clickButton("ytmusic-player-bar .previous-button");
          break;
        case "seek":
          if (video && typeof value === "number") video.currentTime = value;
          break;
        case "volume":
          if (typeof value === "number") {
            // Keep the page's own volume slider in sync with the element.
            if (p && typeof p.setVolume === "function") p.setVolume(Math.round(value * 100));
            if (video) video.volume = value;
          }
          break;
      }
    },
  });
})();
