//! Reads the person's own YouTube Music library (liked songs and their playlists) through the sign-in Deviload
//! already keeps for downloads. Only the local yt-dlp sees that sign-in; the result is song ids, titles and
//! playlist names, handed to the same import review as an export file. Nothing is written to the account.
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, time::Duration};

const NO_SIGN_IN: &str = "Sign in to YouTube in Music settings first.";
const UNAVAILABLE: &str = "Could not read your YouTube Music library. Try again later.";
const PARTIAL: &str = "Some of your playlists could not be read.";
const BUSY: &str = "Your library is already being read. Please wait.";
const MAX_PLAYLISTS: usize = 60;
const MAX_SONGS: usize = 5000;
// Lists the account owns but that are not playlists of songs.
const SKIPPED: [&str; 3] = ["LL", "WL", "LM"];

fn clean(value: &Value, limit: usize) -> String {
    value.as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(limit).collect::<String>().trim().to_owned()
}
fn video_id(value: &Value) -> Option<String> {
    let id = value.as_str()?;
    (id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')).then(|| id.to_owned())
}
fn playlist_id(value: &Value) -> Option<String> {
    let id = value.as_str()?;
    (id.len() >= 2 && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') && !SKIPPED.contains(&id)).then(|| id.to_owned())
}
// "Artist - Topic" channels carry the artist's name; YouTube Music lists songs under them.
fn artist(entry: &Value) -> String {
    let name = [&entry["artist"], &entry["channel"], &entry["uploader"]].into_iter().map(|v| clean(v, 200)).find(|v| !v.is_empty()).unwrap_or_default();
    name.strip_suffix(" - Topic").unwrap_or(&name).trim().to_owned()
}
fn image(entry: &Value) -> Option<String> {
    entry["thumbnails"].as_array()?.iter().rev().filter_map(|t| t["url"].as_str()).find(|url| {
        url::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && matches!(u.host_str(), Some("i.ytimg.com" | "lh3.googleusercontent.com")))
    }).map(str::to_owned)
}

/// Where a list's songs are read. A saved Mix (RD and the song it started from) has no playlist page: YouTube
/// answers "unviewable", so it is opened from its first song instead.
fn list_url(id: &str) -> String {
    match id.strip_prefix("RD").filter(|seed| seed.len() == 11) {
        Some(seed) => format!("https://www.youtube.com/watch?v={seed}&list={id}"),
        None => format!("https://www.youtube.com/playlist?list={id}"),
    }
}

/// Songs of one list, in order, without repeats.
fn songs(list: &Value) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    list["entries"].as_array().map(|entries| entries.iter().filter_map(|entry| {
        let id = video_id(&entry["id"])?;
        let title = clean(&entry["title"], 300);
        if title.is_empty() || !seen.insert(id.clone()) { return None; }
        let artist = artist(entry);
        Some(json!({"key": format!("youtube:{id}"), "videoId": id, "title": title, "artists": if artist.is_empty() { vec![] } else { vec![artist] }, "image": image(entry), "liked": false, "plays": 0}))
    }).take(MAX_SONGS).collect()).unwrap_or_default()
}

/// The person's playlists from their library page: id and name.
fn playlists(page: &Value) -> Vec<(String, String)> {
    let mut seen = std::collections::HashSet::new();
    page["entries"].as_array().map(|entries| entries.iter().filter_map(|entry| {
        let id = playlist_id(&entry["id"])?;
        if !seen.insert(id.clone()) { return None; }
        let name = clean(&entry["title"], 120);
        Some((id, if name.is_empty() { "YouTube playlist".into() } else { name }))
    }).take(MAX_PLAYLISTS).collect()).unwrap_or_default()
}

/// Joins liked songs and the playlists into one import: a song in several lists appears once, and a liked song
/// stays liked wherever else it appears.
fn library(liked: &Value, lists: Vec<(String, Value)>, failed: usize) -> Value {
    let mut entries: Vec<Value> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut groups = Vec::new();
    let mut add = |rows: Vec<Value>, liked: bool| -> Vec<Value> {
        rows.into_iter().map(|mut row| {
            let key = row["key"].as_str().unwrap_or("").to_owned();
            match index.get(&key) {
                Some(&at) => { if liked { entries[at]["liked"] = json!(true); } }
                None => { row["liked"] = json!(liked); index.insert(key.clone(), entries.len()); entries.push(row); }
            }
            json!(key)
        }).collect()
    };
    let liked_keys = add(songs(liked), true);
    if !liked_keys.is_empty() { groups.push(json!({"name": "Liked music", "keys": liked_keys})); }
    for (name, list) in lists {
        let keys = add(songs(&list), false);
        if !keys.is_empty() { groups.push(json!({"name": name, "keys": keys})); }
    }
    let warnings: Vec<&str> = if failed > 0 { vec![PARTIAL] } else { vec![] };
    json!({"source": "youtube", "name": "My YouTube Music library", "origin": "account", "entries": entries, "playlists": groups, "warnings": warnings,
        "completeness": if failed > 0 { "unknown" } else { "complete" }})
}

fn read(url: &str, session: &Path, limit: usize) -> Result<Value, String> {
    let exe = crate::binary("yt-dlp")?;
    let mut command = crate::ytdlp_command(&exe);
    command.arg("--cookies").arg(session)
        .args(["--ignore-config", "--no-plugin-dirs", "--flat-playlist", "--dump-single-json", "--no-warnings", "--no-colors",
            "--socket-timeout", "15", "--extractor-retries", "1", "--playlist-end", &limit.to_string(), "--", url]);
    let output = crate::engine_update::json_output(&mut command, Duration::from_secs(150)).map_err(|_| UNAVAILABLE)?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        return Err(if error.contains("429") { "Music catalog is temporarily rate-limited. Try again later." } else if error.contains("sign in") || error.contains("login") { NO_SIGN_IN } else { UNAVAILABLE }.into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| UNAVAILABLE.into())
}

// Lists read at the same time: each is its own yt-dlp process; three keep the account well inside YouTube's limits.
const PARALLEL: usize = 3;

fn read_library(session: &Path) -> Result<Value, String> {
    static ACTIVE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = ACTIVE.try_lock().map_err(|_| BUSY)?;
    // Liked songs and the list of playlists are fetched together.
    let (liked, page) = std::thread::scope(|scope| {
        let liked = scope.spawn(|| read("https://www.youtube.com/playlist?list=LM", session, MAX_SONGS));
        let page = read("https://www.youtube.com/feed/playlists", session, MAX_PLAYLISTS);
        (liked.join().unwrap_or_else(|_| Err(UNAVAILABLE.into())), page)
    });
    let liked = liked?;
    let found = page.as_ref().map(playlists).unwrap_or_default();
    let mut failed = usize::from(page.is_err());
    let results: Vec<std::sync::Mutex<Option<Result<Value, String>>>> = found.iter().map(|_| std::sync::Mutex::new(None)).collect();
    let next = std::sync::atomic::AtomicUsize::new(0);
    let limited = std::sync::atomic::AtomicBool::new(false);
    std::thread::scope(|scope| {
        for _ in 0..PARALLEL.min(found.len()) {
            scope.spawn(|| loop {
                use std::sync::atomic::Ordering;
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= found.len() || limited.load(Ordering::Relaxed) { break; }
                let id = &found[index].0;
                // A Mix never ends; like a Mix imported by link, it keeps its first hundred songs.
                let limit = if id.starts_with("RD") { 100 } else { MAX_SONGS };
                let result = read(&list_url(id), session, limit);
                if result.as_ref().is_err_and(|e| e.contains("rate-limited")) { limited.store(true, Ordering::Relaxed); }
                *results[index].lock().unwrap() = Some(result);
                // A short pause between lists of one reader keeps the account clear of request limits.
                std::thread::sleep(Duration::from_millis(250));
            });
        }
    });
    // In the order of the library page, whatever order they finished in.
    let mut lists = Vec::new();
    for ((_, name), slot) in found.into_iter().zip(results) {
        match slot.into_inner().unwrap() {
            Some(Ok(list)) => lists.push((name, list)),
            _ => failed += 1,
        }
    }
    let result = library(&liked, lists, failed);
    if result["entries"].as_array().is_none_or(|e| e.is_empty()) { return Err("No importable music was found.".into()); }
    Ok(result)
}

#[tauri::command]
pub async fn music_import_youtube_account(window: tauri::WebviewWindow) -> Result<Value, String> {
    if window.label() != "main" { return Err("Music import is only available in the main window.".into()); }
    let session = crate::music::account_session().ok_or(NO_SIGN_IN)?;
    tauri::async_runtime::spawn_blocking(move || read_library(&session)).await.map_err(|_| UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn songs_keep_order_drop_repeats_and_name_the_artist() {
        let list = json!({"entries": [
            {"id": "dQw4w9WgXcQ", "title": "Never Gonna Give You Up", "channel": "Rick Astley - Topic", "thumbnails": [{"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"}]},
            {"id": "dQw4w9WgXcQ", "title": "Again", "channel": "Rick Astley"},
            {"id": "bad", "title": "Not a video"},
            {"id": "9bZkp7q19f0", "title": "", "channel": "PSY"},
            {"id": "kJQP7kiw5Fk", "title": "Despacito", "uploader": "Luis Fonsi", "thumbnails": [{"url": "http://evil.example/x.jpg"}]}
        ]});
        let rows = songs(&list);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["videoId"], "dQw4w9WgXcQ");
        assert_eq!(rows[0]["artists"][0], "Rick Astley");
        assert_eq!(rows[0]["image"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
        assert_eq!(rows[1]["key"], "youtube:kJQP7kiw5Fk");
        assert!(rows[1]["image"].is_null());
    }

    #[test]
    fn a_saved_mix_is_read_from_its_first_song() {
        assert_eq!(list_url("RDdQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ");
        assert_eq!(list_url("PLabc_DEF-123"), "https://www.youtube.com/playlist?list=PLabc_DEF-123");
        assert_eq!(list_url("RDCLAK5uy_long-album-radio-id"), "https://www.youtube.com/playlist?list=RDCLAK5uy_long-album-radio-id");
    }

    #[test]
    fn playlists_skip_system_lists_and_bad_ids() {
        let page = json!({"entries": [
            {"id": "LL", "title": "Liked videos"}, {"id": "WL", "title": "Watch later"},
            {"id": "PLabc_DEF-123", "title": "Road trip"}, {"id": "PLabc_DEF-123", "title": "Road trip"},
            {"id": "../etc", "title": "Bad"}, {"id": "PLxyz", "title": ""}
        ]});
        assert_eq!(playlists(&page), vec![("PLabc_DEF-123".to_string(), "Road trip".to_string()), ("PLxyz".to_string(), "YouTube playlist".to_string())]);
    }

    #[test]
    fn a_liked_song_stays_liked_in_every_playlist_and_appears_once() {
        let liked = json!({"entries": [{"id": "dQw4w9WgXcQ", "title": "Song A", "channel": "A"}]});
        let road = json!({"entries": [{"id": "kJQP7kiw5Fk", "title": "Song B", "channel": "B"}, {"id": "dQw4w9WgXcQ", "title": "Song A", "channel": "A"}]});
        let result = library(&liked, vec![("Road trip".into(), road), ("Empty".into(), json!({"entries": []}))], 0);
        let entries = result["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["liked"], true);
        assert_eq!(entries[1]["liked"], false);
        assert_eq!(result["playlists"].as_array().unwrap().len(), 2);
        assert_eq!(result["playlists"][0]["name"], "Liked music");
        assert_eq!(result["playlists"][1]["keys"], json!(["youtube:kJQP7kiw5Fk", "youtube:dQw4w9WgXcQ"]));
        assert_eq!(result["completeness"], "complete");
        assert_eq!(result["origin"], "account");
        let partial = library(&liked, vec![], 2);
        assert_eq!(partial["warnings"][0], PARTIAL);
        assert_eq!(partial["completeness"], "unknown");
    }

    #[test]
    #[ignore = "reads the signed-in YouTube library"]
    fn live_youtube_account_library() {
        let Some(path) = std::env::var_os("DEVILOAD_LIVE_YOUTUBE_SESSION") else { return; };
        let result = read_library(Path::new(&path)).unwrap();
        println!("entries={} playlists={} warnings={}", result["entries"].as_array().unwrap().len(), result["playlists"].as_array().unwrap().len(), result["warnings"]);
    }
}
