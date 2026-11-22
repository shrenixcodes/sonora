use tauri::{Manager, WindowEvent};

mod commands;
mod ytm;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_platform_info,
            ytm::ytm_report,
            ytm::ytm_control,
            ytm::ytm_set_signin_visible,
        ])
        .setup(|app| {
            log::info!("Sonora v{} starting", app.package_info().version);

            ytm::create_window(app.handle())?;

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the sign-in window only hides it; playback lives there.
            (ytm::YTM_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The hidden YouTube Music window would otherwise keep the app alive.
            ("main", WindowEvent::Destroyed) => window.app_handle().exit(0),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Sonora");
}
