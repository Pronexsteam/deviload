//! The person's own Spotify sign-in, used only to read their liked songs and playlists into Devil Music.
//! The sign-in window keeps its own profile; only Spotify's sp_dc cookie is saved, in a private file of its own.
//! Downloads, listening rooms, the phone remote, settings backups and diagnostics never receive it.
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, thread, time::Duration};
use tauri::{Emitter, Manager};

// Names and addresses, not messages.
const FILE: &'static str = "spotify-session.json";
const SIGN_IN: &'static str = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";
const NO_SIGN_IN: &str = "Sign in to Spotify first.";
const LIBRARY: &str = "Could not read your Spotify library. Try again later.";
const BUSY: &str = "Your library is already being read. Please wait.";
const LABEL: &'static str = "spotify-signin";

fn valid(value: &str) -> bool { (20..=2048).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }

pub(crate) fn saved(dir: &Path) -> Option<String> {
    let data: Value = serde_json::from_slice(&fs::read(dir.join(FILE)).ok()?).ok()?;
    data["sp_dc"].as_str().filter(|v| valid(v)).map(str::to_owned)
}
fn save(dir: &Path, value: &str) -> Result<(), String> {
    if !valid(value) { return Err(NO_SIGN_IN.into()); }
    crate::write_private(&dir.join(FILE), &json!({"sp_dc": value}).to_string())
}
fn profile(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map(|dir| dir.join("spotify-session")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spotify_account_status(engine: tauri::State<'_, crate::Engine>) -> Result<bool, String> {
    Ok(saved(&engine.dir).is_some())
}

#[tauri::command]
pub async fn spotify_sign_in(app: tauri::AppHandle, window: tauri::WebviewWindow, engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    if let Some(existing) = app.get_webview_window(LABEL) { return existing.set_focus().map_err(|e| e.to_string()); }
    let dir = engine.dir.clone();
    let builder = tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::External(SIGN_IN.parse().map_err(|_| "Invalid sign-in address")?))
        .title("Spotify · Deviload")
        .inner_size(520.0, 760.0)
        .min_inner_size(420.0, 560.0)
        .on_page_load(move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished { return; }
            // The web player opens once the sign-in, its challenges included, is complete.
            if payload.url().host_str() != Some("open.spotify.com") { return; }
            let dir = dir.clone();
            // Reading cookies on the page-load thread deadlocks WebView2.
            thread::spawn(move || {
                let Ok(url) = "https://open.spotify.com/".parse() else { return };
                let Ok(cookies) = window.cookies_for_url(url) else { return };
                let Some(value) = cookies.iter().find(|c| c.name() == "sp_dc" && valid(c.value())).map(|c| c.value().to_owned()) else { return };
                if save(&dir, &value).is_ok() {
                    let _ = window.app_handle().emit("spotify-session", true);
                    let _ = window.close();
                }
            });
        });
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(profile(&app)?);
    builder.build().map(|_| ()).map_err(|e| format!("Could not open the sign-in window: {e}"))
}

#[tauri::command]
pub async fn spotify_sign_out(app: tauri::AppHandle, window: tauri::WebviewWindow, engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    if let Some(open) = app.get_webview_window(LABEL) { let _ = open.destroy(); }
    let file = engine.dir.join(FILE);
    if file.exists() { fs::remove_file(&file).map_err(|e| format!("Could not remove the saved sign-in: {e}"))?; }
    let profile = profile(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // WebView2 can hold the profile for a moment after the window closes.
        for _ in 0..20 {
            if !profile.exists() || fs::remove_dir_all(&profile).is_ok() { return; }
            thread::sleep(Duration::from_millis(250));
        }
    }).await.map_err(|e| e.to_string())?;
    let _ = app.emit("spotify-session", false);
    Ok(())
}

fn checked(data: Value) -> Result<Value, String> {
    if data["source"] != "spotify" || data["origin"] != "account" || !data["entries"].is_array() || !data["playlists"].is_array() { return Err(LIBRARY.into()); }
    Ok(data)
}

#[tauri::command]
pub async fn music_import_spotify_account(window: tauri::WebviewWindow, engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    if window.label() != "main" { return Err("Music import is only available in the main window.".into()); }
    let cookie = saved(&engine.dir).ok_or(NO_SIGN_IN)?;
    tauri::async_runtime::spawn_blocking(move || {
        static ACTIVE: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = ACTIVE.try_lock().map_err(|_| BUSY)?;
        checked(crate::music_playlist_import::run_spotify_script(&["--library"], &[("DEVILOAD_SPOTIFY_SESSION", &cookie)], Duration::from_secs(600), LIBRARY)?)
    }).await.map_err(|_| LIBRARY.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_saved_sign_in_is_only_a_plausible_cookie() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(saved(dir.path()), None);
        assert!(save(dir.path(), "short").is_err());
        assert!(save(dir.path(), "AQ\"; rm -rf /; x=aaaaaaaaaaaaaaaaaaaaaaaa").is_err());
        let cookie = "AQB_".to_string() + &"x".repeat(60);
        save(dir.path(), &cookie).unwrap();
        assert_eq!(saved(dir.path()), Some(cookie));
        fs::write(dir.path().join(FILE), b"{\"sp_dc\":\"bad value with spaces and more than twenty\"}").unwrap();
        assert_eq!(saved(dir.path()), None);
    }

    #[test]
    fn only_a_library_from_the_script_is_accepted() {
        assert!(checked(json!({"source":"spotify","origin":"account","entries":[],"playlists":[]})).is_ok());
        assert!(checked(json!({"source":"spotify","origin":"link","entries":[],"playlists":[]})).is_err());
        assert!(checked(json!({"error":"x"})).is_err());
    }
}
