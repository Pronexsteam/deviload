use serde_json::{json, Value};
use tauri::Manager;
use std::path::{Path, PathBuf};

fn youtube_id(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    let host = url.host_str()?;
    let id = if host == "youtu.be" { url.path().trim_start_matches('/').to_owned() }
        else if ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].contains(&host) {
            url.query_pairs().find(|(k, _)| k == "v")?.1.into_owned()
        } else { return None; };
    (id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then_some(id)
}

fn audio_path(raw: &str) -> Option<PathBuf> {
    let path = Path::new(raw);
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !["mp3", "flac", "wav", "m4a", "ogg", "opus", "aac", "webm", "mp4"].contains(&ext.as_str()) { return None; }
    let path = path.canonicalize().ok()?;
    path.is_file().then_some(path)
}

fn entries(engine: &crate::Engine) -> Vec<(String, PathBuf, String)> {
    let jobs = engine.data.lock().unwrap().jobs.clone();
    let mut entries = Vec::new();
    for job in jobs.iter().rev().filter(|job| job.status == "done" && !job.hidden_in_library && job.options.clip_start.is_none() && job.options.clip_end.is_none() && !job.options.split_chapters) {
        if let (Some(id), Some(path)) = (youtube_id(&job.url), audio_path(&job.file)) {
            if !entries.iter().any(|(key, _, _)| key == &id) { entries.push((id, path, job.channel.clone())); }
        }
        for [key, file] in &job.downloads {
            if let Some(id) = key.strip_prefix("youtube ").filter(|id| id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) {
                if let Some(path) = audio_path(file) {
                    if !entries.iter().any(|(key, _, _)| key == id) { entries.push((id.to_owned(), path, job.channel.clone())); }
                }
            }
        }
    }
    entries.truncate(1000);
    entries
}

#[tauri::command]
pub async fn music_downloaded(engine: tauri::State<'_, crate::Engine>) -> Result<Vec<Value>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || entries(&engine).into_iter().map(|(id, path, artist)| {
        json!({"id":id,"kind":"song","title":path.file_stem().unwrap_or_default().to_string_lossy(),
            "subtitle":artist,"artists":if artist.is_empty(){vec![]}else{vec![artist]},"image":""})
    }).collect()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn music_offline_source(id: String, engine: tauri::State<'_, crate::Engine>, app: tauri::AppHandle) -> Result<Option<String>, String> {
    let engine = engine.inner().clone();
    let path = tauri::async_runtime::spawn_blocking(move || entries(&engine).into_iter().find(|(key, _, _)| key == &id).map(|(_, path, _)| path))
        .await.map_err(|e| e.to_string())?;
    if let Some(path) = path {
        app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn music_offline_matches_only_youtube_tracks() {
        assert_eq!(youtube_id("https://music.youtube.com/watch?v=abcdefghijk&list=RD"),Some("abcdefghijk".into()));
        assert_eq!(youtube_id("https://youtu.be/abcdefghijk"),Some("abcdefghijk".into()));
        assert_eq!(youtube_id("https://youtube.com.attacker.test/watch?v=abcdefghijk"),None);
        assert_eq!(youtube_id("https://youtube.com/playlist?list=abcdefghijk"),None);
        assert_eq!(youtube_id("https://youtube.com/watch?v=../../local"),None);
    }
    #[test]
    fn music_offline_indexes_only_completed_existing_visible_files() {
        use std::sync::{Arc, Mutex, atomic::AtomicBool};
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Test song.mp3");std::fs::write(&file, b"test fixture").unwrap();
        let job: crate::model::Job = serde_json::from_value(json!({"id":1,"url":"https://youtube.com/watch?v=abcdefghijk",
            "options":crate::model::Options::default(),"status":"done","percent":100,"speed":"","file":file.to_string_lossy(),"log":[]})).unwrap();
        let engine=crate::Engine{dir:dir.path().into(),data:Arc::new(Mutex::new(crate::Snapshot{jobs:vec![job],..crate::Snapshot::default()})),shutdown:Arc::new(AtomicBool::new(false))};
        assert_eq!(entries(&engine).len(),1);
        assert_eq!(entries(&engine)[0].0,"abcdefghijk");
        engine.data.lock().unwrap().jobs[0].status="running".into();assert!(entries(&engine).is_empty());
        engine.data.lock().unwrap().jobs[0].status="done".into();
        engine.data.lock().unwrap().jobs[0].hidden_in_library=true;assert!(entries(&engine).is_empty());
        engine.data.lock().unwrap().jobs[0].hidden_in_library=false;
        std::fs::remove_file(file).unwrap();assert!(entries(&engine).is_empty());
    }
}
