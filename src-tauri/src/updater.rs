//! GitHub Releases update checker and Windows installer launcher.
//!
//! Queries GitHub's latest release endpoint for the configured repository,
//! compares semantic versions against the compiled package version, downloads
//! Windows NSIS installers over HTTPS from trusted GitHub release hosts, and
//! launches the installer before exiting the running instance.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_API_URL: &str = "https://api.github.com/repos/shrenixcodes/sonora/releases/latest";
const LATEST_RELEASE_PAGE: &str = concat!(env!("CARGO_PKG_REPOSITORY"), "/releases/latest");
const USER_AGENT: &str = concat!("Sonora/", env!("CARGO_PKG_VERSION"));
const MAX_API_BYTES: u64 = 1024 * 1024;
const MAX_INSTALLER_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: Option<String>,
    pub release_notes: Option<String>,
    pub release_url: String,
    pub installer_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size_bytes: Option<u64>,
    pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, PartialEq, Eq)]
struct Semver {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

fn parse_semver(raw: &str) -> Option<Semver> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }
    let (core, prerelease) = match trimmed.split_once('-') {
        Some((left, right)) => {
            let clean_pre = right.split('+').next().unwrap_or(right).trim();
            (
                left,
                if clean_pre.is_empty() {
                    None
                } else {
                    Some(clean_pre.to_string())
                },
            )
        }
        None => (trimmed.split('+').next().unwrap_or(trimmed), None),
    };

    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }

    Some(Semver {
        major,
        minor,
        patch,
        prerelease,
    })
}

/// Returns true when `latest` represents a strictly newer version than `current`.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let (Some(curr), Some(next)) = (parse_semver(current), parse_semver(latest)) else {
        return false;
    };

    if (next.major, next.minor, next.patch) != (curr.major, curr.minor, curr.patch) {
        return (next.major, next.minor, next.patch) > (curr.major, curr.minor, curr.patch);
    }

    // Stable release beats same X.Y.Z prerelease; prerelease does not beat stable.
    match (&curr.prerelease, &next.prerelease) {
        (Some(_), None) => true,
        (Some(a), Some(b)) => b > a,
        _ => false,
    }
}

/// Ensures update links and installer downloads use HTTPS on known GitHub hosts.
pub fn is_trusted_release_url(url: &str) -> bool {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    host == "github.com"
        || host == "api.github.com"
        || host == "objects.githubusercontent.com"
        || host == "release-assets.githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

fn select_windows_installer(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    let mut exe_assets = assets
        .iter()
        .filter(|asset| {
            let lower = asset.name.to_ascii_lowercase();
            lower.ends_with(".exe") && is_trusted_release_url(&asset.browser_download_url)
        })
        .collect::<Vec<_>>();

    exe_assets.sort_by_key(|asset| {
        let lower = asset.name.to_ascii_lowercase();
        let arch_match = lower.contains("x64") || lower.contains("x86_64");
        let setup_match = lower.contains("setup") || lower.contains("nsis");
        (!setup_match, !arch_match)
    });

    exe_assets.into_iter().next()
}

pub fn parse_release_payload(current_version: &str, json_body: &str) -> Result<ReleaseCheckResult, String> {
    let release: GitHubRelease =
        serde_json::from_str(json_body).map_err(|e| format!("Invalid release metadata: {e}"))?;

    let latest_clean = release.tag_name.trim().trim_start_matches(['v', 'V']).to_string();
    let update_available = !release.draft
        && !release.prerelease
        && is_newer_version(current_version, &latest_clean);

    let asset = select_windows_installer(&release.assets);
    let release_url = if is_trusted_release_url(&release.html_url) {
        release.html_url
    } else {
        LATEST_RELEASE_PAGE.to_string()
    };

    Ok(ReleaseCheckResult {
        current_version: current_version.to_string(),
        latest_version: if latest_clean.is_empty() {
            current_version.to_string()
        } else {
            latest_clean
        },
        update_available,
        release_name: release.name.filter(|s| !s.trim().is_empty()),
        release_notes: release.body.map(|b| b.trim().to_string()).filter(|s| !s.is_empty()),
        release_url,
        installer_url: asset.map(|a| a.browser_download_url.clone()),
        asset_name: asset.map(|a| a.name.clone()),
        asset_size_bytes: asset.and_then(|a| a.size),
        published_at: release.published_at,
    })
}

fn build_http_agent(timeout: Duration) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(5)
        .timeout_global(Some(timeout))
        .build();
    ureq::Agent::new_with_config(config)
}

fn fetch_latest_release_blocking() -> Result<ReleaseCheckResult, String> {
    let agent = build_http_agent(Duration::from_secs(12));
    match agent
        .get(RELEASES_API_URL)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .call()
    {
        Ok(mut response) => {
            let body = response
                .body_mut()
                .with_config()
                .limit(MAX_API_BYTES)
                .read_to_string()
                .map_err(|e| format!("Could not read update metadata: {e}"))?;
            parse_release_payload(CURRENT_VERSION, &body)
        }
        Err(ureq::Error::StatusCode(404)) => Ok(ReleaseCheckResult {
            current_version: CURRENT_VERSION.to_string(),
            latest_version: CURRENT_VERSION.to_string(),
            update_available: false,
            release_name: None,
            release_notes: None,
            release_url: LATEST_RELEASE_PAGE.to_string(),
            installer_url: None,
            asset_name: None,
            asset_size_bytes: None,
            published_at: None,
        }),
        Err(err) => Err(format!("Could not check GitHub for updates: {err}")),
    }
}

fn sanitize_version_for_filename(version: &str) -> String {
    let clean: String = version
        .trim()
        .trim_start_matches(['v', 'V'])
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if clean.is_empty() {
        "latest".to_string()
    } else {
        clean
    }
}

fn download_installer_blocking(installer_url: &str, version: &str) -> Result<PathBuf, String> {
    if !is_trusted_release_url(installer_url) {
        return Err("Refusing update download from an untrusted URL.".to_string());
    }

    let safe_version = sanitize_version_for_filename(version);
    let target_dir = std::env::temp_dir().join("sonora-updates");
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Could not prepare temporary update directory: {e}"))?;

    let final_path = target_dir.join(format!("Sonora-{safe_version}-setup.exe"));
    let part_path = target_dir.join(format!("Sonora-{safe_version}-setup.exe.part"));
    let _ = fs::remove_file(&part_path);

    let agent = build_http_agent(Duration::from_secs(120));
    let mut response = agent
        .get(installer_url)
        .header("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| format!("Failed downloading update installer: {e}"))?;

    let mut file = File::create(&part_path)
        .map_err(|e| format!("Failed creating temporary installer file: {e}"))?;

    let mut limited = response.body_mut().as_reader().take(MAX_INSTALLER_BYTES + 1);
    let mut buffer = [0u8; 64 * 1024];
    let mut total_bytes: u64 = 0;

    loop {
        let n = limited.read(&mut buffer).map_err(|e| {
            let _ = fs::remove_file(&part_path);
            format!("Failed while reading installer download: {e}")
        })?;
        if n == 0 {
            break;
        }
        total_bytes += n as u64;
        if total_bytes > MAX_INSTALLER_BYTES {
            let _ = fs::remove_file(&part_path);
            return Err("Update installer exceeds the maximum expected file size.".to_string());
        }
        file.write_all(&buffer[..n]).map_err(|e| {
            let _ = fs::remove_file(&part_path);
            format!("Failed writing installer file: {e}")
        })?;
    }

    if total_bytes == 0 {
        let _ = fs::remove_file(&part_path);
        return Err("Downloaded installer file was empty.".to_string());
    }

    file.flush()
        .map_err(|e| format!("Failed flushing downloaded installer: {e}"))?;
    drop(file);

    fs::rename(&part_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&part_path);
        format!("Could not finalize downloaded installer: {e}")
    })?;

    Ok(final_path)
}

#[tauri::command]
pub async fn check_for_updates() -> Result<ReleaseCheckResult, String> {
    tauri::async_runtime::spawn_blocking(fetch_latest_release_blocking)
        .await
        .map_err(|e| format!("Update check task failed: {e}"))?
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    installer_url: String,
    version: String,
) -> Result<(), String> {
    let url = installer_url.clone();
    let ver = version.clone();
    let path = tauri::async_runtime::spawn_blocking(move || download_installer_blocking(&url, &ver))
        .await
        .map_err(|e| format!("Update download task failed: {e}"))??;

    #[cfg(windows)]
    {
        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| format!("Could not launch downloaded installer: {e}"))?;
        app.exit(0);
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (app, path);
        Err("In-app installer execution is supported on Windows builds only.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_comparison_handles_v_prefix_and_prereleases() {
        assert!(is_newer_version("0.6.8", "v0.6.9"));
        assert!(is_newer_version("0.6.8", "0.7.0"));
        assert!(is_newer_version("0.6.8", "1.0.0"));
        assert!(is_newer_version("0.6.8-beta.1", "0.6.8"));
        assert!(!is_newer_version("0.6.8", "v0.6.8"));
        assert!(!is_newer_version("0.6.8", "0.6.7"));
        assert!(!is_newer_version("0.6.8", "0.6.8-rc.1"));
        assert!(!is_newer_version("0.6.8", "invalid"));
    }

    #[test]
    fn trusted_url_validation_rejects_untrusted_and_insecure_urls() {
        assert!(is_trusted_release_url("https://github.com/shrenixcodes/sonora/releases/latest"));
        assert!(is_trusted_release_url(
            "https://objects.githubusercontent.com/github-production-release-asset/Sonora-setup.exe"
        ));
        assert!(!is_trusted_release_url("http://github.com/shrenixcodes/sonora/releases/latest"));
        assert!(!is_trusted_release_url("https://evil.example.com/Sonora-setup.exe"));
        assert!(!is_trusted_release_url("file:///C:/Windows/System32/calc.exe"));
    }

    #[test]
    fn parses_github_release_and_prefers_x64_nsis_setup_installer() {
        let json = r#"{
            "tag_name": "v0.7.0",
            "name": "Sonora v0.7.0",
            "body": "Faster audio switching and stability improvements.",
            "html_url": "https://github.com/shrenixcodes/sonora/releases/tag/v0.7.0",
            "published_at": "2026-11-26T10:00:00Z",
            "draft": false,
            "prerelease": false,
            "assets": [
                {
                    "name": "Sonora_0.7.0.msi",
                    "browser_download_url": "https://github.com/shrenixcodes/sonora/releases/download/v0.7.0/Sonora_0.7.0.msi",
                    "size": 12000000
                },
                {
                    "name": "Sonora_0.7.0_x64-setup.exe",
                    "browser_download_url": "https://github.com/shrenixcodes/sonora/releases/download/v0.7.0/Sonora_0.7.0_x64-setup.exe",
                    "size": 10485760
                }
            ]
        }"#;

        let parsed = parse_release_payload("0.6.8", json).expect("valid release JSON");
        assert!(parsed.update_available);
        assert_eq!(parsed.current_version, "0.6.8");
        assert_eq!(parsed.latest_version, "0.7.0");
        assert_eq!(parsed.asset_name.as_deref(), Some("Sonora_0.7.0_x64-setup.exe"));
        assert_eq!(
            parsed.installer_url.as_deref(),
            Some("https://github.com/shrenixcodes/sonora/releases/download/v0.7.0/Sonora_0.7.0_x64-setup.exe")
        );
    }

    #[test]
    fn skips_prereleases_for_stable_auto_updates() {
        let json = r#"{
            "tag_name": "v0.7.0-rc.1",
            "html_url": "https://github.com/shrenixcodes/sonora/releases/tag/v0.7.0-rc.1",
            "prerelease": true,
            "assets": []
        }"#;

        let parsed = parse_release_payload("0.6.8", json).expect("valid prerelease JSON");
        assert!(!parsed.update_available);
    }
}
