//! Request filtering for the YouTube Music webview on Windows.

use std::path::Path;

use adblock::{engine::Engine, lists::FilterSet, request::Request};
use tauri::{Runtime, WebviewWindow};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler, take_pwstr,
};
use windows::core::{HSTRING, PWSTR};

const LISTS: [(&str, &str, &str, &str); 4] = [
    (
        "easylist.txt",
        "https://easylist.to/easylist/easylist.txt",
        "! Title: EasyList",
        include_str!("../filters/easylist.txt"),
    ),
    (
        "brave-firstparty.txt",
        "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-firstparty.txt",
        "! Title: Brave Firstparty",
        include_str!("../filters/brave-firstparty.txt"),
    ),
    (
        "brave-specific.txt",
        "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-specific.txt",
        "! Title: Brave Specific",
        include_str!("../filters/brave-specific.txt"),
    ),
    (
        "brave-unbreak.txt",
        "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt",
        "! Title: Brave Unbreak",
        include_str!("../filters/brave-unbreak.txt"),
    ),
];
const MAX_LIST_BYTES: u64 = 5 * 1024 * 1024;
const REFRESH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);
/// Part of the compiled engine's cache key; change it when list handling changes.
const ENGINE_CACHE_TAG: &str = "sonora-adblock-1";

fn valid_list(content: &str, title: &str) -> bool {
    content.len() > 1000
        && (content.len() as u64) <= MAX_LIST_BYTES
        && content.lines().take(20).any(|line| line.starts_with(title))
}

fn load_lists(cache: Option<&Path>) -> Vec<String> {
    LISTS
        .iter()
        .map(|(name, _, title, bundled)| {
            cache
                .and_then(|directory| {
                    let path = directory.join(name);
                    let size = std::fs::metadata(&path).ok()?.len();
                    if size > MAX_LIST_BYTES {
                        return None;
                    }
                    std::fs::read_to_string(path).ok()
                })
                .filter(|content| valid_list(content, title))
                .unwrap_or_else(|| (*bundled).to_owned())
        })
        .collect()
}

fn build_engine(lists: &[String]) -> Engine {
    let mut filters = FilterSet::new(false);
    for list in lists {
        filters.add_filter_list(list.clone(), Default::default());
    }
    Engine::new_with_filter_set(filters)
}

/// Stable FNV-1a hash of the lists, so a compiled engine is reused only for identical rules.
fn fingerprint(lists: &[String]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    };
    feed(ENGINE_CACHE_TAG.as_bytes());
    for list in lists {
        feed(&(list.len() as u64).to_le_bytes());
        feed(list.as_bytes());
    }
    hash
}

fn engine_path(cache: &Path, lists: &[String]) -> std::path::PathBuf {
    cache.join(format!("engine-{:016x}.dat", fingerprint(lists)))
}

/// Reloads the engine compiled from these exact lists, compiling and saving it when missing.
///
/// Compiling the bundled lists takes hundreds of milliseconds; reloading takes a few.
fn load_engine(cache: Option<&Path>) -> Engine {
    let lists = load_lists(cache);
    let Some(cache) = cache else {
        return build_engine(&lists);
    };
    let path = engine_path(cache, &lists);
    if let Ok(bytes) = std::fs::read(&path) {
        let mut engine = Engine::default();
        if engine.deserialize(&bytes).is_ok() {
            return engine;
        }
    }
    let engine = build_engine(&lists);
    store_engine(cache, &path, &engine);
    engine
}

fn store_engine(cache: &Path, path: &Path, engine: &Engine) {
    if std::fs::create_dir_all(cache).is_err() {
        return;
    }
    // Engines compiled from older lists are never read again.
    if let Ok(entries) = std::fs::read_dir(cache) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("engine-") && name.ends_with(".dat") && entry.path() != path {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let temporary = path.with_extension("tmp");
    if std::fs::write(&temporary, engine.serialize()).is_err()
        || std::fs::rename(&temporary, path).is_err()
    {
        let _ = std::fs::remove_file(temporary);
    }
}

fn refresh_lists(cache: &Path) -> bool {
    if std::fs::create_dir_all(cache).is_err() {
        return false;
    }
    let config = ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .build();
    let agent = ureq::Agent::new_with_config(config);
    let mut changed = false;
    for (name, url, title, _) in LISTS {
        let path = cache.join(name);
        let fresh = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age < REFRESH_INTERVAL);
        if fresh && std::fs::read_to_string(&path).is_ok_and(|content| valid_list(&content, title))
        {
            continue;
        }
        let Ok(mut response) = agent.get(url).call() else {
            continue;
        };
        let Ok(content) = response
            .body_mut()
            .with_config()
            .limit(MAX_LIST_BYTES)
            .read_to_string()
        else {
            continue;
        };
        let temporary = path.with_extension("download");
        if valid_list(&content, title)
            && std::fs::write(&temporary, content).is_ok()
            && std::fs::rename(&temporary, &path).is_ok()
        {
            changed = true;
        } else {
            let _ = std::fs::remove_file(temporary);
        }
    }
    changed
}

fn should_block(engine: &Engine, source: &str, url: &str, kind: &str, method: &str) -> bool {
    // Avoid filtering Google account sign-in pages.
    if !tauri::Url::parse(source)
        .ok()
        .is_some_and(|url| url.scheme() == "https" && url.host_str() == Some("music.youtube.com"))
    {
        return false;
    }
    if kind == "document" {
        return false;
    }
    Request::new(url, source, kind, method)
        .ok()
        .is_some_and(|request| engine.check_network_request(&request).should_block())
}

fn request_kind(context: COREWEBVIEW2_WEB_RESOURCE_CONTEXT) -> &'static str {
    match context {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "document",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xmlhttprequest",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        _ => "other",
    }
}

pub fn attach<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    use tauri::Manager;
    let cache = window
        .app_handle()
        .path()
        .app_cache_dir()
        .ok()
        .map(|path| path.join("adblock"));
    let window = window.clone();
    std::thread::spawn(move || {
        let engine = std::sync::Arc::new(std::sync::RwLock::new(load_engine(cache.as_deref())));
        let active_engine = engine.clone();
        if let Err(error) = window.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let webview = platform.controller().CoreWebView2()?;
                let environment = platform.environment();
                webview.AddWebResourceRequestedFilter(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                )?;
                let mut token = Default::default();
                webview.add_WebResourceRequested(
                    &WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
                        let (Some(sender), Some(args)) = (sender, args) else {
                            return Ok(());
                        };
                        let mut source = PWSTR::null();
                        sender.Source(&mut source)?;
                        let source = take_pwstr(source);
                        let mut uri = PWSTR::null();
                        let request = args.Request()?;
                        request.Uri(&mut uri)?;
                        let uri = take_pwstr(uri);
                        let mut method = PWSTR::null();
                        request.Method(&mut method)?;
                        let method = take_pwstr(method);
                        let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                        args.ResourceContext(&mut context)?;
                        if active_engine.read().is_ok_and(|engine| {
                            should_block(&engine, &source, &uri, request_kind(context), &method)
                        }) {
                            let response = environment.CreateWebResourceResponse(
                                None,
                                403,
                                &HSTRING::from("Blocked"),
                                &HSTRING::new(),
                            )?;
                            args.SetResponse(&response)?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )?;
                // Reload only the music page, never interrupt a Google sign-in.
                let mut source = PWSTR::null();
                webview.Source(&mut source)?;
                let source = take_pwstr(source);
                if tauri::Url::parse(&source)
                    .ok()
                    .is_some_and(|url| url.host_str() == Some("music.youtube.com"))
                {
                    webview.Reload()?;
                }
                Ok(())
            })();
            if let Err(error) = result {
                log::error!("failed to enable ad filtering: {error}");
            }
        }) {
            log::error!("failed to access YouTube Music webview: {error}");
        }
        if let Some(cache) = cache
            && refresh_lists(&cache)
        {
            let replacement = load_engine(Some(&cache));
            if let Ok(mut active) = engine.write() {
                *active = replacement;
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_recognized_nonempty_filter_lists() {
        assert!(valid_list(LISTS[0].3, LISTS[0].2));
        assert!(!valid_list("<html>error</html>", LISTS[0].2));
        assert!(!valid_list(LISTS[1].3, LISTS[0].2));
    }

    #[test]
    fn filters_ad_requests_without_filtering_music_or_sign_in() {
        let engine = build_engine(&load_lists(None));
        let source = "https://music.youtube.com/watch?v=test";
        assert!(should_block(
            &engine,
            source,
            "https://ad.doubleclick.net/ddm/trackimp/example",
            "image",
            "GET"
        ));
        assert!(should_block(
            &engine,
            source,
            "https://www.youtube.com/youtubei/v1/player/ad_break",
            "xmlhttprequest",
            "POST"
        ));
        for (url, kind) in [
            (
                "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
                "script",
            ),
            (
                "https://static.doubleclick.net/instream/ad_status.js",
                "script",
            ),
            (
                "https://googleads.g.doubleclick.net/pagead/id",
                "xmlhttprequest",
            ),
            ("https://www.youtube.com/pagead/adview?ai=example", "image"),
        ] {
            assert!(should_block(&engine, source, url, kind, "GET"), "{url}");
        }
        // Playback, catalog and artwork requests must always load.
        for (url, kind, method) in [
            (
                "https://music.youtube.com/youtubei/v1/player",
                "xmlhttprequest",
                "POST",
            ),
            (
                "https://music.youtube.com/youtubei/v1/browse",
                "xmlhttprequest",
                "POST",
            ),
            (
                "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1",
                "media",
                "GET",
            ),
            (
                "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1",
                "xmlhttprequest",
                "POST",
            ),
            (
                "https://lh3.googleusercontent.com/example=w544-h544",
                "image",
                "GET",
            ),
            (
                "https://i.ytimg.com/vi/example/hqdefault.jpg",
                "image",
                "GET",
            ),
        ] {
            assert!(!should_block(&engine, source, url, kind, method), "{url}");
        }
        assert!(!should_block(
            &engine,
            source,
            "https://music.youtube.com/youtubei/v1/next",
            "xmlhttprequest",
            "POST"
        ));
        assert!(!should_block(
            &engine,
            source,
            "https://accounts.google.com/",
            "document",
            "GET"
        ));
        assert!(!should_block(
            &engine,
            "https://accounts.google.com/",
            "https://ad.doubleclick.net/ddm/trackimp/example",
            "image",
            "GET"
        ));
    }

    fn engine_files(cache: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(cache)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("engine-"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn reuses_the_compiled_engine_until_the_lists_change() {
        let cache = std::env::temp_dir().join(format!("sonora-adblock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&cache);
        let source = "https://music.youtube.com/watch?v=test";
        let ad = "https://ad.doubleclick.net/ddm/trackimp/example";

        let compiled = load_engine(Some(&cache));
        let saved = engine_files(&cache);
        assert_eq!(saved.len(), 1);
        assert!(should_block(&compiled, source, ad, "image", "GET"));

        let reloaded = load_engine(Some(&cache));
        assert_eq!(engine_files(&cache), saved);
        assert!(should_block(&reloaded, source, ad, "image", "GET"));

        // A corrupt file is replaced by a freshly compiled engine.
        std::fs::write(cache.join(&saved[0]), b"corrupt").unwrap();
        let rebuilt = load_engine(Some(&cache));
        assert!(should_block(&rebuilt, source, ad, "image", "GET"));
        assert!(std::fs::read(cache.join(&saved[0])).unwrap().len() > 1000);

        // A refreshed list produces a new engine and drops the stale one.
        let (name, _, _, bundled) = LISTS[2];
        std::fs::write(
            cache.join(name),
            format!("{bundled}\n||sonora-test.example^\n"),
        )
        .unwrap();
        let refreshed = load_engine(Some(&cache));
        let replaced = engine_files(&cache);
        assert_eq!(replaced.len(), 1);
        assert_ne!(replaced, saved);
        assert!(should_block(
            &refreshed,
            source,
            "https://sonora-test.example/pixel.gif",
            "image",
            "GET"
        ));

        let _ = std::fs::remove_dir_all(&cache);
    }
}
