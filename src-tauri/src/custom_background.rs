//! The picture, animation or video behind the "Your own" theme. The chosen file is copied into the app's
//! folder so the theme keeps working when the original is moved or deleted.
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const IMAGES: [&str; 5] = ["jpg", "jpeg", "png", "webp", "gif"];
const VIDEOS: [&str; 2] = ["mp4", "webm"];
const LIMIT: u64 = 300 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Background { path: String, kind: &'static str }

fn folder(dir: &Path) -> PathBuf { dir.join("backgrounds") }

/// What a file of this name shows as, or nothing for files the theme cannot show.
pub fn kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if IMAGES.contains(&ext.as_str()) { Some("image") } else if VIDEOS.contains(&ext.as_str()) { Some("video") } else { None }
}

/// Copies [source] into the backgrounds folder, replacing any earlier background.
pub fn adopt(dir: &Path, source: &Path, now: u128) -> Result<Background, String> {
    let kind = kind(source).ok_or("Choose a photo, a GIF or an MP4 or WebM video.")?;
    let size = fs::metadata(source).map_err(|_| "The file could not be read.")?.len();
    if size == 0 || size > LIMIT { return Err("Choose a file smaller than 300 MB.".into()) }
    let target_dir = folder(dir);
    fs::create_dir_all(&target_dir).map_err(|_| "Could not save the background.")?;
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_ascii_lowercase();
    let target = target_dir.join(format!("background-{now}.{ext}"));
    fs::copy(source, &target).map_err(|_| "Could not save the background.")?;
    clear_except(dir, Some(&target));
    // The asset protocol matches files by their canonical path, so that is the one the page uses.
    let target = target.canonicalize().unwrap_or(target);
    Ok(Background { path: target.to_string_lossy().into_owned(), kind })
}

/// Removes saved backgrounds, keeping the file named like [keep] when given.
pub fn clear_except(dir: &Path, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(folder(dir)) else { return };
    let keep = keep.and_then(Path::file_name);
    for entry in entries.flatten() {
        if Some(entry.file_name().as_os_str()) != keep && entry.file_type().is_ok_and(|t| t.is_file()) { let _ = fs::remove_file(entry.path()); }
    }
}

/// A saved background, only when the path really is one of ours.
pub fn saved(dir: &Path, path: &str) -> Option<PathBuf> {
    let base = folder(dir).canonicalize().ok()?;
    let file = Path::new(path).canonicalize().ok()?;
    (file.starts_with(&base) && file.is_file() && kind(&file).is_some()).then_some(file)
}

#[tauri::command]
pub async fn custom_background_choose(app: tauri::AppHandle, window: tauri::WebviewWindow, engine: tauri::State<'_, crate::Engine>) -> Result<Option<Background>, String> {
    if window.label() != "main" { return Err("Unavailable window".into()) }
    let dir = engine.dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().add_filter("Photo, GIF or video", &["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm"]).blocking_pick_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let background = adopt(&dir, &path, now)?;
        app.asset_protocol_scope().allow_file(&background.path).map_err(|e| e.to_string())?;
        Ok(Some(background))
    }).await.map_err(|_| "Could not save the background.".to_owned())?
}

/// Lets a saved background show again after a restart.
#[tauri::command]
pub fn custom_background_allow(path: String, app: tauri::AppHandle, engine: tauri::State<'_, crate::Engine>) -> Option<Background> {
    let file = saved(&engine.dir, &path)?;
    app.asset_protocol_scope().allow_file(&file).ok()?;
    Some(Background { kind: kind(&file)?, path: file.to_string_lossy().into_owned() })
}

#[tauri::command]
pub fn custom_background_clear(engine: tauri::State<'_, crate::Engine>) { clear_except(&engine.dir, None) }

#[cfg(test)]
mod tests {
    use super::*;
    fn scratch(name: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("deviload-bg-{name}-{}", std::process::id())); let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap(); d }

    #[test]
    fn a_chosen_file_is_copied_in_and_replaces_the_previous_one() {
        let dir = scratch("adopt");
        let photo = dir.join("Beach.JPG"); fs::write(&photo, b"jpeg").unwrap();
        let clip = dir.join("loop.webm"); fs::write(&clip, b"webm").unwrap();
        let first = adopt(&dir, &photo, 1).unwrap();
        assert_eq!(first.kind, "image");
        let second = adopt(&dir, &clip, 2).unwrap();
        assert_eq!(second.kind, "video");
        assert!(!Path::new(&first.path).exists() && Path::new(&second.path).exists());
        assert!(photo.exists(), "the original stays where it was");
        assert!(saved(&dir, &second.path).is_some());
        assert!(saved(&dir, photo.to_str().unwrap()).is_none(), "only files inside the backgrounds folder count");
        clear_except(&dir, None);
        assert!(saved(&dir, &second.path).is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unsupported_or_empty_files_are_refused() {
        let dir = scratch("refuse");
        let text = dir.join("notes.txt"); fs::write(&text, b"x").unwrap();
        let empty = dir.join("blank.png"); fs::write(&empty, b"").unwrap();
        assert!(adopt(&dir, &text, 1).is_err());
        assert!(adopt(&dir, &empty, 1).is_err());
        assert_eq!(kind(Path::new("a.GIF")), Some("image"));
        assert_eq!(kind(Path::new("a.mov")), None);
        let _ = fs::remove_dir_all(dir);
    }
}
