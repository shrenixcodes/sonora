fn main() {
    // Listing the app commands generates `allow-<command>` permissions, so the
    // remote YouTube Music page can be granted `ytm_report` and nothing else.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_app_info",
            "get_platform_info",
            "ytm_report",
            "ytm_control",
            "ytm_set_signin_visible",
        ]),
    ))
    .expect("failed to run tauri-build");
}
