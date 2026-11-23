use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_DISCORD_CLIENT_ID: &str = "463151177836658699";

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
pub fn discord_clear_activity(
    state: tauri::State<'_, DiscordRpcState>,
) {
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

fn run_discord_worker(receiver: Receiver<DiscordCommand>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut current_client_id = String::new();

    while let Ok(cmd) = receiver.recv() {
        match cmd {
            DiscordCommand::SetActivity(payload) => {
                let target_client_id = payload
                    .client_id
                    .as_deref()
                    .unwrap_or(DEFAULT_DISCORD_CLIENT_ID);

                // If client id changed, reconnect
                if client.is_some() && current_client_id != target_client_id {
                    if let Some(mut old_client) = client.take() {
                        let _ = old_client.close();
                    }
                }

                if client.is_none() {
                    let mut new_client = DiscordIpcClient::new(target_client_id);
                    match new_client.connect() {
                        Ok(()) => {
                            current_client_id = target_client_id.to_string();
                            client = Some(new_client);
                        }
                        Err(e) => {
                            log::debug!("Discord IPC connection failed: {:?}", e);
                        }
                    }
                }

                if let Some(ref mut ipc) = client {
                    let title = sanitize_text(&payload.title, "Sonora Track");
                    let artist = sanitize_text(&payload.artist, "YouTube Music");

                    let mut act = activity::Activity::new();
                    act = act
                        .activity_type(activity::ActivityType::Listening)
                        .status_display_type(activity::StatusDisplayType::Details)
                        .details(title)
                        .state(artist);

                    let mut assets = activity::Assets::new();
                    if let Some(ref art) = payload.artwork_url {
                        if !art.trim().is_empty() {
                            assets = assets.large_image(art.trim());
                        }
                    }
                    if let Some(ref alb) = payload.album {
                        assets = assets.large_text(sanitize_text(alb, "Sonora"));
                    } else {
                        assets = assets.large_text("Sonora");
                    }

                    if payload.is_playing {
                        assets = assets.small_image("play").small_text("Playing");
                    } else {
                        assets = assets.small_image("pause").small_text("Paused");
                    }
                    act = act.assets(assets);

                    if payload.is_playing {
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64;
                        let mut timestamps = activity::Timestamps::new();
                        let elapsed = payload.elapsed_seconds.unwrap_or(0) as i64;
                        let start_time = now.saturating_sub(elapsed);
                        timestamps = timestamps.start(start_time);
                        if let Some(dur) = payload.duration_seconds {
                            let dur = dur as i64;
                            if dur > elapsed {
                                timestamps = timestamps.end(start_time + dur);
                            }
                        }
                        act = act.timestamps(timestamps);
                    }

                    if let Err(e) = ipc.set_activity(act) {
                        log::debug!("Discord set_activity failed: {:?}; disconnecting", e);
                        let _ = ipc.close();
                        client = None;
                    }
                }
            }
            DiscordCommand::ClearActivity => {
                if let Some(ref mut ipc) = client {
                    if let Err(e) = ipc.clear_activity() {
                        log::debug!("Discord clear_activity failed: {:?}", e);
                        let _ = ipc.close();
                        client = None;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_text() {
        assert_eq!(sanitize_text("   ", "Fallback"), "Fallback");
        assert_eq!(sanitize_text("A", "Fallback"), "Fallback");
        assert_eq!(sanitize_text("Starboy", "Fallback"), "Starboy");
        assert_eq!(sanitize_text(" 4U ", "Fallback"), "4U");
    }

    #[test]
    fn test_discord_payload_serialization() {
        let payload = DiscordActivityPayload {
            title: "Test Track".into(),
            artist: "Test Artist".into(),
            album: Some("Test Album".into()),
            artwork_url: Some("https://example.com/art.jpg".into()),
            duration_seconds: Some(180),
            elapsed_seconds: Some(45),
            is_playing: true,
            client_id: None,
        };

        let json = serde_json::to_string(&payload).expect("serialization failed");
        assert!(json.contains("Test Track"));
        assert!(json.contains("Test Artist"));
        assert!(json.contains("isPlaying"));
    }
}

