//! YouTube Music bridge.
//!
//! Sonora plays music through the official music.youtube.com web app running
//! in a hidden webview with its own browser profile. The page reports playback
//! state through a single command (`ytm_report`), and the main window controls
//! playback through a fixed set of validated commands (`ytm_control`).

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, Url, Webview, WebviewUrl, WebviewWindowBuilder};

pub const YTM_LABEL: &str = "ytm";
const YTM_HOME: &str = "https://music.youtube.com/";
const STATE_EVENT: &str = "ytm://state";
const RESPONSE_EVENT: &str = "ytm://response";
const MAX_QUERY_CHARS: usize = 200;
const MAX_PLAYLIST_ID_CHARS: usize = 100;
const MAX_CONTINUATION_CHARS: usize = 4096;
/// Catalog replies are JSON from YouTube Music's own API; a home feed is well under this.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const BRIDGE_SCRIPT: &str = include_str!("ytm_bridge.js");
#[cfg(windows)]
const AD_FILTER_SCRIPT: &str = include_str!("ytm_ad_filter.js");

#[cfg(windows)]
#[path = "adblock.rs"]
mod adblock;

/// wry passes these by default; setting our own arguments replaces them, so they are repeated here.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
     --autoplay-policy=no-user-gesture-required";

/// Playback snapshot reported by the bridge script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YtmState {
    pub reason: String,
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub paused: bool,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
    /// True while YouTube plays an ad; metadata then describes the ad, not a track.
    pub ad: bool,
    /// YouTube Music's own signed-in flag for this page.
    #[serde(default)]
    pub signed_in: bool,
}

/// Last signed-in flag seen, to notice the moment a sign-in completes.
#[derive(Default)]
pub struct AccountState(AtomicBool);

/// True when a report shows a sign-in that has just completed.
fn sign_in_completed(was_signed_in: bool, state: &YtmState) -> bool {
    !was_signed_in && state.signed_in
}

/// Commands the main window may send to the YouTube Music page.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "action", content = "value", rename_all = "camelCase")]
pub enum YtmCommand {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Seek(f64),
    Volume(f64),
    Load(String),
}

pub fn create_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let profile_dir = app.path().app_data_dir()?.join("ytm-profile");
    let home: Url = YTM_HOME.parse().expect("YTM_HOME is a valid URL");

    let builder = WebviewWindowBuilder::new(app, YTM_LABEL, WebviewUrl::External(home));
    #[cfg(windows)]
    let builder = builder.initialization_script(AD_FILTER_SCRIPT);
    let window = builder
        .title("Sign in to YouTube Music")
        .inner_size(1000.0, 720.0)
        .center()
        .visible(false)
        .skip_taskbar(true)
        .data_directory(profile_dir)
        .additional_browser_args(BROWSER_ARGS)
        .initialization_script(BRIDGE_SCRIPT)
        .on_navigation(|url| {
            let allowed = is_allowed_navigation(url);
            if !allowed {
                log::warn!("blocked navigation in YouTube Music window: {url}");
            }
            allowed
        })
        .build()?;

    #[cfg(windows)]
    adblock::attach(&window)?;
    #[cfg(not(windows))]
    let _ = window;

    Ok(())
}

/// Keeps the hidden window on YouTube and Google sign-in pages.
fn is_allowed_navigation(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let is_youtube = host == "youtube.com" || host.ends_with(".youtube.com");
    is_youtube || is_google_host(host)
}

/// `google.com` or one of Google's country domains (`google.co.in`, `google.de`,
/// `google.com.br`, ...), with any subdomain. Sign-in hops through the user's
/// country domain to set cookies there; blocking it leaves buttons on Google's
/// pages doing nothing.
fn is_google_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    let Some(at) = labels.iter().rposition(|label| *label == "google") else {
        return false;
    };
    let is_country =
        |label: &str| label.len() == 2 && label.chars().all(|c| c.is_ascii_lowercase());
    match &labels[at + 1..] {
        ["com"] => true,
        [country] => is_country(country),
        ["co" | "com", country] => is_country(country),
        _ => false,
    }
}

/// Any allowed page other than YouTube Music itself is part of signing in.
fn is_sign_in_page(url: &Url) -> bool {
    url.host_str() != Some("music.youtube.com")
}

fn is_valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Builds the script evaluated in the YouTube Music page for a command.
fn command_script(command: &YtmCommand) -> Option<String> {
    // The id is written into the script as a string, so it is checked here.
    // A page that has not injected the bridge yet still has to navigate.
    if let YtmCommand::Load(id) = command {
        if !is_valid_video_id(id) {
            return None;
        }
        return Some(format!(
            "window.__sonoraBridge ? window.__sonoraBridge.exec(\"load\", \"{id}\") \n             : location.assign(\"/watch?v={id}\");"
        ));
    }
    let (action, value) = match command {
        YtmCommand::Play => ("play", None),
        YtmCommand::Pause => ("pause", None),
        YtmCommand::Toggle => ("toggle", None),
        YtmCommand::Next => ("next", None),
        YtmCommand::Previous => ("previous", None),
        YtmCommand::Seek(seconds) if seconds.is_finite() && *seconds >= 0.0 => {
            ("seek", Some(*seconds))
        }
        YtmCommand::Volume(level) if level.is_finite() => ("volume", Some(level.clamp(0.0, 1.0))),
        _ => return None,
    };
    let value = value.map_or_else(|| "null".to_string(), |v| v.to_string());
    Some(format!(
        "window.__sonoraBridge && window.__sonoraBridge.exec(\"{action}\", {value});"
    ))
}

#[tauri::command]
pub fn ytm_report<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: YtmState,
    account: tauri::State<'_, AccountState>,
) -> Result<(), String> {
    if webview.label() != YTM_LABEL {
        return Err("playback state can only come from the YouTube Music window".into());
    }
    log::debug!("ytm state: {state:?}");

    let was_signed_in = account.0.swap(state.signed_in, Ordering::SeqCst);
    if sign_in_completed(was_signed_in, &state) {
        // The user just finished signing in; put the window away again.
        log::info!("signed in to YouTube Music");
        let _ = ytm_set_signin_visible(app.clone(), false);
    }
    app.emit_to("main", STATE_EVENT, state)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ytm_control<R: Runtime>(app: AppHandle<R>, command: YtmCommand) -> Result<(), String> {
    let window = app
        .get_webview_window(YTM_LABEL)
        .ok_or("YouTube Music window is not available")?;

    if let YtmCommand::Load(id) = &command {
        if !is_valid_video_id(id) {
            return Err(format!("invalid video id: {id}"));
        }
        // Loading would throw away a sign-in in progress.
        if window.is_visible().unwrap_or(false) && window.url().is_ok_and(|u| is_sign_in_page(&u)) {
            return Err("finish signing in to YouTube Music first".into());
        }
        // The running page can swap the track itself. Only a page that is not
        // on YouTube Music yet, such as one left on a sign-in hop, has to
        // navigate, and reloading the whole app is what that costs.
        if window.url().is_ok_and(|u| is_sign_in_page(&u)) {
            let url = Url::parse(&format!("{YTM_HOME}watch?v={id}")).map_err(|e| e.to_string())?;
            return window.navigate(url).map_err(|e| e.to_string());
        }
    }

    let script = command_script(&command).ok_or("invalid command value")?;
    window.eval(&script).map_err(|e| e.to_string())
}

/// Shows the YouTube Music window so the user can sign in, or hides it again.
#[tauri::command]
pub fn ytm_set_signin_visible<R: Runtime>(app: AppHandle<R>, visible: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(YTM_LABEL)
        .ok_or("YouTube Music window is not available")?;
    // A taskbar entry while open, so the sign-in window can't get lost behind others.
    let result = if visible {
        window
            .set_skip_taskbar(false)
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
    } else {
        window.hide().and_then(|_| window.set_skip_taskbar(true))
    };
    result.map_err(|e| e.to_string())
}

/// Signs out by wiping the YouTube Music window's own browser profile (it is
/// separate from Sonora's interface) and reloading YouTube Music.
#[tauri::command]
pub fn ytm_sign_out<R: Runtime>(
    app: AppHandle<R>,
    account: tauri::State<'_, AccountState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(YTM_LABEL)
        .ok_or("YouTube Music window is not available")?;
    window
        .clear_all_browsing_data()
        .map_err(|e| e.to_string())?;
    account.0.store(false, Ordering::SeqCst);
    let home: Url = YTM_HOME.parse().expect("YTM_HOME is a valid URL");
    window.navigate(home).map_err(|e| e.to_string())?;
    log::info!("signed out of YouTube Music");
    Ok(())
}

/// Catalog requests the main window may ask the YouTube Music page to make.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum YtmRequest {
    Home {
        /// A mood or genre chip from the top of Home.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<String>,
    },
    Search {
        query: String,
    },
    LikedSongs,
    LibraryPlaylists,
    LibraryAlbums,
    LibraryArtists,
    AccountInfo,
    Explore,
    Playlist {
        id: String,
    },
    WatchPlaylist {
        id: String,
    },
    /// Next page of a list the page already returned.
    Continuation {
        token: String,
    },
}

/// Playlist ids and continuation tokens are URL-safe text; anything else is rejected.
fn is_token_text(value: &str, max: usize, extra: &[char]) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || extra.contains(&c))
}

impl YtmRequest {
    fn validate(&self) -> Result<(), String> {
        match self {
            YtmRequest::Home { params: None }
            | YtmRequest::LikedSongs
            | YtmRequest::LibraryPlaylists
            | YtmRequest::LibraryAlbums
            | YtmRequest::LibraryArtists
            | YtmRequest::AccountInfo
            | YtmRequest::Explore => Ok(()),
            YtmRequest::Home {
                params: Some(params),
            } => {
                if is_token_text(params, MAX_CONTINUATION_CHARS, &['%', '=']) {
                    Ok(())
                } else {
                    Err("invalid home filter".into())
                }
            }
            YtmRequest::Playlist { id } | YtmRequest::WatchPlaylist { id } => {
                if is_token_text(id, MAX_PLAYLIST_ID_CHARS, &[]) {
                    Ok(())
                } else {
                    Err("invalid playlist id".into())
                }
            }
            YtmRequest::Continuation { token } => {
                if is_token_text(token, MAX_CONTINUATION_CHARS, &['%', '=']) {
                    Ok(())
                } else {
                    Err("invalid continuation token".into())
                }
            }
            YtmRequest::Search { query } => {
                let len = query.trim().chars().count();
                if len == 0 || len > MAX_QUERY_CHARS {
                    Err(format!(
                        "search query must be 1 to {MAX_QUERY_CHARS} characters"
                    ))
                } else {
                    Ok(())
                }
            }
        }
    }
}

/// Builds the script that asks the page to run a catalog request.
fn request_script(id: u32, request: &YtmRequest) -> Result<String, String> {
    // JSON is a valid JavaScript literal, so user text cannot break out of the call.
    let payload = serde_json::to_string(request).map_err(|e| e.to_string())?;
    // While the page is still loading the bridge is missing; say so at once
    // instead of letting the request wait for its timeout.
    Ok(format!(
        "if (window.__sonoraBridge) {{ window.__sonoraBridge.request({id}, {payload}); }}          else if (window.__TAURI_INTERNALS__) {{ window.__TAURI_INTERNALS__.invoke(\"ytm_response\",          {{ id: {id}, ok: false, body: \"not-ready\" }}).catch(() => {{}}); }}"
    ))
}

#[derive(Debug, Clone, Serialize)]
struct YtmResponse {
    id: u32,
    ok: bool,
    body: String,
}

#[tauri::command]
pub fn ytm_request<R: Runtime>(
    app: AppHandle<R>,
    id: u32,
    request: YtmRequest,
) -> Result<(), String> {
    request.validate()?;
    log::debug!("catalog request {id}: {request:?}");
    let window = app
        .get_webview_window(YTM_LABEL)
        .ok_or("YouTube Music window is not available")?;
    window.eval(&request_script(id, &request)?).map_err(|e| {
        log::warn!("catalog request {id} could not reach the page: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn ytm_response<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    id: u32,
    ok: bool,
    body: String,
) -> Result<(), String> {
    if webview.label() != YTM_LABEL {
        return Err("catalog responses can only come from the YouTube Music window".into());
    }
    let response = if body.len() > MAX_RESPONSE_BYTES {
        log::warn!(
            "dropped oversized catalog response {id} ({} bytes)",
            body.len()
        );
        YtmResponse {
            id,
            ok: false,
            body: "response too large".into(),
        }
    } else {
        YtmResponse { id, ok, body }
    };
    log::debug!(
        "catalog response {id}: ok={} ({} bytes)",
        response.ok,
        response.body.len()
    );
    app.emit_to("main", RESPONSE_EVENT, response)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn allows_google_country_domains_used_during_sign_in() {
        assert!(is_allowed_navigation(&url(
            "https://accounts.google.co.in/accounts/SetSID"
        )));
        assert!(is_allowed_navigation(&url("https://www.google.de/")));
        assert!(is_allowed_navigation(&url(
            "https://accounts.google.com.br/"
        )));
        assert!(is_allowed_navigation(&url("https://google.co.uk/")));
    }

    #[test]
    fn rejects_look_alike_google_domains() {
        assert!(!is_allowed_navigation(&url("https://google.evil.com/")));
        assert!(!is_allowed_navigation(&url("https://notgoogle.co.in/")));
        assert!(!is_allowed_navigation(&url(
            "https://google.co.in.evil.net/"
        )));
        assert!(!is_allowed_navigation(&url("https://google.com.evil.net/")));
        assert!(!is_allowed_navigation(&url("https://google.xyz.in/")));
        assert!(!is_allowed_navigation(&url(
            "http://accounts.google.co.in/"
        )));
    }

    #[test]
    fn allows_youtube_and_google_sign_in() {
        assert!(is_allowed_navigation(&url(
            "https://music.youtube.com/watch?v=abc"
        )));
        assert!(is_allowed_navigation(&url(
            "https://accounts.google.com/signin"
        )));
        assert!(is_allowed_navigation(&url("https://consent.youtube.com/")));
    }

    #[test]
    fn blocks_other_hosts_and_plain_http() {
        assert!(!is_allowed_navigation(&url("http://music.youtube.com/")));
        assert!(!is_allowed_navigation(&url("https://example.com/")));
        assert!(!is_allowed_navigation(&url(
            "https://youtube.com.evil.net/"
        )));
        assert!(!is_allowed_navigation(&url("https://notyoutube.com/")));
    }

    #[test]
    fn validates_video_ids() {
        assert!(is_valid_video_id("dQw4w9WgXcQ"));
        assert!(is_valid_video_id("a-b_c-d_e-f"));
        assert!(!is_valid_video_id("short"));
        assert!(!is_valid_video_id("dQw4w9WgXc\""));
        assert!(!is_valid_video_id("dQw4w9WgXcQQ"));
    }

    #[test]
    fn builds_scripts_only_for_valid_values() {
        assert_eq!(
            command_script(&YtmCommand::Seek(30.5)).unwrap(),
            "window.__sonoraBridge && window.__sonoraBridge.exec(\"seek\", 30.5);"
        );
        assert!(
            command_script(&YtmCommand::Volume(3.0))
                .unwrap()
                .contains("\"volume\", 1)")
        );
        assert!(command_script(&YtmCommand::Seek(-1.0)).is_none());
        assert!(command_script(&YtmCommand::Seek(f64::NAN)).is_none());

        let load = command_script(&YtmCommand::Load("dQw4w9WgXcQ".into())).unwrap();
        assert!(load.contains("exec(\"load\", \"dQw4w9WgXcQ\")"));
        assert!(load.contains("/watch?v=dQw4w9WgXcQ"));
        // An id that could break out of the string never reaches the page.
        assert!(command_script(&YtmCommand::Load("a\");alert(1)//".into())).is_none());
        assert!(command_script(&YtmCommand::Load("short".into())).is_none());
    }

    #[test]
    fn treats_google_and_youtube_pages_as_sign_in() {
        let url = |s: &str| Url::parse(s).unwrap();
        assert!(is_sign_in_page(&url(
            "https://accounts.google.com/v3/signin"
        )));
        assert!(is_sign_in_page(&url("https://www.youtube.com/signin")));
        assert!(!is_sign_in_page(&url(
            "https://music.youtube.com/watch?v=abc"
        )));
    }

    #[test]
    fn notices_only_the_moment_sign_in_completes() {
        let state = |signed_in| YtmState {
            reason: "ready".into(),
            video_id: None,
            title: None,
            artist: None,
            album: None,
            artwork_url: None,
            paused: true,
            current_time: 0.0,
            duration: 0.0,
            volume: 1.0,
            muted: false,
            ad: false,
            signed_in,
        };
        assert!(sign_in_completed(false, &state(true)));
        assert!(!sign_in_completed(true, &state(true)));
        assert!(!sign_in_completed(false, &state(false)));
        assert!(!sign_in_completed(true, &state(false)));
    }

    #[test]
    fn older_reports_without_the_flag_count_as_signed_out() {
        let parsed: YtmState = serde_json::from_str(
            r#"{"reason":"ready","videoId":null,"title":null,"artist":null,"album":null,
                "artworkUrl":null,"paused":true,"currentTime":0,"duration":0,"volume":1,
                "muted":false,"ad":false}"#,
        )
        .unwrap();
        assert!(!parsed.signed_in);
    }

    #[test]
    fn validates_catalog_requests() {
        assert!(YtmRequest::Home { params: None }.validate().is_ok());
        assert!(
            YtmRequest::Home {
                params: Some("ggMPOg1uX1%3D".into())
            }
            .validate()
            .is_ok()
        );
        assert!(
            YtmRequest::Home {
                params: Some("<x>".into())
            }
            .validate()
            .is_err()
        );
        assert!(
            YtmRequest::WatchPlaylist {
                id: "RDTMAK5uy_abc".into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            YtmRequest::Search {
                query: "lofi".into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            YtmRequest::Search {
                query: "   ".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            YtmRequest::Search {
                query: "x".repeat(201)
            }
            .validate()
            .is_err()
        );
        assert!(YtmRequest::LikedSongs.validate().is_ok());
        assert!(
            YtmRequest::Playlist {
                id: "PLabc_-1".into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            YtmRequest::Playlist {
                id: "PL\"; x".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            YtmRequest::Playlist { id: String::new() }
                .validate()
                .is_err()
        );
        assert!(
            YtmRequest::Continuation {
                token: "4qmFsgK%3D".into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            YtmRequest::Continuation {
                token: "a b".into()
            }
            .validate()
            .is_err()
        );
        let parsed: YtmRequest = serde_json::from_str(r#"{"kind":"likedSongs"}"#).unwrap();
        assert_eq!(parsed, YtmRequest::LikedSongs);
    }

    #[test]
    fn embeds_requests_as_json_so_text_cannot_escape() {
        let script = request_script(
            7,
            &YtmRequest::Search {
                query: "a\"); alert(1); (\"".into(),
            },
        )
        .unwrap();
        assert!(script.contains(
            r#"window.__sonoraBridge.request(7, {"kind":"search","query":"a\"); alert(1); (\""});"#
        ));
        assert!(script.contains(r#"{ id: 7, ok: false, body: "not-ready" }"#));
        let parsed: YtmRequest = serde_json::from_str(r#"{"kind":"home"}"#).unwrap();
        assert_eq!(parsed, YtmRequest::Home { params: None });
        assert!(serde_json::from_str::<YtmRequest>(r#"{"kind":"deleteAccount"}"#).is_err());
    }

    #[test]
    fn parses_commands_from_the_frontend() {
        let seek: YtmCommand = serde_json::from_str(r#"{"action":"seek","value":12}"#).unwrap();
        assert_eq!(seek, YtmCommand::Seek(12.0));
        let next: YtmCommand = serde_json::from_str(r#"{"action":"next"}"#).unwrap();
        assert_eq!(next, YtmCommand::Next);
        assert!(serde_json::from_str::<YtmCommand>(r#"{"action":"runScript"}"#).is_err());
    }
}
