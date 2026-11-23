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
use tauri::{AppHandle, Manager, PhysicalPosition, Runtime, State, WebviewWindow};

const MAIN_LABEL: &str = "main";
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const IDLE_INTERVAL: Duration = Duration::from_millis(250);
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
        loop {
            let Some(window) = app.get_webview_window(MAIN_LABEL) else {
                return;
            };
            let regions = app
                .state::<FloatingRegions>()
                .0
                .lock()
                .ok()
                .and_then(|guard| guard.clone());

            let active =
                window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true);
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
