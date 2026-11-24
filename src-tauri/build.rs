use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, fs};

/// Listing the app commands generates `allow-<command>` permissions, so the
/// remote YouTube Music page can be granted only what it needs.
const APP_COMMANDS: &[&str] = &[
    "get_app_info",
    "get_platform_info",
    "discord_set_activity",
    "discord_clear_activity",
    "ytm_report",
    "ytm_control",
    "ytm_set_signin_visible",
    "ytm_sign_out",
    "ytm_request",
    "ytm_response",
    "set_floating_regions",
    "present_main_window",
];

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let mut attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS));

    if is_windows_gnu() {
        // See embed_windows_manifest_for_gnu: Sonora links the manifest itself.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_windows_manifest_for_gnu();
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

fn is_windows_gnu() -> bool {
    env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
}

/// The Windows manifest (Common Controls v6) has to be in every executable,
/// or the program dies at launch with STATUS_ENTRYPOINT_NOT_FOUND because
/// comctl32's TaskDialogIndirect only exists in v6. With the GNU toolchain
/// two things get in the way:
///
/// - MinGW's GCC links its own `default-manifest.o` into every executable, and
///   the linker cannot merge two manifests, so which one survives depends on
///   link layout. An empty object of that name placed first on GCC's start-file
///   search path (`-B`) keeps it out.
/// - Tauri links its manifest into the app binary only, not into test binaries.
///
/// So the manifest is compiled here and linked into every executable
/// (`rustc-link-arg`), and Tauri is told not to add its own copy.
fn embed_windows_manifest_for_gnu() {
    let out =
        PathBuf::from(env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("windows-manifest");
    fs::create_dir_all(&out).expect("create windows-manifest dir");

    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());

    // 1 = CREATEPROCESS_MANIFEST_RESOURCE_ID, 24 = RT_MANIFEST
    let rc = out.join("manifest.rc");
    let manifest_path = manifest.display().to_string().replace('\\', "/");
    fs::write(&rc, format!("1 24 \"{manifest_path}\"\n")).expect("write manifest.rc");
    let manifest_object = out.join("manifest.o");
    run(
        "windres",
        &[
            rc.as_os_str(),
            "-O".as_ref(),
            "coff".as_ref(),
            "-o".as_ref(),
            manifest_object.as_os_str(),
        ],
    );

    let empty_source = out.join("empty.s");
    fs::write(&empty_source, "").expect("write empty.s");
    run(
        "as",
        &[
            empty_source.as_os_str(),
            "-o".as_ref(),
            out.join("default-manifest.o").as_os_str(),
        ],
    );

    println!("cargo:rustc-link-arg=-B{}", out.display());
    println!("cargo:rustc-link-arg={}", manifest_object.display());
}

fn run(program: &str, args: &[&std::ffi::OsStr]) {
    let status = Command::new(program)
        .args(args)
        .status()
        .unwrap_or_else(|e| {
            panic!("failed to run {program}: {e} (is the MinGW toolchain on PATH?)")
        });
    assert!(status.success(), "{program} failed with {status}");
}
