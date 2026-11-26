use tauri::{Emitter, Manager, WindowEvent};

mod commands;
mod discord;
mod updater;
mod window_mode;
mod ytm;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(window_mode::FloatingRegions::default())
        .manage(ytm::AccountState::default())
        .manage(discord::DiscordRpcState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_platform_info,
            updater::check_for_updates,
            updater::install_update,
            discord::discord_set_activity,
            discord::discord_clear_activity,
            ytm::ytm_report,
            ytm::ytm_control,
            ytm::ytm_set_signin_visible,
            ytm::ytm_sign_out,
            ytm::ytm_request,
            ytm::ytm_response,
            window_mode::set_floating_regions,
            window_mode::present_main_window,
        ])
        .setup(|app| {
            log::info!("Sonora v{} starting", app.package_info().version);

            ytm::create_window(app.handle())?;
            window_mode::start_click_through_sampler(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                window_mode::install_window_state_handler(&window);
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            window_mode::show_main_window_if_frontend_stalls(app.handle());

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
            // When the main window loses focus (such as when minimized), ensure click-through is disabled
            // so taskbar restoration and window focus work reliably.
            ("main", WindowEvent::Focused(focused)) => {
                if !focused {
                    let _ = window.set_ignore_cursor_events(false);
                }
                let _ = window.emit("sonora://focus", *focused);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Sonora");
}
