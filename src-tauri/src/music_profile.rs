use std::io::Write;
use tauri_plugin_dialog::DialogExt;

fn validate(text: &str) -> Result<(), String> {
    if text.len() > 2 * 1024 * 1024 { return Err("Music profile is too large (maximum 2 MB).".into()); }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| "Invalid music profile.")?;
    if value["format"] != "devil-music-profile" || !value["saved"].is_object() || !value["taste"].is_object() {
        return Err("Invalid music profile.".into());
    }
    if value["version"] != 1 { return Err("This music profile version is not supported.".into()); }
    Ok(())
}

#[tauri::command]
pub async fn export_music_profile(app: tauri::AppHandle, window: tauri::WebviewWindow, text: String) -> Result<bool, String> {
    if window.label() != "main" { return Err("Invalid music profile.".into()); }
    validate(&text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().add_filter("Devil Music", &["json"])
            .set_file_name("devil-music-profile.json").blocking_save_file() else { return Ok(false); };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let parent = path.parent().ok_or("Choose a local folder")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temporary.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary.persist(path).map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_other_documents_and_oversized_exports() {
        assert!(validate(r#"{"format":"devil-music-profile","version":1,"saved":{},"taste":{}}"#).is_ok());
        for text in ["{}", "not JSON", r#"{"format":"devil-music-profile","version":2,"saved":{},"taste":{}}"#] {
            assert!(validate(text).is_err());
        }
        assert!(validate(&"x".repeat(2 * 1024 * 1024 + 1)).is_err());
    }
}
