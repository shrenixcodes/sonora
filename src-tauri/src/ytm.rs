//! YouTube Music bridge.
//!
//! Sonora plays music through the official music.youtube.com web app running
//! in a hidden webview with its own browser profile. The page reports playback
//! state through a single command (`ytm_report`), and the main window controls
//! playback through a fixed set of validated commands (`ytm_control`).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, Url, Webview, WebviewUrl, WebviewWindowBuilder};

pub const YTM_LABEL: &str = "ytm";
const YTM_HOME: &str = "https://music.youtube.com/";
const STATE_EVENT: &str = "ytm://state";
const RESPONSE_EVENT: &str = "ytm://response";
const MAX_QUERY_CHARS: usize = 200;
/// Catalog replies are JSON from YouTube Music's own API; a home feed is well under this.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const BRIDGE_SCRIPT: &str = include_str!("ytm_bridge.js");

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

    WebviewWindowBuilder::new(app, YTM_LABEL, WebviewUrl::External(home))
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
    ["youtube.com", "google.com"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn is_valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Builds the script evaluated in the YouTube Music page for a command.
fn command_script(command: &YtmCommand) -> Option<String> {
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
) -> Result<(), String> {
    if webview.label() != YTM_LABEL {
        return Err("playback state can only come from the YouTube Music window".into());
    }
    log::debug!("ytm state: {state:?}");
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
        let url = Url::parse(&format!("{YTM_HOME}watch?v={id}")).map_err(|e| e.to_string())?;
        return window.navigate(url).map_err(|e| e.to_string());
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
    let result = if visible {
        window.show().and_then(|_| window.set_focus())
    } else {
        window.hide()
    };
    result.map_err(|e| e.to_string())
}

/// Catalog requests the main window may ask the YouTube Music page to make.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum YtmRequest {
    Home,
    Search { query: String },
}

impl YtmRequest {
    fn validate(&self) -> Result<(), String> {
        match self {
            YtmRequest::Home => Ok(()),
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
        assert!(command_script(&YtmCommand::Load("dQw4w9WgXcQ".into())).is_none());
    }

    #[test]
    fn validates_catalog_requests() {
        assert!(YtmRequest::Home.validate().is_ok());
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
        assert_eq!(parsed, YtmRequest::Home);
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
