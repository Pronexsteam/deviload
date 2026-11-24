// The window's place in the system: download progress on the taskbar icon, and the interface scale chosen in
// Settings, applied to every Deviload window.
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::Manager;

// The overall progress of running downloads, 0 to 100; nothing hides the bar. A paused queue shows paused.
#[tauri::command]
pub fn set_taskbar_progress(window: tauri::WebviewWindow, progress: Option<f64>, paused: Option<bool>) -> Result<(), String> {
    let state = match progress {
        Some(value) if value.is_finite() => ProgressBarState {
            status: Some(if paused.unwrap_or(false) { ProgressBarStatus::Paused } else { ProgressBarStatus::Normal }),
            progress: Some(value.clamp(0.0, 100.0).round() as u64),
        },
        _ => ProgressBarState { status: Some(ProgressBarStatus::None), progress: None },
    };
    window.set_progress_bar(state).map_err(|e| e.to_string())
}

pub fn valid_scale(scale: f64) -> Option<f64> {
    (scale.is_finite() && (0.75..=1.5).contains(&scale)).then_some(scale)
}

// The interface scale for all open windows; each window opened later applies it again as it starts.
#[tauri::command]
pub fn set_ui_scale(app: tauri::AppHandle, scale: f64) -> Result<(), String> {
    let scale = valid_scale(scale).ok_or("Invalid interface scale")?;
    for window in app.webview_windows().values() { window.set_zoom(scale).map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_sensible_scales_are_accepted() {
        assert_eq!(valid_scale(1.1), Some(1.1));
        assert_eq!(valid_scale(0.5), None);
        assert_eq!(valid_scale(f64::NAN), None);
        assert_eq!(valid_scale(2.0), None);
    }
}
