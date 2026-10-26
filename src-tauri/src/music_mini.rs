use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager};

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct MiniQueueItem { id: String, title: String, artist: String }

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniState {
    title: String, artist: String, image: String, theme: String,
    active: bool, playing: bool, previous_enabled: bool, next_enabled: bool,
    position: f64, duration: f64,
    #[serde(default)] volume: f64,
    #[serde(default)] repeat: String,
    #[serde(default)] shuffle: bool,
    #[serde(default)] queue: Vec<MiniQueueItem>,
}
static STATE: OnceLock<Mutex<MiniState>> = OnceLock::new();
fn stored() -> &'static Mutex<MiniState> { STATE.get_or_init(|| Mutex::new(MiniState::default())) }

static OPENING: AtomicBool = AtomicBool::new(false);
// Reserve creation before checking the window registry: WebView2 creation can
// yield long enough for another IPC call to pass that same check.
struct OpeningGuard<'a>(&'a AtomicBool);
impl<'a> OpeningGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| Self(flag))
    }
}
impl Drop for OpeningGuard<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

#[cfg(windows)]
fn round_native_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    use windows::Win32::{Foundation::HWND, Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn}};
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let diameter = (36.0 * window.scale_factor().map_err(|e| e.to_string())?).round() as i32;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let region = CreateRoundRectRgn(0, 0, size.width as i32 + 1, size.height as i32 + 1, diameter, diameter);
        if region.0.is_null() { return Err("Could not shape mini player".into()); }
        // Windows owns the region after success. On failure we must free it.
        if SetWindowRgn(HWND(hwnd.0), Some(region), true) == 0 {
            let _ = DeleteObject(region.into());
            return Err("Could not shape mini player".into());
        }
    }
    Ok(())
}
pub(super) fn sanitize(mut state: MiniState) -> MiniState {
    state.title = state.title.chars().filter(|c| !c.is_control()).take(240).collect();
    state.artist = state.artist.chars().filter(|c| !c.is_control()).take(320).collect();
    let allowed = url::Url::parse(&state.image).is_ok_and(|url| url.scheme() == "https" && matches!(url.host_str(), Some("i.ytimg.com" | "lh3.googleusercontent.com" | "yt3.googleusercontent.com")) && url.username().is_empty() && url.password().is_none());
    if !allowed || state.image.len() > 2048 { state.image.clear(); }
    if !matches!(state.theme.as_str(), "ambient" | "glass-light" | "aurora" | "prism") { state.theme = "ambient".into(); }
    for value in [&mut state.position, &mut state.duration] { *value = if value.is_finite() { value.clamp(0.0, 86400.0) } else { 0.0 }; }
    state.volume = if state.volume.is_finite() { state.volume.clamp(0.0, 1.0) } else { 0.0 };
    if !matches!(state.repeat.as_str(), "off" | "all" | "one") { state.repeat = "off".into(); }
    state.queue.retain(|item| item.id.len()==11 && item.id.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'_' || b==b'-'));
    state.queue.truncate(32);
    for item in &mut state.queue {
        item.title=item.title.chars().filter(|c| !c.is_control()).take(240).collect();
        item.artist=item.artist.chars().filter(|c| !c.is_control()).take(320).collect();
    }
    state
}
#[tauri::command]
pub fn music_mini_queue(app: tauri::AppHandle, window: tauri::WebviewWindow, action: String, id: String, before: Option<String>) -> Result<(), String> {
    if window.label()!="music-mini" { return Err("Unavailable window".into()); }
    {
        let state=stored().lock().map_err(|e| e.to_string())?;
        if !matches!(action.as_str(),"play"|"move") || !state.queue.iter().any(|item| item.id==id) || before.as_ref().is_some_and(|target| !state.queue.iter().any(|item| &item.id==target)) { return Err("Queue changed; try again".into()); }
    }
    app.emit_to("main","music-mini-queue",serde_json::json!({"action":action,"id":id,"before":before})).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn music_mini_update(app: tauri::AppHandle, window: tauri::WebviewWindow, state: MiniState) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let state = sanitize(state);*stored().lock().map_err(|e| e.to_string())? = state.clone();
    app.emit_to("music-mini", "music-mini-state", state).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn music_mini_open(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let Some(_opening) = OpeningGuard::acquire(&OPENING) else { return Ok(()); };
    if let Some(mini) = app.get_webview_window("music-mini") { let _ = mini.unminimize(); mini.show().map_err(|e| e.to_string())?;mini.set_focus().map_err(|e| e.to_string())?;return window.hide().map_err(|e| e.to_string()); }
    let builder = tauri::WebviewWindowBuilder::new(&app, "music-mini", tauri::WebviewUrl::App("music-mini.html".into()))
        .title("Devil Music").inner_size(380.0, 112.0)
        .resizable(false).decorations(false).shadow(false).center().visible(false).disable_drag_drop_handler()
        .on_navigation(|url| (url.scheme() == "tauri" && url.host_str() == Some("localhost")) || (url.host_str() == Some("tauri.localhost") && matches!(url.scheme(), "http" | "https")));
    // Transparent corners without enabling private macOS APIs for the app.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let mini = builder.build().map_err(|e| e.to_string())?;
    #[cfg(windows)] {
        if let Err(error) = round_native_window(&mini) { let _ = mini.close();return Err(error); }
        crate::music_controls::taskbar::install(&mini);
        let resized = mini.clone();
        mini.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
                let _ = round_native_window(&resized);
            }
        });
    }
    if let Err(error) = mini.show().and_then(|_| mini.set_focus()) { let _ = mini.close();return Err(error.to_string()); }
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn music_mini_state(window: tauri::WebviewWindow) -> Result<MiniState, String> {
    if window.label() != "music-mini" { return Err("Unavailable window".into()); }
    stored().lock().map(|state| state.clone()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn music_mini_action(app: tauri::AppHandle, window: tauri::WebviewWindow, action: String, value: Option<f64>) -> Result<bool, String> {
    if window.label() != "music-mini" { return Err("Unavailable window".into()); }
    match action.as_str() {
        "previous" | "play" | "next" | "repeat" | "shuffle" | "mute" => { app.emit_to("main", "music-control", action).map_err(|e| e.to_string())?; Ok(false) },
        "volume" | "seek" => { let value = value.filter(|v| v.is_finite() && (0.0..=1.0).contains(v)).ok_or("Invalid playback value")?;app.emit_to("main", "music-mini-adjust", serde_json::json!({"action": action, "value": value})).map_err(|e| e.to_string())?;Ok(false) },
        "close" => { window.close().map_err(|e| e.to_string())?;Ok(false) },
        "drag" => { window.start_dragging().map_err(|e| e.to_string())?;Ok(false) },
        "show" => { if let Some(main) = app.get_webview_window("main") { let _ = main.unminimize();main.show().map_err(|e| e.to_string())?; main.set_focus().map_err(|e| e.to_string())?;app.emit_to("main", "music-mini-show", ()).map_err(|e| e.to_string())?;window.close().map_err(|e| e.to_string())?; } Ok(false) },
        "pin" => { let pinned = !window.is_always_on_top().map_err(|e| e.to_string())?;window.set_always_on_top(pinned).map_err(|e| e.to_string())?;Ok(pinned) },
        _ => Err("Unknown music action".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn concurrent_open_requests_share_one_creation_and_retry_after_failure() {
        let flag = AtomicBool::new(false);
        let guard = OpeningGuard::acquire(&flag).unwrap();
        std::thread::scope(|scope| {
            for _ in 0..12 { scope.spawn(|| assert!(OpeningGuard::acquire(&flag).is_none())); }
        });
        drop(guard);
        // The same drop runs on every early-return/error path in open.
        assert!(OpeningGuard::acquire(&flag).is_some());
        assert!(!flag.load(Ordering::Acquire));
    }
    #[test] fn mini_queue_is_bounded_and_rejects_invalid_ids() {
        let mut queue:Vec<_>=(0..100).map(|n|MiniQueueItem{id:format!("{n:011}"),title:"x".repeat(400),artist:"a\nb".into()}).collect();
        queue.insert(0,MiniQueueItem{id:"invalid".into(),..Default::default()});
        let value=sanitize(MiniState{queue,..Default::default()});
        assert_eq!(value.queue.len(),32);assert_eq!(value.queue[0].id,"00000000000");assert_eq!(value.queue[0].title.len(),240);assert_eq!(value.queue[0].artist,"ab");
    }
    #[test] fn current_themes_survive_mini_and_remote_sanitization() {
        for theme in ["ambient", "glass-light", "aurora", "prism"] {
            assert_eq!(sanitize(MiniState { theme:theme.into(), ..Default::default() }).theme, theme);
        }
        for theme in ["classic", "matte-black", "glass-black", "midnight", "spotify", "unknown"] {
            assert_eq!(sanitize(MiniState { theme:theme.into(), ..Default::default() }).theme, "ambient");
        }
    }
    #[test] fn bounds_and_image_origin() {
        let s = sanitize(MiniState { title: "x".repeat(400), image: "https://i.ytimg.com.evil.test/a".into(), position: f64::NAN, duration: 1e9, ..Default::default() });
        assert_eq!(s.title.len(), 240);assert!(s.image.is_empty());assert_eq!(s.position, 0.0);assert_eq!(s.duration, 86400.0);
        let image = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg";
        assert_eq!(sanitize(MiniState { image: image.into(), ..Default::default() }).image, image);
    }
}
