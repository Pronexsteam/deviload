use super::{exact, load, state, Entry};
use std::path::PathBuf;
use tauri::Manager;

fn tag(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

// Local files currently have a single artist tag. Never infer shared credits
// from substrings, or strip version names to make different recordings match.
fn only_match<'a>(entries: impl Iterator<Item = &'a Entry>, title: &str, artists: &[String], duration: f64, album: Option<&str>) -> Option<&'a Entry> {
    if artists.len() != 1 || !duration.is_finite() || duration <= 0.0 { return None; }
    let title = tag(title);
    let artist = tag(&artists[0]);
    if title.is_empty() || artist.is_empty() { return None; }
    let album = album.map(tag).filter(|s| !s.is_empty());
    let tolerance = (duration * 0.005).clamp(0.5, 2.0);
    let mut found: Option<&Entry> = None;
    for entry in entries {
        if !entry.duration.is_finite() || entry.duration <= 0.0 || (duration - entry.duration).abs() > tolerance { continue; }
        if tag(&entry.title) != title || tag(&entry.artist) != artist { continue; }
        if album.as_ref().is_some_and(|name| !entry.album.is_empty() && tag(&entry.album) != *name) { continue; }
        if entry.needs_scan || found.is_some_and(|prev| prev.hash != entry.hash) { return None; }
        found = Some(entry);
    }
    found
}

#[tauri::command]
pub async fn music_local_equivalent(window: tauri::WebviewWindow, app: tauri::AppHandle, engine: tauri::State<'_, crate::Engine>,
    title: String, artists: Vec<String>, duration: f64, album: Option<String>) -> Result<Option<String>, String> {
    if window.label() != "main" || title.len() > 1024 || artists.len() != 1 || artists[0].len() > 400 || album.as_ref().is_some_and(|s|s.len()>1024) { return Ok(None); }
    let dir = engine.dir.clone();
    let path = tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
        load(&dir)?;
        let selected = {
            let library = state().lock().map_err(|e|e.to_string())?;
            only_match(library.index.entries.values(), &title, &artists, duration, album.as_deref())
                .map(|entry|(entry.id.clone(), entry.hash.clone()))
        };
        let Some((id, hash)) = selected else { return Ok(None); };
        exact::indexed_source(&dir, &id, &hash).map(Some)
    }).await.map_err(|e| e.to_string())??;
    let Some(path) = path else { return Ok(None); };
    app.asset_protocol_scope().allow_file(&path).map_err(|e|e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_matching_file_only_even_for_shared_titles() {
        let item=|title:&str,hash:&str,duration:f64| Entry{title:title.into(),artist:"Singer".into(),hash:hash.into(),duration,..Default::default()};
        let recording=item("Song","one",180.);
        let edit=item("Song (Radio Edit)","edit",180.);
        let other_take=item("Song","two",180.);
        let longer=item("Song","live",184.);
        let matches=|rows:&[&Entry]|only_match(rows.iter().copied()," SONG ",&["singer".into()],180.,None).is_some();
        assert!(matches(&[&edit,&longer,&recording]));
        assert!(!matches(&[&edit,&longer]));
        assert!(!matches(&[&recording,&other_take]));
        assert!(only_match([&recording].into_iter(),"Song",&["Singer".into(),"Other".into()],180.,None).is_none());
    }
}
