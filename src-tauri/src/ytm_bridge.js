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
  const AUDIO_CONFIG_STORAGE_KEY = "sonora:audio_config";
  const MAX_TRACK_META_CACHE = 50;
  const STALL_FALLBACK_MS = 4000;
  const RECOVERY_WINDOW_MS = 8000;

  const QUALITY_MODES = new Set(["saver", "balanced", "high", "lossless"]);
  const ENHANCEMENT_PROFILES = new Set(["off", "clarity", "warm", "bass", "vocal"]);
  const PROFILE_EQ_DB = {
    off: [0, 0, 0, 0, 0],
    clarity: [1.5, -2.8, 0.5, 1.8, 2.5],
    warm: [2.5, 0.8, 0.0, -1.8, -0.8],
    bass: [4.5, -1.5, 0.0, 0.8, 1.0],
    vocal: [-1.5, -2.0, 2.2, 2.8, 1.5],
  };

  let video = null;
  let lastTimeReport = 0;
  let lastLoadedVideoId = null;
  let lastAppliedGainDb = null;
  let audioGraph = null;
  let audioGraphFailed = false;
  let stallTimer = null;
  let recoveringTrack = null;
  let lastProgressTime = -1;
  const trackAudioMeta = new Map();
  const trackQualityOverride = new Map();

  const normalizeAudioConfig = (raw) => {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      quality: QUALITY_MODES.has(src.quality) ? src.quality : "high",
      profile: ENHANCEMENT_PROFILES.has(src.profile) ? src.profile : "off",
      normalizeVolume: typeof src.normalizeVolume === "boolean" ? src.normalizeVolume : true,
    };
  };

  const loadStoredAudioConfig = () => {
    try {
      const saved = localStorage.getItem(AUDIO_CONFIG_STORAGE_KEY);
      return saved ? normalizeAudioConfig(JSON.parse(saved)) : normalizeAudioConfig(null);
    } catch {
      return normalizeAudioConfig(null);
    }
  };

  let audioConfig = loadStoredAudioConfig();

  const saveAudioConfig = (next) => {
    try {
      localStorage.setItem(AUDIO_CONFIG_STORAGE_KEY, JSON.stringify(next));
      if (next.quality === "lossless" || next.quality === "high") {
        localStorage.setItem(
          "yt-player-quality",
          JSON.stringify({
            data: "highres",
            expiration: Date.now() + 30 * 86400 * 1000,
            creation: Date.now(),
          }),
        );
      }
    } catch {
      // Storage may be blocked in restricted contexts.
    }
  };

  const player = () => document.getElementById("movie_player");
  // The player marks itself while an ad runs; the media metadata then describes the ad.
  const isAdPlaying = () => {
    const p = player();
    return !!(p && p.classList.contains("ad-showing"));
  };

  const rememberTrackAudioMeta = (videoId, meta) => {
    if (!videoId || !meta) return;
    if (trackAudioMeta.has(videoId)) trackAudioMeta.delete(videoId);
    trackAudioMeta.set(videoId, meta);
    if (trackAudioMeta.size > MAX_TRACK_META_CACHE) {
      const oldest = trackAudioMeta.keys().next().value;
      if (oldest !== undefined) trackAudioMeta.delete(oldest);
    }
  };

  const parseCodecLabel = (mimeType) => {
    if (typeof mimeType !== "string") return null;
    const lower = mimeType.toLowerCase();
    if (lower.includes("opus")) return "Opus";
    if (lower.includes("mp4a.40.5")) return "HE-AAC";
    if (lower.includes("mp4a") || lower.includes("audio/mp4")) return "AAC";
    if (lower.includes("flac")) return "FLAC";
    return "Audio";
  };

  const codecFamilyOf = (format) => {
    const mime = typeof format?.mimeType === "string" ? format.mimeType.toLowerCase() : "";
    if (mime.includes("opus")) return "opus";
    if (mime.includes("mp4a") || mime.includes("audio/mp4")) return "aac";
    return "other";
  };

  const bitrateOf = (format) => {
    if (typeof format?.bitrate === "number" && Number.isFinite(format.bitrate) && format.bitrate > 0) {
      return format.bitrate;
    }
    if (
      typeof format?.averageBitrate === "number" &&
      Number.isFinite(format.averageBitrate) &&
      format.averageBitrate > 0
    ) {
      return format.averageBitrate;
    }
    return 0;
  };

  const codecRank = (format) => (codecFamilyOf(format) === "opus" ? 2 : codecFamilyOf(format) === "aac" ? 1 : 0);

  const bestPerFamily = (formats) => {
    const best = new Map();
    for (const f of formats) {
      const fam = codecFamilyOf(f);
      const prev = best.get(fam);
      if (!prev || bitrateOf(f) > bitrateOf(prev)) best.set(fam, f);
    }
    return Array.from(best.values());
  };

  const selectAudioFormats = (audioFormats, requestedQuality) => {
    if (!Array.isArray(audioFormats) || audioFormats.length === 0) {
      return {
        selected: audioFormats,
        effectiveQuality: requestedQuality,
        fallbackUsed: false,
        fallbackReason: null,
      };
    }

    // Avoid AI auto-dubbed tracks whenever original audio exists.
    const nonDubbed = audioFormats.filter((f) => !f?.audioTrack || f.audioTrack.isAutoDubbed !== true);
    let candidates = nonDubbed.length > 0 ? nonDubbed : audioFormats;
    const defaultTracks = candidates.filter((f) => !f?.audioTrack || f.audioTrack.audioIsDefault !== false);
    if (defaultTracks.length > 0) candidates = defaultTracks;

    const byBestDesc = (a, b) => bitrateOf(b) - bitrateOf(a) || codecRank(b) - codecRank(a);
    const byLightest = (a, b) => bitrateOf(a) - bitrateOf(b) || codecRank(b) - codecRank(a);

    if (requestedQuality === "balanced") {
      const steppedDown = audioConfig.quality === "lossless" || audioConfig.quality === "high";
      return {
        selected: steppedDown ? candidates.slice().sort(byBestDesc) : candidates,
        effectiveQuality: "balanced",
        fallbackUsed: steppedDown,
        fallbackReason: steppedDown
          ? "Switched to best available stream without stopping playback"
          : null,
      };
    }

    if (requestedQuality === "saver") {
      const light = candidates.filter((f) => {
        const br = bitrateOf(f);
        return br >= 44000 && br <= 135000;
      });
      if (light.length > 0) {
        return {
          selected: light.slice().sort(byLightest),
          effectiveQuality: "saver",
          fallbackUsed: false,
          fallbackReason: null,
        };
      }
      const underCap = candidates.filter((f) => bitrateOf(f) > 0 && bitrateOf(f) <= 135000);
      return {
        selected: (underCap.length > 0 ? underCap : candidates).slice().sort(byLightest),
        effectiveQuality: "saver",
        fallbackUsed: false,
        fallbackReason: null,
      };
    }

    if (requestedQuality === "lossless") {
      const highTier = candidates.filter(
        (f) => f?.audioQuality === "AUDIO_QUALITY_HIGH" || bitrateOf(f) >= 192000,
      );
      if (highTier.length > 0) {
        return {
          selected: highTier.slice().sort(byBestDesc),
          effectiveQuality: "lossless",
          fallbackUsed: false,
          fallbackReason: null,
        };
      }
      const clean = candidates.filter(
        (f) => bitrateOf(f) >= 96000 && f?.audioQuality !== "AUDIO_QUALITY_LOW",
      );
      if (clean.length > 0) {
        return {
          selected: clean.slice().sort(byBestDesc),
          effectiveQuality: "high",
          fallbackUsed: true,
          fallbackReason: "Lossless stream unavailable — playing best available audio",
        };
      }
      return {
        selected: bestPerFamily(candidates).slice().sort(byBestDesc),
        effectiveQuality: "balanced",
        fallbackUsed: true,
        fallbackReason: "Lossless stream unavailable — playing best available stream",
      };
    }

    // "high": block low-bitrate ABR downgrades whenever standard/high streams exist.
    // When stepping down from a stalled/errored lossless stream, bypass the failing high tier if clean medium streams exist.
    const clean = candidates.filter(
      (f) => bitrateOf(f) >= 96000 && f?.audioQuality !== "AUDIO_QUALITY_LOW",
    );
    if (clean.length > 0) {
      const steppedFromLossless = audioConfig.quality === "lossless";
      const fallbackClean = steppedFromLossless
        ? clean.filter((f) => f?.audioQuality !== "AUDIO_QUALITY_HIGH" && bitrateOf(f) < 192000)
        : [];
      const chosen = fallbackClean.length > 0 ? fallbackClean : clean;
      return {
        selected: chosen.slice().sort(byBestDesc),
        effectiveQuality: "high",
        fallbackUsed: steppedFromLossless,
        fallbackReason: steppedFromLossless
          ? "Switched to best available quality without stopping playback"
          : null,
      };
    }
    return {
      selected: bestPerFamily(candidates).slice().sort(byBestDesc),
      effectiveQuality: "balanced",
      fallbackUsed: true,
      fallbackReason: "High-bitrate stream unavailable — playing best available stream",
    };
  };

  const inspectAndOptimizePlayerResponse = (result, mutateFormats) => {
    if (!result || typeof result !== "object") return result;
    const playerResp =
      result.playerResponse && typeof result.playerResponse === "object" ? result.playerResponse : result;
    if (!("videoDetails" in playerResp) && !("streamingData" in playerResp)) return result;

    const videoId =
      typeof playerResp?.videoDetails?.videoId === "string" ? playerResp.videoDetails.videoId : null;
    const requestedQuality = (videoId && trackQualityOverride.get(videoId)) || audioConfig.quality;
    const audioCfg = playerResp?.playerConfig?.audioConfig;
    const rawLoudness =
      typeof audioCfg?.loudnessDb === "number" && Number.isFinite(audioCfg.loudnessDb)
        ? audioCfg.loudnessDb
        : typeof audioCfg?.perceptualLoudnessDb === "number" && Number.isFinite(audioCfg.perceptualLoudnessDb)
          ? audioCfg.perceptualLoudnessDb
          : null;

    const streaming = playerResp.streamingData;
    let primaryAudio = null;
    let hasAdaptiveAudio = false;
    let effectiveQuality = requestedQuality;
    let fallbackUsed = false;
    let fallbackReason = null;

    if (streaming && Array.isArray(streaming.adaptiveFormats)) {
      const videoFormats = [];
      const audioFormats = [];
      for (const fmt of streaming.adaptiveFormats) {
        if (typeof fmt?.mimeType === "string" && fmt.mimeType.startsWith("audio/")) {
          audioFormats.push(fmt);
        } else {
          videoFormats.push(fmt);
        }
      }
      if (audioFormats.length > 0) {
        hasAdaptiveAudio = true;
        const selection = selectAudioFormats(audioFormats, requestedQuality);
        const selected = selection.selected;
        effectiveQuality = selection.effectiveQuality;
        fallbackUsed = selection.fallbackUsed;
        fallbackReason = selection.fallbackReason;
        primaryAudio =
          requestedQuality === "saver"
            ? selected[selected.length - 1] ?? selected[0]
            : selected[0];
        if (mutateFormats) {
          try {
            streaming.adaptiveFormats = [...videoFormats, ...selected];
          } catch {
            // Frozen or read-only player response objects remain intact.
          }
        }
      } else if (audioConfig.quality === "lossless" || audioConfig.quality === "high") {
        effectiveQuality = "balanced";
        fallbackUsed = true;
        fallbackReason = "Adaptive audio unavailable — playing best muxed stream";
      }
    }

    if (videoId) {
      rememberTrackAudioMeta(videoId, {
        videoId,
        loudnessDb: rawLoudness,
        hasAdaptiveAudio,
        codec: primaryAudio ? parseCodecLabel(primaryAudio.mimeType) : null,
        bitrateKbps: primaryAudio ? Math.round(bitrateOf(primaryAudio) / 1000) || null : null,
        sampleRate:
          primaryAudio && Number(primaryAudio.audioSampleRate) > 0
            ? Number(primaryAudio.audioSampleRate)
            : null,
        channels:
          primaryAudio && Number(primaryAudio.audioChannels) > 0
            ? Number(primaryAudio.audioChannels)
            : 2,
        qualityTier: typeof primaryAudio?.audioQuality === "string" ? primaryAudio.audioQuality : null,
        effectiveQuality,
        fallbackUsed,
        fallbackReason,
      });
    }

    return result;
  };

  // Wrap JSON.parse and Response.prototype.json so streamingData.adaptiveFormats
  // can be tuned before YouTube Music's player selects a stream.
  const nativeJsonParse = JSON.parse;
  JSON.parse = function (...args) {
    return inspectAndOptimizePlayerResponse(Reflect.apply(nativeJsonParse, this, args), true);
  };

  if (typeof Response !== "undefined" && Response.prototype.json) {
    const nativeResponseJson = Response.prototype.json;
    Response.prototype.json = function (...args) {
      return Reflect.apply(nativeResponseJson, this, args).then((data) =>
        inspectAndOptimizePlayerResponse(data, true),
      );
    };
  }

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

  const getTrackAudioMeta = (videoId) => {
    if (!videoId) return null;
    let meta = trackAudioMeta.get(videoId) || null;
    if (!meta) {
      const p = player();
      if (p && typeof p.getPlayerResponse === "function") {
        try {
          inspectAndOptimizePlayerResponse(p.getPlayerResponse(), false);
          meta = trackAudioMeta.get(videoId) || null;
        } catch {}
      }
    }
    return meta;
  };

  // Nobody ever sees this page, but a music video still arrives as video and is
  // decoded frame by frame for a window that is never drawn. When separate
  // adaptive audio is present, hold video at its smallest picture so frames stop
  // costing GPU; for muxed-only video streams in high/lossless mode, keep a
  // higher tier so audio is never downgraded alongside 144p video.
  const applyPlayerQuality = () => {
    const p = player();
    if (!p || typeof p.setPlaybackQualityRange !== "function") return;
    const videoId = currentVideoId();
    const meta = getTrackAudioMeta(videoId);
    const activeTier = (videoId && trackQualityOverride.get(videoId)) || audioConfig.quality;
    const muxedOnly = meta && meta.hasAdaptiveAudio === false;
    if (muxedOnly && (activeTier === "high" || activeTier === "lossless")) {
      p.setPlaybackQualityRange("medium", "hd720");
    } else if (muxedOnly && trackQualityOverride.get(videoId) === "balanced") {
      p.setPlaybackQualityRange("small", "large");
    } else {
      p.setPlaybackQualityRange("tiny", "tiny");
    }
  };

  const clearStallTimer = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  const nextFallbackQuality = (tier) => {
    if (tier === "lossless") return "high";
    if (tier === "high") return "balanced";
    return null;
  };

  const recoverWithBestAvailableQuality = (trigger) => {
    const videoId = currentVideoId();
    if (!video || !videoId || isAdPlaying()) return false;
    const currentTier = trackQualityOverride.get(videoId) || audioConfig.quality;
    const nextTier = nextFallbackQuality(currentTier);
    if (!nextTier) return false;

    clearStallTimer();
    trackQualityOverride.set(videoId, nextTier);

    const existing = trackAudioMeta.get(videoId);
    if (existing) {
      trackAudioMeta.set(videoId, {
        ...existing,
        effectiveQuality: nextTier,
        fallbackUsed: true,
        fallbackReason:
          trigger === "error"
            ? "Lossless stream failed — switched to best available quality without stopping"
            : "Lossless stream stalled — switched to best available quality without stopping",
      });
    }

    const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shouldPlay = !video.paused || trigger === "error";
    recoveringTrack = { videoId, resumeAt, shouldPlay, until: Date.now() + RECOVERY_WINDOW_MS };

    applyPlayerQuality();
    send("audio");

    const p = player();
    if (p && typeof p.loadVideoById === "function") {
      p.loadVideoById(videoId, resumeAt);
    } else if (video.src) {
      try {
        video.load();
        if (resumeAt > 0.5) video.currentTime = resumeAt;
        if (shouldPlay) video.play().catch(() => {});
      } catch {}
    }
    return true;
  };

  // ── Web Audio Mastering & Clarity Chain ────────────────────
  const needsDsp = () =>
    audioConfig.quality === "lossless" ||
    audioConfig.profile !== "off" ||
    audioConfig.normalizeVolume === true;

  const isSafeAudioSource = (element) => {
    if (!element) return false;
    const src = element.currentSrc || element.getAttribute("src") || "";
    if (!src) return false;
    return src.startsWith("blob:") || src.startsWith(location.origin) || Boolean(element.crossOrigin);
  };

  const setParam = (param, value, now, tc = 0.05) => {
    if (!param) return;
    if (typeof param.setTargetAtTime === "function") {
      param.setTargetAtTime(value, now, tc);
    } else {
      param.value = value;
    }
  };

  const ensureAudioGraph = (element) => {
    if (audioGraph || audioGraphFailed || !element) return audioGraph;
    if (!needsDsp() || !isSafeAudioSource(element)) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioCtx !== "function") return null;

    try {
      const ctx = new AudioCtx({ latencyHint: "playback" });
      if (typeof ctx.createMediaElementSource !== "function") {
        audioGraphFailed = true;
        return null;
      }
      const source = ctx.createMediaElementSource(element);
      const highpass = ctx.createBiquadFilter();
      highpass.type = "peaking";
      highpass.frequency.value = 26;
      highpass.Q.value = 0.707;
      highpass.gain.value = 0;

      const eqSpecs = [
        ["lowshelf", 85, 0.707],
        ["peaking", 280, 1.1],
        ["peaking", 1000, 0.9],
        ["peaking", 3600, 1.1],
        ["highshelf", 11500, 0.707],
      ];
      const eq = eqSpecs.map(([type, freq, q]) => {
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        filter.gain.value = 0;
        return filter;
      });

      const normGain = ctx.createGain();
      normGain.gain.value = 1;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = 0;
      limiter.knee.value = 0;
      limiter.ratio.value = 1;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;

      let prev = source;
      prev.connect(highpass);
      prev = highpass;
      for (const band of eq) {
        prev.connect(band);
        prev = band;
      }
      prev.connect(normGain);
      normGain.connect(limiter);
      limiter.connect(ctx.destination);

      audioGraph = { ctx, element, source, highpass, eq, normGain, limiter };
      return audioGraph;
    } catch {
      audioGraphFailed = true;
      return null;
    }
  };

  const syncAudioGraph = () => {
    if (!video) return;
    const graph = ensureAudioGraph(video);
    if (!graph) {
      lastAppliedGainDb = null;
      return;
    }

    if (graph.ctx.state === "suspended" && typeof graph.ctx.resume === "function") {
      graph.ctx.resume().catch(() => {});
    }

    const now = typeof graph.ctx.currentTime === "number" ? graph.ctx.currentTime : 0;
    const lossless = audioConfig.quality === "lossless";
    const profile = audioConfig.profile;
    const activeDsp = lossless || profile !== "off" || audioConfig.normalizeVolume;

    if (lossless || profile !== "off") {
      graph.highpass.type = "highpass";
      setParam(graph.highpass.frequency, 26, now, 0.04);
      setParam(graph.highpass.Q, 0.707, now, 0.04);
    } else {
      graph.highpass.type = "peaking";
      setParam(graph.highpass.gain, 0, now, 0.04);
    }

    const bands =
      lossless && profile === "off"
        ? [0, 0, 0, 0, 0.8]
        : PROFILE_EQ_DB[profile] || PROFILE_EQ_DB.off;
    graph.eq.forEach((band, i) => setParam(band.gain, bands[i], now, 0.05));

    const meta = getTrackAudioMeta(currentVideoId());
    let normDb = 0;
    if (audioConfig.normalizeVolume && meta && typeof meta.loudnessDb === "number") {
      normDb = Math.max(-12, Math.min(7, -meta.loudnessDb));
    }
    const maxBoost = Math.max(0, ...bands);
    const headroomDb = activeDsp ? -maxBoost * 0.55 : 0;
    const totalGainDb = normDb + headroomDb;
    lastAppliedGainDb = activeDsp ? Math.round(totalGainDb * 10) / 10 : null;
    setParam(graph.normGain.gain, Math.pow(10, totalGainDb / 20), now, 0.06);

    if (activeDsp) {
      setParam(graph.limiter.threshold, lossless || audioConfig.normalizeVolume ? -1.5 : -1.0, now, 0.04);
      setParam(graph.limiter.knee, 6, now, 0.04);
      setParam(graph.limiter.ratio, 10, now, 0.04);
      setParam(graph.limiter.attack, 0.003, now, 0.04);
      setParam(graph.limiter.release, 0.15, now, 0.04);
    } else {
      setParam(graph.limiter.threshold, 0, now, 0.04);
      setParam(graph.limiter.knee, 0, now, 0.04);
      setParam(graph.limiter.ratio, 1, now, 0.04);
    }
  };

  const buildAudioInfo = (videoId) => {
    const meta = getTrackAudioMeta(videoId);
    const dspActive = Boolean(audioGraph && needsDsp());
    if (!meta && !dspActive) return null;

    let effectiveQuality = meta ? meta.effectiveQuality : audioConfig.quality;
    let fallbackUsed = Boolean(meta && meta.fallbackUsed);
    let fallbackReason = meta ? meta.fallbackReason : null;

    if (meta && audioConfig.quality === "lossless") {
      const hasHigh =
        meta.qualityTier === "AUDIO_QUALITY_HIGH" ||
        (typeof meta.bitrateKbps === "number" && meta.bitrateKbps >= 192);
      if (!hasHigh && meta.hasAdaptiveAudio !== false) {
        effectiveQuality =
          typeof meta.bitrateKbps === "number" && meta.bitrateKbps > 0 && meta.bitrateKbps < 96
            ? "balanced"
            : "high";
        fallbackUsed = true;
        fallbackReason =
          fallbackReason || "Lossless stream unavailable — playing best available audio";
      }
    } else if (meta && (audioConfig.quality === "balanced" || audioConfig.quality === "saver")) {
      if (!trackQualityOverride.has(videoId)) {
        effectiveQuality = audioConfig.quality;
        fallbackUsed = false;
        fallbackReason = null;
      }
    }

    return {
      codec: meta ? meta.codec : null,
      bitrateKbps: meta ? meta.bitrateKbps : null,
      sampleRate: meta ? meta.sampleRate : null,
      channels: meta ? meta.channels : null,
      qualityTier: meta ? meta.qualityTier : null,
      loudnessDb: meta ? meta.loudnessDb : null,
      dspActive,
      dspSampleRate: audioGraph && audioGraph.ctx.sampleRate ? Math.round(audioGraph.ctx.sampleRate) : null,
      normalizedGainDb: lastAppliedGainDb,
      effectiveQuality,
      fallbackUsed,
      fallbackReason,
    };
  };

  const send = (reason) => {
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;

    const videoId = currentVideoId();
    const metadata = navigator.mediaSession ? navigator.mediaSession.metadata : null;
    const artwork = metadata && metadata.artwork && metadata.artwork.length
      ? metadata.artwork[metadata.artwork.length - 1].src
      : null;
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;

    invoke("ytm_report", {
      state: {
        reason,
        videoId,
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
        audioInfo: buildAudioInfo(videoId),
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
    audioGraph = null;
    audioGraphFailed = false;
    lastProgressTime = -1;
    clearStallTimer();
    for (const type of ["play", "pause", "ended", "volumechange", "seeked"]) {
      element.addEventListener(type, () => {
        if (type === "play") {
          syncAudioGraph();
        } else if (type === "pause" || type === "ended" || type === "seeked") {
          clearStallTimer();
        }
        if (
          (type === "pause" || type === "ended") &&
          recoveringTrack &&
          Date.now() < recoveringTrack.until &&
          recoveringTrack.videoId === currentVideoId()
        ) {
          return;
        }
        send(type);
      });
    }
    element.addEventListener("playing", () => {
      clearStallTimer();
      if (recoveringTrack && recoveringTrack.videoId === currentVideoId()) {
        recoveringTrack = null;
      }
      send("play");
    });
    const scheduleStallCheck = () => {
      if (element.paused || isAdPlaying()) return;
      const vid = currentVideoId();
      if (!vid || !nextFallbackQuality(trackQualityOverride.get(vid) || audioConfig.quality)) return;
      clearStallTimer();
      const stalledAt = element.currentTime;
      stallTimer = setTimeout(() => {
        stallTimer = null;
        if (!element.paused && !isAdPlaying() && element.currentTime === stalledAt) {
          recoverWithBestAvailableQuality("stall");
        }
      }, STALL_FALLBACK_MS);
    };
    element.addEventListener("waiting", scheduleStallCheck);
    element.addEventListener("stalled", scheduleStallCheck);
    element.addEventListener("error", () => {
      if (!isAdPlaying()) {
        recoverWithBestAvailableQuality("error");
      }
    });
    element.addEventListener("loadedmetadata", () => {
      clearStallTimer();
      if (
        recoveringTrack &&
        recoveringTrack.videoId === currentVideoId() &&
        Date.now() < recoveringTrack.until
      ) {
        if (recoveringTrack.resumeAt > 0.5 && Math.abs(element.currentTime - recoveringTrack.resumeAt) > 1.5) {
          try {
            element.currentTime = recoveringTrack.resumeAt;
          } catch {}
        }
        if (recoveringTrack.shouldPlay && element.paused) {
          element.play().catch(() => {});
        }
      }
      applyPlayerQuality();
      syncAudioGraph();
      send("track");
      setTimeout(() => send("track"), METADATA_SETTLE_MS);
    });
    element.addEventListener("timeupdate", () => {
      if (element.currentTime !== lastProgressTime) {
        lastProgressTime = element.currentTime;
        clearStallTimer();
      }
      const now = Date.now();
      if (now - lastTimeReport >= TIME_REPORT_INTERVAL_MS) {
        lastTimeReport = now;
        send("time");
      }
    });
    applyPlayerQuality();
    syncAudioGraph();
    send("ready");
  };

  // The app keeps looking for the <video> element to handle creation or replacement.
  setInterval(() => {
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
        body = { query: String(request.query) };
        if (request.params) body.params = String(request.params);
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
        body = { browseId: id.startsWith("VL") || id.startsWith("MPRE") ? id : "VL" + id };
      } else if (request.kind === "artist") {
        body = { browseId: String(request.id) };
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
          syncAudioGraph();
          if (video) video.play().catch(() => send("blocked"));
          break;
        case "pause":
          if (video) video.pause();
          break;
        case "toggle":
          if (video) {
            if (video.paused) {
              syncAudioGraph();
              video.play().catch(() => send("blocked"));
            } else video.pause();
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
        case "audioConfig": {
          const prevQuality = audioConfig.quality;
          audioConfig = normalizeAudioConfig(value);
          if (audioConfig.quality !== prevQuality) {
            trackQualityOverride.clear();
          }
          saveAudioConfig(audioConfig);
          applyPlayerQuality();
          syncAudioGraph();
          send("audio");
          break;
        }
      }
    },
  });
})();
