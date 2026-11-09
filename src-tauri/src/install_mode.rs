//! The choice made in the Windows installer on a first install: all of Deviload, or only Devil Music.
//! The installer leaves it in a small file; the app takes it once on its first start and removes it.
use tauri::Manager;

fn parse(text: &str) -> Option<String> {
    match text.trim() {
        "music" => Some("music".into()),
        "all" => Some("all".into()),
        _ => None,
    }
}

#[tauri::command]
pub fn take_install_mode(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Option<String> {
    if window.label() != "main" { return None; }
    let path = app.path().app_local_data_dir().ok()?.join("install-mode");
    if std::fs::metadata(&path).ok()?.len() > 64 { let _ = std::fs::remove_file(&path); return None; }
    let text = std::fs::read_to_string(&path).ok();
    let _ = std::fs::remove_file(&path);
    parse(&text?)
}

#[cfg(test)]
mod tests {
    use super::parse;
    #[test]
    fn only_known_choices_count() {
        assert_eq!(parse("music\r\n").as_deref(), Some("music"));
        assert_eq!(parse("all").as_deref(), Some("all"));
        assert_eq!(parse("everything"), None);
        assert_eq!(parse(""), None);
    }
}
