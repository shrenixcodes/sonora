// Injected into the hidden music.youtube.com window. Reports playback state to
// Sonora and exposes a small set of controls. Runs on every document load.
(() => {
  if (location.hostname !== "music.youtube.com" || window.top !== window) return;
  if (window.__sonoraBridge) return;

  // While a track is playing the page keeps a beforeunload handler, so every
  // navigation raises the browser's "Leave site?" confirmation. This window is
  // hidden, so that prompt is invisible: it simply freezes the page, and the
  // music with it, until something dismisses it. Sonora only ever navigates
  // this page deliberately, so the prompt guards nothing. The bridge is
  // injected before the page's own scripts, so this listener runs first and
  // stops the handler that would ask for it.
  window.addEventListener("beforeunload", (event) => event.stopImmediatePropagation(), true);

  const TIME_REPORT_INTERVAL_MS = 1000;
  const VIDEO_LOOKUP_INTERVAL_MS = 500;
  const ACCOUNT_LOOKUP_ATTEMPTS = 60;
  // The page updates mediaSession metadata shortly after the track switches.
  const METADATA_SETTLE_MS = 600;

  let video = null;
  let lastTimeReport = 0;
  let lastLoadedVideoId = null;

  const player = () => document.getElementById("movie_player");
  // The player marks itself while an ad runs; the media metadata then describes the ad.
  const isAdPlaying = () => {
    const p = player();
    return !!(p && p.classList.contains("ad-showing"));
  };

  // Nobody ever sees this page, but a music video still arrives as video and is
  // decoded frame by frame for a window that is never drawn. Hold the player at
  // its smallest picture: the audio stream is picked separately and keeps its
  // quality, so the song plays as a song and the frames stop costing anything.
  const holdVideoAtMinimum = () => {
    const p = player();
    if (p && typeof p.setPlaybackQualityRange === "function") {
      p.setPlaybackQualityRange("tiny", "tiny");
    }
  };

  // The player knows what is loaded; the address bar does not. Swapping a track
  // in place leaves the URL on the track before it, so ask the player first and
  // keep the URL as the answer for a page that has not built its player yet.
  const currentVideoId = () => {
    const p = player();
    let id = null;
    if (p) {
      if (typeof p.getVideoData === "function") {
        const data = p.getVideoData();
        id = (data && (data.video_id || data.videoId)) || null;
      }
      if (!id && typeof p.getVideoUrl === "function") {
        try {
          const url = new URL(p.getVideoUrl());
          id = url.searchParams.get("v");
        } catch {}
      }
    }
    if (!id) {
      id = new URLSearchParams(location.search).get("v");
    }
    if (!id) {
      const link = document.querySelector("ytmusic-player-bar a[href*='watch?v=']");
      if (link && link.href) {
        try {
          id = new URL(link.href).searchParams.get("v");
        } catch {}
      }
    }
    return id || lastLoadedVideoId;
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
        videoId: currentVideoId(),
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

  // Media keys and the system media controls reach this page through
  // mediaSession, where the page's own handlers skip within YouTube Music's
  // queue. Sonora loads one track at a time, so that queue is empty and the
  // keys did nothing. Skips go to Sonora, which owns the queue, and the page
  // is kept from taking these two actions back.
  const SKIP_ACTIONS = new Map([
    ["nexttrack", "media-next"],
    ["previoustrack", "media-previous"],
  ]);
  const session = navigator.mediaSession;
  if (session && typeof session.setActionHandler === "function") {
    const setActionHandler = session.setActionHandler.bind(session);
    for (const [action, reason] of SKIP_ACTIONS) {
      try {
        setActionHandler(action, () => send(reason));
      } catch {
        // An action this browser does not support.
      }
    }
    session.setActionHandler = (action, handler) => {
      if (!SKIP_ACTIONS.has(action)) setActionHandler(action, handler);
    };
  }

  const attach = (element) => {
    if (video === element) return;
    video = element;
    for (const type of ["play", "pause", "ended", "volumechange", "seeked"]) {
      element.addEventListener(type, () => send(type));
    }
    element.addEventListener("loadedmetadata", () => {
      holdVideoAtMinimum();
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
    holdVideoAtMinimum();
    send("ready");
  };

  // The app keeps looking for the <video> element to handle creation or replacement.
  const lookup = setInterval(() => {
    const element = document.querySelector("video");
    if (element && element !== video) {
      attach(element);
    }
  }, VIDEO_LOOKUP_INTERVAL_MS);

  // The <video> element may not exist until something plays, so the sign-in
  // state is reported on its own as soon as the page knows it. Without this,
  // a finished sign-in can go unnoticed and the window never closes.
  let accountChecks = 0;
  const accountLookup = setInterval(() => {
    const loggedIn = window.ytcfg && window.ytcfg.get && window.ytcfg.get("LOGGED_IN");
    if (loggedIn !== undefined || ++accountChecks >= ACCOUNT_LOOKUP_ATTEMPTS) {
      clearInterval(accountLookup);
      if (loggedIn !== undefined) send("account");
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
        if (request.params) body.params = String(request.params);
      } else if (request.kind === "search") {
        endpoint = "search";
        body = { query: String(request.query), params: request.params ? String(request.params) : SONGS_ONLY };
      } else if (request.kind === "likedSongs") {
        body = { browseId: "FEmusic_liked_videos" };
      } else if (request.kind === "history") {
        body = { browseId: "FEmusic_history" };
      } else if (request.kind === "rate") {
        endpoint = request.rating === "LIKE" ? "like/like" : "like/removelike";
        body = { target: { videoId: String(request.videoId) } };
      } else if (request.kind === "libraryPlaylists") {
        body = { browseId: "FEmusic_liked_playlists" };
      } else if (request.kind === "libraryAlbums") {
        body = { browseId: "FEmusic_liked_albums" };
      } else if (request.kind === "libraryArtists") {
        body = { browseId: "FEmusic_library_corpus_track_artists" };
      } else if (request.kind === "explore") {
        body = { browseId: "FEmusic_explore" };
      } else if (request.kind === "accountInfo") {
        endpoint = "account/account_menu";
        body = {};
      } else if (request.kind === "playlist") {
        const id = String(request.id);
        body = { browseId: id.startsWith("VL") ? id : "VL" + id };
      } else if (request.kind === "watchPlaylist") {
        // Mixes made for the user have no playlist page; their songs come from a watch queue.
        endpoint = "next";
        body = { playlistId: String(request.id), enablePersistentPlaylistPanel: true, isAudioOnly: true };
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
        case "load":
          // Swapping the track inside the running page skips reloading the
          // whole YouTube Music app, which took seconds and dropped the audio.
          if (typeof value === "string") {
            lastLoadedVideoId = value;
            try {
              window.history.replaceState(null, "", "/watch?v=" + encodeURIComponent(value));
            } catch {}
            if (p && typeof p.loadVideoById === "function") p.loadVideoById(value);
            else location.assign("/watch?v=" + encodeURIComponent(value));
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
