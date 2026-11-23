use discord_rich_presence::{DiscordIpc, DiscordIpcClient, activity};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const DEFAULT_DISCORD_CLIENT_ID: &str = "463151177836658699";

/// How often to look for Discord again while it is not running yet, or has
/// gone away. People open Sonora and Discord in either order.
const RETRY_INTERVAL: Duration = Duration::from_secs(15);

/// How often the activity is sent again while connected. Writing is the only
/// way to notice that Discord restarted and dropped the old connection, and a
/// song can play for minutes without anything else changing.
const REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordActivityPayload {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_seconds: Option<u64>,
    pub elapsed_seconds: Option<u64>,
    pub is_playing: bool,
    pub client_id: Option<String>,
}

pub enum DiscordCommand {
    SetActivity(DiscordActivityPayload),
    ClearActivity,
}

pub struct DiscordRpcState {
    sender: Sender<DiscordCommand>,
}

impl DiscordRpcState {
    pub fn new() -> Self {
        let (sender, receiver) = channel::<DiscordCommand>();
        thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || {
                run_discord_worker(receiver);
            })
            .expect("failed to spawn discord-rpc thread");

        Self { sender }
    }

    pub fn set_activity(&self, payload: DiscordActivityPayload) {
        let _ = self.sender.send(DiscordCommand::SetActivity(payload));
    }

    pub fn clear_activity(&self) {
        let _ = self.sender.send(DiscordCommand::ClearActivity);
    }
}

#[tauri::command]
pub fn discord_set_activity(
    state: tauri::State<'_, DiscordRpcState>,
    payload: DiscordActivityPayload,
) {
    state.set_activity(payload);
}

#[tauri::command]
pub fn discord_clear_activity(state: tauri::State<'_, DiscordRpcState>) {
    state.clear_activity();
}

impl Default for DiscordRpcState {
    fn default() -> Self {
        Self::new()
    }
}

fn sanitize_text<'a>(s: &'a str, fallback: &'a str) -> &'a str {
    let trimmed = s.trim();
    if trimmed.chars().count() >= 2 {
        trimmed
    } else {
        fallback
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// What Sonora wants Discord to show. Progress is pinned to wall-clock times
/// when the update arrives, so sending it again later stays accurate.
struct Presence {
    payload: DiscordActivityPayload,
    start: Option<i64>,
    end: Option<i64>,
}

impl Presence {
    fn new(payload: DiscordActivityPayload, now: i64) -> Self {
        let (start, end) = if payload.is_playing {
            let elapsed = payload.elapsed_seconds.unwrap_or(0) as i64;
            let start = now.saturating_sub(elapsed);
            let end = payload
                .duration_seconds
                .map(|d| d as i64)
                .filter(|&d| d > elapsed)
                .map(|d| start + d);
            (Some(start), end)
        } else {
            (None, None)
        };
        Self {
            payload,
            start,
            end,
        }
    }

    fn client_id(&self) -> &str {
        self.payload
            .client_id
            .as_deref()
            .unwrap_or(DEFAULT_DISCORD_CLIENT_ID)
    }

    fn activity(&self) -> activity::Activity<'_> {
        let payload = &self.payload;

        let mut assets = activity::Assets::new().large_text(sanitize_text(
            payload.album.as_deref().unwrap_or(""),
            "Sonora",
        ));
        if let Some(art) = payload
            .artwork_url
            .as_deref()
            .map(str::trim)
            .filter(|art| !art.is_empty())
        {
            assets = assets.large_image(art);
        }
        assets = if payload.is_playing {
            assets.small_image("play").small_text("Playing")
        } else {
            assets.small_image("pause").small_text("Paused")
        };

        let mut act = activity::Activity::new()
            .activity_type(activity::ActivityType::Listening)
            .status_display_type(activity::StatusDisplayType::Details)
            .details(sanitize_text(&payload.title, "Sonora Track"))
            .state(sanitize_text(&payload.artist, "YouTube Music"))
            .assets(assets);

        if let Some(start) = self.start {
            let mut timestamps = activity::Timestamps::new().start(start);
            if let Some(end) = self.end {
                timestamps = timestamps.end(end);
            }
            act = act.timestamps(timestamps);
        }
        act
    }
}

struct Connection {
    ipc: DiscordIpcClient,
    client_id: String,
}

fn connect(client_id: &str) -> Option<Connection> {
    let mut ipc = DiscordIpcClient::new(client_id);
    match ipc.connect() {
        Ok(()) => Some(Connection {
            ipc,
            client_id: client_id.to_string(),
        }),
        Err(e) => {
            log::debug!("Discord IPC connection failed: {:?}", e);
            None
        }
    }
}

fn disconnect(connection: &mut Option<Connection>) {
    if let Some(mut old) = connection.take() {
        let _ = old.ipc.close();
    }
}

/// Sends the presence, connecting first if needed. A dead connection (Discord
/// restarted since the last write) is replaced once before giving up until
/// the next retry.
fn deliver(connection: &mut Option<Connection>, presence: &Presence) -> bool {
    for _ in 0..2 {
        if connection
            .as_ref()
            .is_some_and(|c| c.client_id != presence.client_id())
        {
            disconnect(connection);
        }
        if connection.is_none() {
            *connection = connect(presence.client_id());
        }
        let Some(conn) = connection.as_mut() else {
            return false;
        };
        match conn.ipc.set_activity(presence.activity()) {
            Ok(()) => return true,
            Err(e) => {
                log::debug!("Discord set_activity failed: {:?}; reconnecting", e);
                disconnect(connection);
            }
        }
    }
    false
}

fn run_discord_worker(receiver: Receiver<DiscordCommand>) {
    let mut connection: Option<Connection> = None;
    let mut presence: Option<Presence> = None;
    // When the current presence last reached Discord; None until it has.
    let mut last_sent: Option<Instant> = None;

    loop {
        match receiver.recv_timeout(RETRY_INTERVAL) {
            Ok(DiscordCommand::SetActivity(payload)) => {
                presence = Some(Presence::new(payload, unix_now()));
                last_sent = None;
            }
            Ok(DiscordCommand::ClearActivity) => {
                presence = None;
                if let Some(conn) = connection.as_mut()
                    && let Err(e) = conn.ipc.clear_activity()
                {
                    log::debug!("Discord clear_activity failed: {:?}", e);
                    disconnect(&mut connection);
                }
                continue;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        let Some(current) = presence.as_ref() else {
            continue;
        };
        if last_sent.is_some_and(|sent| sent.elapsed() < REFRESH_INTERVAL) {
            continue;
        }
        if deliver(&mut connection, current) {
            last_sent = Some(Instant::now());
        }
    }

    disconnect(&mut connection);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(is_playing: bool) -> DiscordActivityPayload {
        DiscordActivityPayload {
            title: "Test Track".into(),
            artist: "Test Artist".into(),
            album: Some("Test Album".into()),
            artwork_url: Some("https://example.com/art.jpg".into()),
            duration_seconds: Some(180),
            elapsed_seconds: Some(45),
            is_playing,
            client_id: None,
        }
    }

    #[test]
    fn test_sanitize_text() {
        assert_eq!(sanitize_text("   ", "Fallback"), "Fallback");
        assert_eq!(sanitize_text("A", "Fallback"), "Fallback");
        assert_eq!(sanitize_text("Starboy", "Fallback"), "Starboy");
        assert_eq!(sanitize_text(" 4U ", "Fallback"), "4U");
    }

    #[test]
    fn test_discord_payload_serialization() {
        let json = serde_json::to_string(&payload(true)).expect("serialization failed");
        assert!(json.contains("Test Track"));
        assert!(json.contains("Test Artist"));
        assert!(json.contains("isPlaying"));
    }

    #[test]
    fn playing_presence_pins_progress_to_wall_clock() {
        let presence = Presence::new(payload(true), 1_000);
        assert_eq!(presence.start, Some(955));
        assert_eq!(presence.end, Some(1_135));
    }

    #[test]
    fn paused_presence_has_no_progress() {
        let presence = Presence::new(payload(false), 1_000);
        assert_eq!(presence.start, None);
        assert_eq!(presence.end, None);
    }

    #[test]
    fn presence_has_no_end_once_elapsed_passes_duration() {
        let mut p = payload(true);
        p.duration_seconds = Some(30);
        assert_eq!(Presence::new(p, 1_000).end, None);
    }

    #[test]
    fn presence_uses_default_client_id() {
        assert_eq!(
            Presence::new(payload(true), 0).client_id(),
            DEFAULT_DISCORD_CLIENT_ID
        );
    }
}
