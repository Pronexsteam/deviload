//! Saves a lyric card, the picture of a few sung lines, where the listener chooses.
use base64::Engine;
use std::io::Write;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// The picture from the page: base64 PNG of a sane size, nothing else.
fn picture(png: &str) -> Result<Vec<u8>, String> {
    if png.len() > MAX_BYTES / 3 * 4 + 4 { return Err("The picture is too large.".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(png).map_err(|_| "Invalid picture.")?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(&PNG) { return Err("Invalid picture.".into()); }
    Ok(bytes)
}

/// A file name the save dialog can offer: letters, digits, spaces, dashes and dots, ending in .png.
fn file_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '.')).take(100).collect();
    let stem = clean.trim().trim_end_matches(".png").trim_matches('.').trim();
    format!("{}.png", if stem.is_empty() { "Devil Music lyric" } else { stem })
}

#[tauri::command]
pub async fn save_lyric_card(app: tauri::AppHandle, window: tauri::WebviewWindow, png: String, name: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if window.label() != "main" { return Err("Invalid picture.".into()); }
    let bytes = picture(&png)?;
    let name = file_name(&name);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().add_filter("PNG picture", &["png"]).set_file_name(&name).blocking_save_file() else { return Ok(false); };
        let path = file.into_path().map_err(|_| "Choose a local folder.")?;
        let parent = path.parent().ok_or("Choose a local folder.")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not save the picture.")?;
        temporary.write_all(&bytes).and_then(|_| temporary.as_file().sync_all()).map_err(|_| "Could not save the picture.")?;
        temporary.persist(path).map_err(|_| "Could not save the picture.")?;
        Ok(true)
    }).await.map_err(|_| "Could not save the picture.".to_owned())?
}

/// Puts the picture on the clipboard, ready to paste into a chat.
#[tauri::command]
pub fn copy_lyric_card(app: tauri::AppHandle, window: tauri::WebviewWindow, png: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    if window.label() != "main" { return Err("Invalid picture.".into()); }
    let bytes = picture(&png)?;
    let image = tauri::image::Image::from_bytes(&bytes).map_err(|_| "Invalid picture.")?;
    app.clipboard().write_image(&image).map_err(|_| "Could not copy the picture.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_png_pictures_are_saved() {
        let png = base64::engine::general_purpose::STANDARD.encode([&PNG[..], b"rest"].concat());
        assert!(picture(&png).is_ok());
        assert!(picture(&base64::engine::general_purpose::STANDARD.encode(b"GIF89a")).is_err());
        assert!(picture("not base64!").is_err());
        assert!(picture(&"A".repeat(MAX_BYTES * 2)).is_err());
    }
    #[test]
    fn names_stay_plain() {
        assert_eq!(file_name("Imagine Dragons - Believer lyric.png"), "Imagine Dragons - Believer lyric.png");
        assert_eq!(file_name(r"..\..\evil/../x"), "evil..x.png");
        assert_eq!(file_name("  "), "Devil Music lyric.png");
        assert_eq!(file_name("\u{41a}\u{438}\u{43d}\u{43e}"), "\u{41a}\u{438}\u{43d}\u{43e}.png");
    }
}
