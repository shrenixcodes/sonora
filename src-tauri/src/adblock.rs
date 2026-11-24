//! Request filtering for the YouTube Music webview on Windows.

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

fn valid_list(content: &str, title: &str) -> bool {
    content.len() > 1000
        && (content.len() as u64) <= MAX_LIST_BYTES
        && content.lines().take(20).any(|line| line.starts_with(title))
}

fn load_lists(cache: Option<&std::path::Path>) -> Vec<String> {
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

fn refresh_lists(cache: &std::path::Path) -> bool {
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
        let engine = std::sync::Arc::new(std::sync::RwLock::new(build_engine(&load_lists(
            cache.as_deref(),
        ))));
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
        if let Some(cache) = cache {
            if refresh_lists(&cache) {
                let replacement = build_engine(&load_lists(Some(&cache)));
                if let Ok(mut active) = engine.write() {
                    *active = replacement;
                }
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
}
