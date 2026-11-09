//! A floating strip on the desktop with the current line of the lyrics. It can stay above other
//! windows and let clicks pass through. The main window sends a line only when it changes; the strip
//! times the words itself from the song position it was given.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const LABEL: &str = "lyrics-overlay";
const MINI: &str = "music-mini";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Word { #[serde(default)] text: String, #[serde(default)] at: f64, #[serde(default)] end: f64 }

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Line {
    #[serde(default)] text: String,
    #[serde(default)] next: String,
    #[serde(default)] at: f64,
    #[serde(default)] end: f64,
    #[serde(default)] words: Vec<Word>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct LyricState {
    #[serde(default)] id: String,
    #[serde(default)] line: Line,
    #[serde(default)] position: f64,
    #[serde(default)] playing: bool,
    #[serde(default)] rate: f64,
    #[serde(default)] accent: String,
}

fn text(value: String, limit: usize) -> String { value.chars().filter(|c| !c.is_control()).take(limit).collect() }
fn time(value: f64) -> f64 { if value.is_finite() { value.clamp(0.0, 86_400.0) } else { 0.0 } }

pub(super) fn sanitize(state: LyricState) -> LyricState {
    let words = state.line.words.into_iter().take(120)
        .map(|w| Word { text: text(w.text, 80), at: time(w.at), end: time(w.end) }).collect();
    let accent = if state.accent.len() == 7 && state.accent.starts_with('#') && state.accent[1..].chars().all(|c| c.is_ascii_hexdigit()) { state.accent } else { String::new() };
    LyricState {
        id: text(state.id, 64),
        line: Line { text: text(state.line.text, 400), next: text(state.line.next, 400), at: time(state.line.at), end: time(state.line.end), words },
        position: time(state.position),
        playing: state.playing,
        rate: if state.rate.is_finite() { state.rate.clamp(0.25, 4.0) } else { 1.0 },
        accent,
    }
}

/// Shows the strip near the bottom of the screen the main window is on.
#[tauri::command]
pub async fn lyrics_overlay_open(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    if let Some(strip) = app.get_webview_window(LABEL) { return strip.show().map_err(|e| e.to_string()); }
    let (width, height) = (860.0, 132.0);
    // Near the bottom of the work area of the screen the main window is on, above the taskbar. The
    // position is given at creation: a hidden window ignores later moves on Windows.
    let place = window.current_monitor().ok().flatten().map(|monitor| {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (left, top) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
        let (w, h) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
        (left + (w - width) / 2.0, top + h - height - 48.0)
    });
    let builder = tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::App("lyrics-overlay.html".into()))
        .title("Devil Music lyrics").inner_size(width, height).min_inner_size(360.0, 88.0)
        .decorations(false).shadow(false).resizable(true).always_on_top(true).skip_taskbar(true)
        .focused(false).visible(false).disable_drag_drop_handler()
        .on_navigation(|url| (url.scheme() == "tauri" && url.host_str() == Some("localhost")) || (url.host_str() == Some("tauri.localhost") && matches!(url.scheme(), "http" | "https")));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let builder = match place { Some((x, y)) => builder.position(x, y), None => builder.center() };
    let strip = builder.build().map_err(|e| e.to_string())?;
    let main = app.clone();
    strip.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) { let _ = main.emit_to("main", "lyrics-overlay-closed", ()); }
    });
    strip.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lyrics_overlay_close(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" && window.label() != LABEL { return Err("Unavailable window".into()); }
    if let Some(strip) = app.get_webview_window(LABEL) { strip.close().map_err(|e| e.to_string())?; }
    Ok(())
}

/// The current line goes to the strip and to the mini-player, whichever is open.
#[tauri::command]
pub fn lyrics_line_update(app: tauri::AppHandle, window: tauri::WebviewWindow, state: LyricState) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let state = sanitize(state);
    for label in [LABEL, MINI] {
        if app.get_webview_window(label).is_some() { app.emit_to(label, "lyrics-line", state.clone()).map_err(|e| e.to_string())?; }
    }
    Ok(())
}

/// Moving the strip, and locking it so clicks reach the windows underneath. A locked strip is unlocked
/// from the main window, since it no longer receives the pointer itself.
#[tauri::command]
pub fn lyrics_overlay_action(app: tauri::AppHandle, window: tauri::WebviewWindow, action: String) -> Result<bool, String> {
    let strip = if window.label() == LABEL { window.clone() } else if window.label() == "main" { app.get_webview_window(LABEL).ok_or("The lyrics strip is closed")? } else { return Err("Unavailable window".into()) };
    match action.as_str() {
        "drag" if window.label() == LABEL => { strip.start_dragging().map_err(|e| e.to_string())?; Ok(false) },
        "lock" | "unlock" => {
            let locked = action == "lock";
            strip.set_ignore_cursor_events(locked).map_err(|e| e.to_string())?;
            app.emit_to(LABEL, "lyrics-overlay-locked", locked).map_err(|e| e.to_string())?;
            app.emit_to("main", "lyrics-overlay-locked", locked).map_err(|e| e.to_string())?;
            Ok(locked)
        },
        _ => Err("Unknown lyrics strip action".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_bounded_and_times_kept_in_range() {
        let long = "a".repeat(1000);
        let state = sanitize(LyricState {
            id: "x".repeat(200), position: f64::NAN, rate: 99.0, accent: "red".into(), playing: true,
            line: Line { text: long.clone(), next: "next\u{0007}".into(), at: -5.0, end: f64::INFINITY, words: (0..500).map(|i| Word { text: long.clone(), at: i as f64, end: i as f64 + 0.5 }).collect() },
        });
        assert_eq!(state.id.len(), 64);
        assert_eq!(state.line.text.len(), 400);
        assert_eq!(state.line.next, "next");
        assert_eq!((state.line.at, state.line.end, state.position, state.rate), (0.0, 0.0, 0.0, 4.0));
        assert_eq!(state.line.words.len(), 120);
        assert_eq!(state.line.words[0].text.len(), 80);
        assert!(state.accent.is_empty());
        assert_eq!(sanitize(LyricState { accent: "#9ad0ff".into(), ..Default::default() }).accent, "#9ad0ff");
    }
}
