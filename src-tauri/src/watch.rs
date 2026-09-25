// Watched channels and playlists: new entries are queued as ordinary downloads.
// An artist is watched through the Releases tab of their channel: every album, EP
// or single there is a playlist, downloaded whole into an artist / album folder.
use crate::{binary, model::{self, Options}, now_seconds, queue_urls, save, ytdlp_command, Engine};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::{Path, PathBuf}, process::Stdio, sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager};

pub const CHECK_EVERY: u64 = 6 * 3600;
const MAX_WATCHES: usize = 50;
const MAX_SEEN: usize = 3000;
// One check looks at the newest entries only; more than this at once is a flood, not an update.
const MAX_NEW_PER_CHECK: usize = 20;
// Releases looked at when an artist is added and the albums already out are wanted.
const MAX_DISCOGRAPHY: usize = 100;

static WATCH_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watch {
    pub id: u64,
    pub url: String,
    pub title: String,
    pub options: Options,
    #[serde(default)]
    pub seen: Vec<String>,
    #[serde(default)]
    pub checked_at: u64,
    #[serde(default)]
    pub queued: u64,
    #[serde(default)]
    pub error: String,
    // "" for a channel or playlist, "artist" for an artist's releases.
    #[serde(default)]
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchView { id: u64, url: String, title: String, quality: String, checked_at: u64, queued: u64, error: String, kind: String }

impl From<&Watch> for WatchView {
    fn from(w: &Watch) -> Self {
        Self { id: w.id, url: w.url.clone(), title: w.title.clone(), quality: w.options.quality.clone(),
            checked_at: w.checked_at, queued: w.queued, error: w.error.clone(), kind: w.kind.clone() }
    }
}

#[derive(Debug, PartialEq)]
pub struct Entry { pub key: String, pub url: String }

fn watch_file(dir: &Path) -> PathBuf { dir.join("watches.json") }

pub fn load(dir: &Path) -> Vec<Watch> {
    fs::read(watch_file(dir)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn store(dir: &Path, watches: &[Watch]) -> Result<(), String> {
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(&serde_json::to_vec_pretty(watches).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(watch_file(dir)).map_err(|e| e.to_string())?;
    Ok(())
}

// A YouTube channel page lists tabs; its Videos tab lists uploads newest first.
pub fn watch_address(url: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(url) else { return url.into() };
    let host = parsed.host_str().unwrap_or("").trim_start_matches("www.").trim_start_matches("m.").to_owned();
    let parts: Vec<String> = parsed.path().trim_matches('/').split('/').map(str::to_owned).collect();
    let channel = host == "youtube.com" && match parts.as_slice() {
        [handle] => handle.starts_with('@'),
        [kind, _] => ["channel", "c", "user"].contains(&kind.as_str()),
        _ => false,
    };
    if !channel { return url.into(); }
    parsed.set_path(&format!("/{}/videos", parts.join("/")));
    parsed.set_query(None);
    parsed.to_string()
}

// An artist's channel on YouTube or YouTube Music, pointed at its Releases tab.
fn not_artist<T>() -> Result<T, String> { Err("Give a link to the artist's channel on YouTube or YouTube Music".into()) }

pub fn artist_address(url: &str) -> Result<String, String> {
    let mut parsed = url::Url::parse(url).or_else(|_| not_artist())?;
    let host = parsed.host_str().unwrap_or("").trim_start_matches("www.").trim_start_matches("m.").to_owned();
    if !["youtube.com", "music.youtube.com"].contains(&host.as_str()) { return not_artist(); }
    let parts: Vec<String> = parsed.path().trim_matches('/').split('/').map(str::to_owned).collect();
    let channel = match parts.as_slice() {
        [handle, ..] if handle.starts_with('@') => handle.clone(),
        [kind, name, ..] if ["channel", "c", "user"].contains(&kind.as_str()) => format!("{kind}/{name}"),
        _ => return not_artist(),
    };
    parsed.set_host(Some("www.youtube.com")).or_else(|_| not_artist())?;
    parsed.set_path(&format!("/{channel}/releases"));
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok(parsed.to_string())
}

pub fn parse_entries(info: &serde_json::Value) -> (String, Vec<Entry>) {
    let title = ["title", "channel", "uploader"].iter().find_map(|key| info[*key].as_str())
        .unwrap_or("").chars().take(160).collect();
    let entries = info["entries"].as_array().into_iter().flatten().filter_map(|item| {
        // Nested lists are channel tabs, not videos.
        if item.is_null() || item["_type"].as_str() == Some("playlist") { return None; }
        let url = ["url", "webpage_url"].iter().filter_map(|key| item[*key].as_str())
            .find(|value| value.starts_with("http://") || value.starts_with("https://"))?;
        let url = model::parse_urls(url).ok()?.into_iter().next()?;
        let key = item["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 100).map_or_else(|| url.clone(), str::to_owned);
        Some(Entry { key, url })
    }).collect();
    (title, entries)
}

fn fetch(url: &str, options: &Options, limit: usize) -> Result<serde_json::Value, String> {
    let exe = binary("yt-dlp")?;
    let mut cmd = ytdlp_command(&exe);
    cmd.args(["--ignore-config", "--flat-playlist", "--dump-single-json", "--skip-download",
        "--playlist-end", &limit.to_string(), "--no-warnings", "--no-colors"]);
    // Saved or private playlists need the same sign-in as their downloads.
    if !options.cookies.is_empty() && Path::new(&options.cookies).is_file() { cmd.args(["--cookies", &options.cookies]); }
    if !options.cookies_browser.is_empty() { cmd.args(["--cookies-from-browser", &options.cookies_browser]); }
    let output = cmd.arg("--").arg(url).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("").trim().to_owned();
        return Err(format!("Could not open the list: {}", detail.chars().take(240).collect::<String>()));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "yt-dlp returned an invalid playlist".to_string())
}

// Each entry downloads on its own, with the format picked when the list was added.
fn watch_options(mut options: Options) -> Options {
    options.playlist = false;
    options.playlist_items.clear();
    options.clip_start = None;
    options.clip_end = None;
    options.clip_format = "source".into();
    options.format_id.clear();
    options.format_has_audio = false;
    options
}

// Every release downloads as a whole album, as music, into artist / album folders.
fn artist_options(options: Options) -> Options {
    let mut options = watch_options(options);
    if !options.audio_only() { options.quality = "mp3".into(); }
    options.profile = "music".into();
    options.playlist = true;
    options.folder_rule = "server".into();
    options.archive = true;
    options
}

// Returns the watch and, when `backfill` is set, the releases that are already out, oldest first.
pub fn add(dir: &Path, url: &str, options: Options, artist: bool, backfill: bool) -> Result<(Watch, Vec<String>), String> {
    let urls = model::parse_urls(url)?;
    if urls.len() != 1 { return Err("Give a single channel or playlist link".into()); }
    let options = if artist { artist_options(options) } else { watch_options(options) };
    options.validate()?;
    let address = if artist { artist_address(&urls[0])? } else { watch_address(&urls[0]) };
    {
        let _guard = WATCH_LOCK.lock().unwrap();
        let watches = load(dir);
        if watches.len() >= MAX_WATCHES { return Err("No more than 50 watched lists".into()); }
        if watches.iter().any(|w| w.url == address) { return Err("This list is already watched".into()); }
    }
    let info = fetch(&address, &options, if artist && backfill { MAX_DISCOGRAPHY } else { 30 })?;
    let (title, entries) = parse_entries(&info);
    if entries.is_empty() && artist { return Err("This channel has no releases. Give the link of the artist's own channel".into()); }
    if entries.is_empty() { return Err("This link has no list of videos to watch".into()); }
    let _guard = WATCH_LOCK.lock().unwrap();
    let mut watches = load(dir);
    if watches.iter().any(|w| w.url == address) { return Err("This list is already watched".into()); }
    // What is there now counts as seen: only later additions download, unless the albums already out are wanted.
    let now: Vec<String> = if backfill && artist { entries.iter().rev().map(|entry| entry.url.clone()).collect() } else { vec![] };
    let title = if title.is_empty() { urls[0].clone() } else { title.trim_end_matches(" - Releases").to_owned() };
    let watch = Watch { id: watches.iter().map(|w| w.id).max().unwrap_or(0) + 1, url: address, title, options,
        seen: entries.into_iter().map(|entry| entry.key).collect(), checked_at: now_seconds(), queued: now.len() as u64,
        error: String::new(), kind: if artist { "artist".into() } else { String::new() } };
    watches.push(watch.clone());
    store(dir, &watches)?;
    Ok((watch, now))
}

// Returns the new entries in list order and remembers every key it saw.
pub fn take_new(watch: &mut Watch, entries: Vec<Entry>) -> Vec<Entry> {
    let known: HashSet<&String> = watch.seen.iter().collect();
    let mut fresh: Vec<Entry> = vec![];
    let mut keys: Vec<String> = vec![];
    for entry in entries {
        if !known.contains(&entry.key) && !fresh.iter().any(|seen| seen.key == entry.key) {
            keys.push(entry.key.clone());
            fresh.push(entry);
        }
    }
    keys.extend(watch.seen.drain(..));
    keys.truncate(MAX_SEEN);
    watch.seen = keys;
    fresh.truncate(MAX_NEW_PER_CHECK);
    fresh
}

pub fn check(engine: &Engine, id: u64) -> Result<(String, usize), String> {
    let watch = {
        let _guard = WATCH_LOCK.lock().unwrap();
        load(&engine.dir).into_iter().find(|w| w.id == id).ok_or("The list is not watched any more")?
    };
    let result = fetch(&watch.url, &watch.options, 30);
    let _guard = WATCH_LOCK.lock().unwrap();
    let mut watches = load(&engine.dir);
    let Some(current) = watches.iter_mut().find(|w| w.id == id) else { return Ok((watch.title, 0)) };
    current.checked_at = now_seconds();
    let info = match result {
        Ok(info) => info,
        Err(error) => {
            current.error = error.clone();
            store(&engine.dir, &watches)?;
            return Err(error);
        }
    };
    current.error.clear();
    let (_, entries) = parse_entries(&info);
    let fresh = take_new(current, entries);
    let mut count = 0;
    if !fresh.is_empty() {
        // Lists show the newest first; download the oldest of the new ones first.
        let urls = fresh.into_iter().rev().map(|entry| entry.url).collect();
        let mut d = engine.data.lock().unwrap();
        let old = d.clone();
        count = queue_urls(&mut d, urls, &current.options, None, true);
        if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    }
    current.queued += count as u64;
    let title = current.title.clone();
    store(&engine.dir, &watches)?;
    Ok((title, count))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Found { title: String, count: usize, artist: bool }

fn announce(app: &tauri::AppHandle, found: Option<(String, usize)>, artist: bool) {
    let _ = app.emit("watches-changed", ());
    if let Some((title, count)) = found.filter(|(_, count)| *count > 0) {
        let _ = app.emit("watch-found", Found { title, count, artist });
    }
}

// Checks the lists that are due, one at a time, while the app runs.
pub fn start(app: tauri::AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(60));
        loop {
            let engine = app.state::<Engine>().inner().clone();
            if engine.shutdown.load(std::sync::atomic::Ordering::Relaxed) { break; }
            let due: Vec<(u64, bool)> = {
                let _guard = WATCH_LOCK.lock().unwrap();
                load(&engine.dir).iter().filter(|w| now_seconds().saturating_sub(w.checked_at) >= CHECK_EVERY).map(|w| (w.id, w.kind == "artist")).collect()
            };
            for (id, artist) in due {
                if engine.shutdown.load(std::sync::atomic::Ordering::Relaxed) { return; }
                let found = check(&engine, id).ok();
                announce(&app, found, artist);
            }
            thread::sleep(Duration::from_secs(300));
        }
    });
}

#[tauri::command]
pub fn watch_list(engine: tauri::State<Engine>) -> Vec<WatchView> {
    let _guard = WATCH_LOCK.lock().unwrap();
    load(&engine.dir).iter().map(WatchView::from).collect()
}

#[tauri::command]
pub async fn watch_add(url: String, options: Options, artist: Option<bool>, backfill: Option<bool>, engine: tauri::State<'_, Engine>, app: tauri::AppHandle) -> Result<WatchView, String> {
    let dir = engine.dir.clone();
    let (artist, backfill) = (artist.unwrap_or(false), backfill.unwrap_or(false));
    let (watch, now) = tauri::async_runtime::spawn_blocking(move || add(&dir, &url, options, artist, backfill)).await.map_err(|e| e.to_string())??;
    if !now.is_empty() {
        let mut d = engine.data.lock().unwrap();
        let old = d.clone();
        queue_urls(&mut d, now, &watch.options, None, true);
        if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    }
    announce(&app, None, artist);
    Ok(WatchView::from(&watch))
}

#[tauri::command]
pub fn watch_remove(id: u64, engine: tauri::State<Engine>, app: tauri::AppHandle) -> Result<(), String> {
    {
        let _guard = WATCH_LOCK.lock().unwrap();
        let mut watches = load(&engine.dir);
        watches.retain(|w| w.id != id);
        store(&engine.dir, &watches)?;
    }
    announce(&app, None, false);
    Ok(())
}

#[tauri::command]
pub async fn watch_check(id: u64, engine: tauri::State<'_, Engine>, app: tauri::AppHandle) -> Result<usize, String> {
    let engine = engine.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || check(&engine, id)).await.map_err(|e| e.to_string())?;
    announce(&app, None, false);
    result.map(|(_, count)| count)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(key: &str) -> Entry { Entry { key: key.into(), url: format!("https://www.youtube.com/watch?v={key}") } }

    #[test]
    fn channel_links_point_at_the_videos_tab() {
        assert_eq!(watch_address("https://www.youtube.com/@deviload"), "https://www.youtube.com/@deviload/videos");
        assert_eq!(watch_address("https://youtube.com/channel/UC123/"), "https://youtube.com/channel/UC123/videos");
        assert_eq!(watch_address("https://www.youtube.com/@deviload/shorts"), "https://www.youtube.com/@deviload/shorts");
        let list = "https://www.youtube.com/playlist?list=PL1";
        assert_eq!(watch_address(list), list);
    }

    #[test]
    fn entries_skip_tabs_and_invalid_links() {
        let info = serde_json::json!({"title": "Songs", "entries": [
            {"id": "a", "url": "https://www.youtube.com/watch?v=a"},
            {"_type": "playlist", "id": "tab", "url": "https://www.youtube.com/@x/shorts"},
            null,
            {"id": "b", "url": "b", "webpage_url": "https://www.youtube.com/watch?v=b"},
            {"id": "c", "url": "ftp://example.com/c"},
        ]});
        let (title, entries) = parse_entries(&info);
        assert_eq!(title, "Songs");
        assert_eq!(entries, vec![entry("a"), entry("b")]);
    }

    #[test]
    fn only_unseen_entries_are_new_and_seen_stays_bounded() {
        let mut watch = Watch { id: 1, url: String::new(), title: String::new(), options: Options::default(),
            seen: vec!["b".into(), "c".into()], checked_at: 0, queued: 0, error: String::new(), kind: String::new() };
        let fresh = take_new(&mut watch, vec![entry("a"), entry("b"), entry("a"), entry("c")]);
        assert_eq!(fresh, vec![entry("a")]);
        assert_eq!(watch.seen, ["a", "b", "c"]);
        assert!(take_new(&mut watch, vec![entry("a"), entry("b")]).is_empty());
        let many: Vec<Entry> = (0..40).map(|i| entry(&format!("n{i}"))).collect();
        assert_eq!(take_new(&mut watch, many).len(), MAX_NEW_PER_CHECK);
        watch.seen = (0..MAX_SEEN).map(|i| format!("old{i}")).collect();
        take_new(&mut watch, vec![entry("new")]);
        assert_eq!((watch.seen.len(), watch.seen[0].as_str()), (MAX_SEEN, "new"));
    }

    #[test]
    fn artists_are_followed_through_their_releases() {
        assert_eq!(artist_address("https://www.youtube.com/@Adele").unwrap(), "https://www.youtube.com/@Adele/releases");
        assert_eq!(artist_address("https://music.youtube.com/channel/UCsRM0YB_dabtEPGPTKo-gcw?feature=share").unwrap(),
            "https://www.youtube.com/channel/UCsRM0YB_dabtEPGPTKo-gcw/releases");
        assert_eq!(artist_address("https://youtube.com/@Adele/videos").unwrap(), "https://www.youtube.com/@Adele/releases");
        assert!(artist_address("https://www.youtube.com/watch?v=abc").is_err());
        assert!(artist_address("https://example.com/@Adele").is_err());
        // Releases are playlists: each one downloads whole, as music, into artist / album folders.
        let info = serde_json::json!({"title": "Adele - Releases", "entries": [
            {"_type": "url", "ie_key": "YoutubeTab", "id": "OLAK5uy_a", "url": "https://www.youtube.com/playlist?list=OLAK5uy_a"}]});
        assert_eq!(parse_entries(&info).1[0].url, "https://www.youtube.com/playlist?list=OLAK5uy_a");
        let options = artist_options(Options { quality: "1080".into(), ..Options::default() });
        assert_eq!((options.quality.as_str(), options.playlist, options.folder_rule.as_str()), ("mp3", true, "server"));
        assert!(options.validate().is_ok());
        assert_eq!(artist_options(Options { quality: "flac".into(), ..Options::default() }).quality, "flac");
    }

    #[test]
    fn watched_downloads_are_single_items() {
        let options = watch_options(Options { playlist: true, playlist_items: "1-5".into(), clip_start: Some(1.0),
            clip_end: Some(2.0), clip_format: "gif".into(), format_id: "137".into(), ..Options::default() });
        assert!(!options.playlist && options.playlist_items.is_empty() && options.clip_start.is_none());
        assert_eq!((options.clip_format.as_str(), options.format_id.as_str()), ("source", ""));
        assert!(options.validate().is_ok());
    }
}
