//! Floating window support for the main window.
//!
//! The main window stays maximized and transparent. In its floating layout
//! Sonora draws the "floating window" as a frame of panels inside it
//! (src/lib/window-mode.ts), so maximize and restore never resize the OS
//! window. The empty space around the panels must not swallow clicks meant for
//! the desktop, so the frontend reports where its panels are and this module
//! turns cursor events off whenever the pointer is outside all of them.
//!
//! Windows sends no mouse events to a window that ignores the cursor, so the
//! pointer is sampled on a timer. The timer only runs in floating mode, idles
//! while the window is hidden or minimized, and slows down while the pointer is
//! too far from every panel to reach one before the next sample. Window
//! geometry is a round trip through the main thread, so it is re-read only
//! when the panels change or about once a second.

use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State, WebviewWindow};

const MAIN_LABEL: &str = "main";
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const MAX_POLL_INTERVAL: Duration = Duration::from_millis(250);
const IDLE_INTERVAL: Duration = Duration::from_millis(500);
const GEOMETRY_REFRESH: Duration = Duration::from_secs(1);
/// Faster than a quick flick of the mouse, in CSS pixels per millisecond.
const CURSOR_SPEED: f64 = 4.0;
const ENTRANCE_DURATION: Duration = Duration::from_millis(420);
const ENTRANCE_FRAME: Duration = Duration::from_millis(16);

/// A panel's bounds in CSS pixels, relative to the window's top-left corner.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl HitRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

/// `None` means the window is in its full (maximized) layout with no gaps.
#[derive(Default)]
pub struct FloatingRegions {
    regions: Mutex<Option<Vec<HitRect>>>,
    wake: Condvar,
}

/// Whether a point in CSS pixels lands on any panel.
fn hits_any(regions: &[HitRect], x: f64, y: f64) -> bool {
    regions.iter().any(|r| r.contains(x, y))
}

/// Distance in CSS pixels from a point to the nearest panel; zero on a panel.
fn distance_to_nearest(regions: &[HitRect], x: f64, y: f64) -> f64 {
    regions
        .iter()
        .map(|r| {
            let dx = (r.x - x).max(x - (r.x + r.width)).max(0.0);
            let dy = (r.y - y).max(y - (r.y + r.height)).max(0.0);
            dx.hypot(dy)
        })
        .fold(f64::INFINITY, f64::min)
}

/// The next sample can wait as long as the pointer needs to reach a panel.
fn poll_interval(distance: f64) -> Duration {
    let min = POLL_INTERVAL.as_millis() as f64;
    let max = MAX_POLL_INTERVAL.as_millis() as f64;
    let wait = if distance.is_finite() {
        distance / CURSOR_SPEED
    } else {
        max
    };
    Duration::from_millis(wait.clamp(min, max) as u64)
}

/// The window's content origin and size, read through the main thread.
#[derive(Clone, Copy)]
struct Geometry {
    origin: PhysicalPosition<i32>,
    scale: f64,
    width: f64,
    height: f64,
}

fn read_geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<Geometry> {
    // The content origin, not the outer one: the window is kept maximized, and
    // a maximized resizable window's outer edge sits ~8 px past the screen on
    // every side, which shifted every hit test onto the 8 px resize strips'
    // neighbours.
    let origin = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(Geometry {
        origin,
        scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    })
}

/// The desktop cursor position, read straight from Windows without waking the main thread.
#[cfg(windows)]
fn cursor_position<R: Runtime>(_window: &WebviewWindow<R>) -> Option<PhysicalPosition<f64>> {
    use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut point = POINT::default();
    // Safety: GetCursorPos writes only into the POINT it is given.
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some(PhysicalPosition::new(point.x as f64, point.y as f64))
}

#[cfg(not(windows))]
fn cursor_position<R: Runtime>(window: &WebviewWindow<R>) -> Option<PhysicalPosition<f64>> {
    window.cursor_position().ok()
}

/// Converts the desktop cursor position into the window's CSS pixel space.
pub fn to_window_css(
    cursor: PhysicalPosition<f64>,
    window: PhysicalPosition<i32>,
    scale: f64,
) -> (f64, f64) {
    (
        (cursor.x - window.x as f64) / scale,
        (cursor.y - window.y as f64) / scale,
    )
}

/// Whether the cursor is within the window's bounds in CSS pixels.
pub fn is_inside_window(x: f64, y: f64, width: f64, height: f64) -> bool {
    x >= 0.0 && y >= 0.0 && x < width && y < height
}

#[tauri::command]
pub fn set_floating_regions(
    regions: Option<Vec<HitRect>>,
    state: State<'_, FloatingRegions>,
) -> Result<(), String> {
    log::debug!(
        "floating regions: {}",
        regions
            .as_ref()
            .map_or("none (full layout)".to_string(), |r| format!(
                "{} panels",
                r.len()
            ))
    );
    *state.regions.lock().map_err(|e| e.to_string())? = regions;
    state.wake.notify_all();
    Ok(())
}

/// Shows the main window once the frontend has painted, sliding in from the
/// right edge of the screen when `animate` is set.
#[tauri::command]
pub fn present_main_window<R: Runtime>(app: AppHandle<R>, animate: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or("main window is not available")?;
    if window.is_visible().unwrap_or(false) {
        return Ok(());
    }

    let start_and_target = if animate {
        entrance_path(&window)
    } else {
        None
    };
    log::debug!(
        "presenting main window (animation requested: {animate}, entrance path: {})",
        start_and_target.is_some()
    );
    let Some((start, target)) = start_and_target else {
        return window.show().map_err(|e| e.to_string());
    };

    window.set_position(start).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();

    thread::spawn(move || {
        let began = Instant::now();
        loop {
            let t = (began.elapsed().as_secs_f64() / ENTRANCE_DURATION.as_secs_f64()).min(1.0);
            let eased = 1.0 - (1.0 - t).powi(3);
            let x = start.x as f64 + (target.x - start.x) as f64 * eased;
            let _ = window.set_position(PhysicalPosition::new(x.round() as i32, target.y));
            if t >= 1.0 {
                log::debug!("slide-in finished at {},{}", target.x, target.y);
                break;
            }
            thread::sleep(ENTRANCE_FRAME);
        }
    });
    Ok(())
}

/// From just past the right edge of the current monitor to the window's centered spot.
fn entrance_path<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Option<(PhysicalPosition<i32>, PhysicalPosition<i32>)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let area = monitor.work_area();
    let size = window.outer_size().ok()?;
    let target = PhysicalPosition::new(
        area.position.x + (area.size.width as i32 - size.width as i32) / 2,
        area.position.y + (area.size.height as i32 - size.height as i32) / 2,
    );
    let start = PhysicalPosition::new(area.position.x + area.size.width as i32, target.y);
    Some((start, target))
}

/// The main window starts hidden so the frontend can present it after its first
/// paint. If that never happens (a startup error), show it anyway.
pub fn show_main_window_if_frontend_stalls<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        if let Some(window) = app.get_webview_window(MAIN_LABEL)
            && !window.is_visible().unwrap_or(true)
        {
            log::warn!("frontend did not present the window in time; showing it");
            let _ = window.show();
        }
    });
}

/// Starts the pointer sampler that keeps empty floating space click-through.
pub fn start_click_through_sampler<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    thread::spawn(move || {
        let mut ignoring = false;
        let mut was_minimized = false;
        let mut active = false;
        let mut geometry: Option<Geometry> = None;
        let mut refreshed_at = Instant::now();
        let mut last_regions: Option<Vec<HitRect>> = None;
        let mut last_cursor: Option<PhysicalPosition<f64>> = None;
        let mut wait = POLL_INTERVAL;
        loop {
            let Some(window) = app.get_webview_window(MAIN_LABEL) else {
                return;
            };

            let state = app.state::<FloatingRegions>();
            let mut guard = match state.regions.lock() {
                Ok(g) => g,
                Err(_) => return,
            };

            if guard.is_none() {
                if ignoring && window.set_ignore_cursor_events(false).is_ok() {
                    ignoring = false;
                }
                if cfg!(windows) {
                    // On Windows, `install_window_state_handler` tracks minimize/restore via WM_SIZE,
                    // so we only need the pointer sampler while in floating mode.
                    guard = match state.wake.wait_while(guard, |r| r.is_none()) {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                }
            }
            let regions = guard.clone();
            drop(guard);

            let stale = !active
                || regions != last_regions
                || (regions.is_some() && geometry.is_none())
                || refreshed_at.elapsed() >= GEOMETRY_REFRESH;
            if stale {
                let is_min = window.is_minimized().unwrap_or(false);
                if was_minimized && !is_min {
                    log::info!("Window restored from minimized state");
                    let _ = window.emit("sonora://restore", ());
                } else if !was_minimized && is_min {
                    log::info!("Window minimized");
                    let _ = window.emit("sonora://minimize", ());
                }
                was_minimized = is_min;
                active = window.is_visible().unwrap_or(false) && !is_min;
                geometry = if active && regions.is_some() {
                    read_geometry(&window)
                } else {
                    None
                };
                refreshed_at = Instant::now();
                last_regions = regions.clone();
                last_cursor = None;
            }

            let should_ignore = match (&regions, geometry) {
                (Some(regions), Some(geometry)) => match cursor_position(&window) {
                    // A pointer that has not moved lands where it did last time.
                    Some(cursor) if Some(cursor) == last_cursor => ignoring,
                    Some(cursor) => {
                        last_cursor = Some(cursor);
                        let (x, y) = to_window_css(cursor, geometry.origin, geometry.scale);
                        wait = poll_interval(distance_to_nearest(regions, x, y));
                        is_inside_window(x, y, geometry.width, geometry.height)
                            && !hits_any(regions, x, y)
                    }
                    None => {
                        wait = POLL_INTERVAL;
                        false
                    }
                },
                (Some(_), None) if active => {
                    wait = POLL_INTERVAL;
                    false
                }
                _ => {
                    wait = IDLE_INTERVAL;
                    false
                }
            };

            if should_ignore != ignoring && window.set_ignore_cursor_events(should_ignore).is_ok() {
                log::debug!("click-through {}", if should_ignore { "on" } else { "off" });
                ignoring = should_ignore;
            }

            thread::sleep(wait);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> HitRect {
        HitRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn detects_points_inside_panels_only() {
        let regions = [
            rect(60.0, 50.0, 800.0, 500.0),
            rect(10.0, 200.0, 44.0, 240.0),
        ];
        assert!(hits_any(&regions, 100.0, 100.0));
        assert!(hits_any(&regions, 20.0, 300.0));
        assert!(!hits_any(&regions, 30.0, 30.0));
        assert!(!hits_any(&regions, 860.0, 100.0), "right edge is exclusive");
        assert!(!hits_any(&[], 100.0, 100.0));
    }

    #[test]
    fn converts_desktop_pixels_to_css_pixels() {
        let (x, y) = to_window_css(
            PhysicalPosition::new(1300.0, 450.0),
            PhysicalPosition::new(100, 50),
            1.5,
        );
        // (1300 - 100) / 1.5 and (450 - 50) / 1.5
        assert!((x - 800.0).abs() < 1e-9);
        assert!((y - 266.666_666_666_666_7).abs() < 1e-9);
    }

    #[test]
    fn parses_regions_from_the_frontend() {
        let parsed: Option<Vec<HitRect>> =
            serde_json::from_str(r#"[{"x":1,"y":2,"width":3,"height":4}]"#).unwrap();
        assert_eq!(parsed, Some(vec![rect(1.0, 2.0, 3.0, 4.0)]));
        let full: Option<Vec<HitRect>> = serde_json::from_str("null").unwrap();
        assert_eq!(full, None);
    }

    #[test]
    fn measures_distance_to_the_nearest_panel() {
        let regions = [
            rect(100.0, 100.0, 200.0, 100.0),
            rect(500.0, 100.0, 50.0, 50.0),
        ];
        assert_eq!(distance_to_nearest(&regions, 150.0, 150.0), 0.0);
        assert_eq!(distance_to_nearest(&regions, 150.0, 40.0), 60.0);
        assert_eq!(distance_to_nearest(&regions, 400.0, 120.0), 100.0);
        assert!((distance_to_nearest(&regions, 60.0, 70.0) - 50.0).abs() < 1e-9);
        assert!(distance_to_nearest(&[], 0.0, 0.0).is_infinite());
    }

    #[test]
    fn samples_slower_only_when_no_panel_is_within_reach() {
        assert_eq!(poll_interval(0.0), POLL_INTERVAL);
        assert_eq!(poll_interval(100.0), POLL_INTERVAL);
        assert_eq!(poll_interval(600.0), Duration::from_millis(150));
        assert_eq!(poll_interval(5000.0), MAX_POLL_INTERVAL);
        assert_eq!(poll_interval(f64::INFINITY), MAX_POLL_INTERVAL);
        // Never longer than the pointer needs to cross the gap at flick speed.
        for distance in [210.0, 480.0, 900.0] {
            assert!(poll_interval(distance).as_secs_f64() * 1000.0 * CURSOR_SPEED <= distance);
        }
    }

    #[test]
    fn checks_window_boundaries() {
        assert!(is_inside_window(10.0, 20.0, 1000.0, 700.0));
        assert!(!is_inside_window(-5.0, 20.0, 1000.0, 700.0));
        assert!(!is_inside_window(10.0, -5.0, 1000.0, 700.0));
        assert!(!is_inside_window(1000.0, 20.0, 1000.0, 700.0));
        assert!(!is_inside_window(10.0, 700.0, 1000.0, 700.0));
        // Pointer on the taskbar below the window
        assert!(!is_inside_window(500.0, 1050.0, 1000.0, 700.0));
    }
}

/* -- Native window state events -------------------------------------------- */

#[cfg(windows)]
pub use window_state::install_window_state_handler;

#[cfg(not(windows))]
pub fn install_window_state_handler<R: Runtime>(_window: &WebviewWindow<R>) {}

#[cfg(windows)]
mod window_state {
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;
    use std::time::Duration;

    use tauri::{Emitter, Runtime, WebviewWindow};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        SC_MINIMIZE, SIZE_MAXIMIZED, SIZE_MINIMIZED, SIZE_RESTORED, SW_MINIMIZE, ShowWindowAsync,
        WM_SIZE, WM_SYSCOMMAND,
    };
    use windows::core::BOOL;

    /* -- Minimize hand-off ---------------------------------------------------
     * Windows keeps the last frame a window painted and shows it first when the
     * window is restored, so restoring would flash the old interface before the
     * entrance animation could start. A minimize from the taskbar (or the system
     * menu) is therefore held back: the frontend is told, fades the interface
     * out, and minimizes itself once that empty frame has been painted. If it
     * does not answer in time the window is minimized anyway.
     */
    const MINIMIZE_GRACE: Duration = Duration::from_millis(320);
    static EMIT: OnceLock<Box<dyn Fn(&'static str) + Send + Sync>> = OnceLock::new();
    static MINIMIZE_PENDING: AtomicBool = AtomicBool::new(false);
    static MINIMIZED: AtomicBool = AtomicBool::new(false);

    fn emit(event: &'static str) {
        if let Some(emit) = EMIT.get() {
            emit(event);
        }
    }

    /// Handles the minimize hand-off and reports minimize/restore right away
    /// (the sampler's polling would otherwise add up to 100 ms). Returns true
    /// when the message was consumed.
    fn on_window_state(hwnd: HWND, message: u32, wparam: WPARAM) -> bool {
        if message == WM_SYSCOMMAND && (wparam.0 as u32 & 0xFFF0) == SC_MINIMIZE {
            // A second request while one is held is the follow-through: let it pass
            if MINIMIZE_PENDING.swap(true, Ordering::SeqCst) {
                MINIMIZE_PENDING.store(false, Ordering::SeqCst);
                return false;
            }
            emit("sonora://will-minimize");
            let raw = hwnd.0 as isize;
            thread::spawn(move || {
                thread::sleep(MINIMIZE_GRACE);
                if MINIMIZE_PENDING.swap(false, Ordering::SeqCst) {
                    log::debug!("frontend did not minimize in time; minimizing");
                    // Safety: ShowWindowAsync only posts to the window's thread.
                    unsafe {
                        let _ = ShowWindowAsync(HWND(raw as *mut _), SW_MINIMIZE);
                    }
                }
            });
            return true;
        }
        if message == WM_SIZE {
            let kind = wparam.0 as u32;
            if kind == SIZE_MINIMIZED {
                MINIMIZE_PENDING.store(false, Ordering::SeqCst);
                if !MINIMIZED.swap(true, Ordering::SeqCst) {
                    emit("sonora://minimize");
                }
            } else if (kind == SIZE_RESTORED || kind == SIZE_MAXIMIZED)
                && MINIMIZED.swap(false, Ordering::SeqCst)
            {
                emit("sonora://restore");
            }
        }
        false
    }

    /* -- Native window animations off -----------------------------------------
     * Windows animates maximize, restore and minimize by stretching a picture of
     * the window for about 700 ms. The interface plays its own animations for
     * all of these (window-morph.ts, symbiote.ts), so the native ones would only
     * delay and fight them.
     */
    fn disable_native_transitions(hwnd: HWND) {
        let disabled = BOOL::from(true);
        // Safety: the attribute is a BOOL, passed by pointer with its size.
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &disabled as *const BOOL as *const _,
                std::mem::size_of::<BOOL>() as u32,
            )
        };
        if let Err(err) = result {
            log::warn!("could not turn off native window animations: {err}");
        }
    }

    const SUBCLASS_ID: usize = 1;

    unsafe extern "system" fn on_message(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if on_window_state(hwnd, message, wparam) {
            return LRESULT(0);
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn install_window_state_handler<R: Runtime>(window: &WebviewWindow<R>) {
        let Ok(hwnd) = window.hwnd() else {
            log::warn!("no window handle; window state events are unavailable");
            return;
        };
        let target = window.clone();
        let _ = EMIT.set(Box::new(move |event| {
            // Emit off the window procedure; Tauri hands it to the webview
            let target = target.clone();
            thread::spawn(move || {
                let _ = target.emit(event, ());
            });
        }));
        disable_native_transitions(hwnd);
        // Safety: the subclass lives as long as the window it is attached to.
        let installed = unsafe { SetWindowSubclass(hwnd, Some(on_message), SUBCLASS_ID, 0) };
        if !installed.as_bool() {
            log::warn!("could not watch window state changes");
        }
    }
}
