//! Floating window support for the main window.
//!
//! At its normal (restored) size Sonora draws floating panels on a transparent
//! window. The empty space between them must not swallow clicks meant for the
//! desktop, so the frontend reports where its panels are and this module turns
//! cursor events off whenever the pointer is outside all of them.
//!
//! Windows sends no mouse events to a window that ignores the cursor, so the
//! pointer is sampled on a timer. The timer only runs in floating mode and
//! idles while the window is hidden or minimized.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State, WebviewWindow};

const MAIN_LABEL: &str = "main";
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const IDLE_INTERVAL: Duration = Duration::from_millis(100);
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
pub struct FloatingRegions(Mutex<Option<Vec<HitRect>>>);

/// Whether a point in CSS pixels lands on any panel.
fn hits_any(regions: &[HitRect], x: f64, y: f64) -> bool {
    regions.iter().any(|r| r.contains(x, y))
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
    *state.0.lock().map_err(|e| e.to_string())? = regions;
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
        loop {
            let Some(window) = app.get_webview_window(MAIN_LABEL) else {
                return;
            };

            let is_min = window.is_minimized().unwrap_or(false);
            if was_minimized && !is_min {
                log::info!("Window restored from minimized state");
                let _ = window.emit("sonora://restore", ());
            } else if !was_minimized && is_min {
                log::info!("Window minimized");
                let _ = window.emit("sonora://minimize", ());
            }
            was_minimized = is_min;

            let regions = app
                .state::<FloatingRegions>()
                .0
                .lock()
                .ok()
                .and_then(|guard| guard.clone());

            let active =
                window.is_visible().unwrap_or(false) && !is_min;
            let should_ignore = match (&regions, active) {
                (Some(regions), true) => match (
                    window.cursor_position(),
                    window.outer_position(),
                    window.inner_size(),
                    window.scale_factor(),
                ) {
                    (Ok(cursor), Ok(origin), Ok(size), Ok(scale)) => {
                        let (x, y) = to_window_css(cursor, origin, scale);
                        let win_w = size.width as f64 / scale;
                        let win_h = size.height as f64 / scale;
                        is_inside_window(x, y, win_w, win_h) && !hits_any(regions, x, y)
                    }
                    _ => false,
                },
                _ => false,
            };

            if should_ignore != ignoring && window.set_ignore_cursor_events(should_ignore).is_ok() {
                log::debug!("click-through {}", if should_ignore { "on" } else { "off" });
                ignoring = should_ignore;
            }

            thread::sleep(if regions.is_some() && active {
                POLL_INTERVAL
            } else {
                IDLE_INTERVAL
            });
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

/* -- Magnetic centring ------------------------------------------------------
 * A floating window is put wherever it is dragged, and there is no way back to
 * the middle except by eye. Windows offers the rectangle a drag is about to use
 * before it uses it, so a drag that passes near the middle of the screen can be
 * pulled onto it there and then: the window settles into place under the
 * pointer, stays there if the button comes up, and lets go again as soon as the
 * drag carries on somewhere else.
 */

#[cfg(windows)]
pub use centre_snap::install_centre_snap;

#[cfg(not(windows))]
pub fn install_centre_snap<R: Runtime>(_window: &WebviewWindow<R>) {}

#[cfg(windows)]
mod centre_snap {
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;
    use std::time::Duration;

    use tauri::{Emitter, Runtime, WebviewWindow};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        SC_MINIMIZE, SIZE_MAXIMIZED, SIZE_MINIMIZED, SIZE_RESTORED, SW_MINIMIZE, ShowWindowAsync, WM_MOVING,
        WM_SIZE, WM_SYSCOMMAND,
    };

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
            } else if (kind == SIZE_RESTORED || kind == SIZE_MAXIMIZED) && MINIMIZED.swap(false, Ordering::SeqCst) {
                emit("sonora://restore");
            }
        }
        false
    }

    /// How near the middle, in device pixels, a drag has to pass for the window
    /// to be taken the rest of the way. Small enough that every other resting
    /// place is still reachable.
    const SNAP_RADIUS: i32 = 90;
    const SUBCLASS_ID: usize = 1;

    /// Where `rect` would sit centred within `work`, if it is close enough to be
    /// pulled there. None means the drag is heading somewhere else and the
    /// window should go exactly where it is put.
    pub(super) fn centred(rect: RECT, work: RECT) -> Option<RECT> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let left = work.left + (work.right - work.left - width) / 2;
        let top = work.top + (work.bottom - work.top - height) / 2;
        let away = f64::from(rect.left - left).hypot(f64::from(rect.top - top));
        if away > f64::from(SNAP_RADIUS) {
            return None;
        }
        Some(RECT {
            left,
            top,
            right: left + width,
            bottom: top + height,
        })
    }

    /// The usable area of the screen the window is on, so a taskbar does not
    /// push the middle off centre.
    fn work_area(hwnd: HWND) -> Option<RECT> {
        let mut info = MONITORINFO {
            cbSize: u32::try_from(size_of::<MONITORINFO>()).ok()?,
            ..Default::default()
        };
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            GetMonitorInfoW(monitor, &mut info).as_bool().then_some(info.rcWork)
        }
    }

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
        if message == WM_MOVING {
            let proposed = lparam.0 as *mut RECT;
            if !proposed.is_null() {
                // Safety: for WM_MOVING the system passes a writable RECT, and
                // writing to it is how the drag is steered.
                unsafe {
                    if let Some(work) = work_area(hwnd) {
                        if let Some(snapped) = centred(*proposed, work) {
                            log::debug!("drag passed the middle; centring");
                            *proposed = snapped;
                        }
                    }
                }
            }
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn install_centre_snap<R: Runtime>(window: &WebviewWindow<R>) {
        let Ok(hwnd) = window.hwnd() else {
            log::warn!("no window handle; centre snapping is off");
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
        // Safety: the subclass lives as long as the window it is attached to.
        let installed = unsafe { SetWindowSubclass(hwnd, Some(on_message), SUBCLASS_ID, 0) };
        if !installed.as_bool() {
            log::warn!("could not watch window moves; centre snapping is off");
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn rect(left: i32, top: i32, width: i32, height: i32) -> RECT {
            RECT { left, top, right: left + width, bottom: top + height }
        }

        /// 1920x1080 with a taskbar along the bottom.
        fn work() -> RECT {
            rect(0, 0, 1920, 1040)
        }

        #[test]
        fn pulls_a_drag_passing_near_the_middle_onto_it() {
            let centre = centred(rect(400, 160, 1200, 800), work()).unwrap();
            assert_eq!((centre.left, centre.top), (360, 120));
            // and it keeps the window the same size
            assert_eq!((centre.right - centre.left, centre.bottom - centre.top), (1200, 800));
        }

        #[test]
        fn leaves_a_drag_heading_elsewhere_alone() {
            assert!(centred(rect(40, 120, 1200, 800), work()).is_none());
            assert!(centred(rect(360, 900, 1200, 800), work()).is_none());
        }

        #[test]
        fn centres_within_the_usable_area_of_the_screen_in_use() {
            let second = rect(1920, 0, 1920, 1040);
            let centre = centred(rect(2300, 140, 1200, 800), second).unwrap();
            assert_eq!((centre.left, centre.top), (2280, 120));
        }
    }
}
