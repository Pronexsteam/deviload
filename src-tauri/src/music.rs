use reqwest::blocking::{Client, Response};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, io::Read, sync::{Arc, Mutex, OnceLock}, time::{Duration, Instant}};

const ORIGIN: &str = "https://music.youtube.com";
const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CATALOG_ERROR: &str = "Music is unavailable right now. Check your connection and try again.";
static VERSION: OnceLock<Mutex<Option<(Instant, String)>>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    kind: String,
    title: String,
    subtitle: String,
    artists: Vec<String>,
    image: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Section { title: String, items: Vec<Item> }

#[derive(Clone, Debug, Serialize)]
pub struct Catalog { sections: Vec<Section> }

fn bounded(response: Response) -> Result<Vec<u8>, String> {
    let response = response.error_for_status().map_err(|_| CATALOG_ERROR)?;
    let mut bytes = Vec::new();
    response.take(6 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| CATALOG_ERROR)?;
    if bytes.len() > 6 * 1024 * 1024 { return Err(CATALOG_ERROR.into()); }
    Ok(bytes)
}

fn client(proxy: &str) -> Result<Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = Client::builder().user_agent(AGENT).timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::limited(3));
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| CATALOG_ERROR)?); }
    builder.build().map_err(|_| CATALOG_ERROR.into())
}

fn client_version(client: &Client) -> Result<String, String> {
    let cache = VERSION.get_or_init(|| Mutex::new(None));
    if let Some((at, value)) = cache.lock().unwrap().as_ref() {
        if at.elapsed() < Duration::from_secs(3600) { return Ok(value.clone()); }
    }
    let bytes = bounded(client.get(ORIGIN).send().map_err(|_| CATALOG_ERROR)?)?;
    let text = String::from_utf8_lossy(&bytes);
    let version = text.split("\"INNERTUBE_CLIENT_VERSION\":\"").nth(1)
        .and_then(|tail| tail.split('"').next()).filter(|v| v.len() < 60 && !v.is_empty())
        .ok_or(CATALOG_ERROR)?.to_owned();
    *cache.lock().unwrap() = Some((Instant::now(), version.clone()));
    Ok(version)
}

fn text(value: &Value) -> String {
    value["simpleText"].as_str().map(str::to_owned).unwrap_or_else(||
        value["runs"].as_array().map(|runs| runs.iter().filter_map(|r| r["text"].as_str()).collect()).unwrap_or_default())
}

fn find<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map.get(key).or_else(|| map.values().find_map(|v| find(v, key))),
        Value::Array(values) => values.iter().find_map(|v| find(v, key)),
        _ => None,
    }
}

fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 160 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }
fn video_id(id: &str) -> bool { id.len() == 11 && valid_id(id) }

fn image(value: &Value) -> String {
    find(value, "thumbnails").and_then(Value::as_array).and_then(|items| items.last())
        .and_then(|v| v["url"].as_str()).filter(|raw| {
            url::Url::parse(raw).ok().is_some_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h|
                h == "i.ytimg.com" || h == "lh3.googleusercontent.com" || h == "yt3.googleusercontent.com"))
        }).unwrap_or("").to_owned()
}

fn artists(value: &Value) -> Vec<String> {
    let mut names = Vec::new();
    fn visit(value: &Value, names: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                if value["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str().is_some_and(|id| id.starts_with("UC")) {
                    if let Some(name) = value["text"].as_str().filter(|name| !name.is_empty()) {
                        if !names.iter().any(|n| n == name) { names.push(name.to_owned()); }
                    }
                }
                for item in map.values() { visit(item, names); }
            }
            Value::Array(items) => for item in items { visit(item, names); },
            _ => (),
        }
    }
    visit(value, &mut names);
    names.truncate(8);
    names
}

fn item(value: &Value) -> Option<Item> {
    let columns = value["flexColumns"].as_array();
    let title_value = if let Some(columns) = columns { &columns.first()?["musicResponsiveListItemFlexColumnRenderer"]["text"] } else { &value["title"] };
    let title = text(title_value);
    if title.is_empty() { return None; }
    let nav = value.get("navigationEndpoint").or_else(|| find(title_value, "navigationEndpoint"));
    let page_type = nav.and_then(|n| find(n, "pageType")).and_then(Value::as_str).unwrap_or("");
    if matches!(page_type, "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE" | "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE" | "MUSIC_PAGE_TYPE_USER_CHANNEL") { return None; }
    let browse = nav.and_then(|n| n["browseEndpoint"]["browseId"].as_str());
    let video = value["playlistItemData"]["videoId"].as_str()
        .or_else(|| nav.and_then(|n| n["watchEndpoint"]["videoId"].as_str()))
        .or_else(|| find(&value["overlay"], "videoId").and_then(Value::as_str))
        .or_else(|| find(&value["thumbnailOverlay"], "videoId").and_then(Value::as_str));
    let (id, kind) = if let Some(id) = browse.filter(|id| valid_id(id) && ["UC", "MPRE", "VL"].iter().any(|prefix| id.starts_with(prefix))) {
        (id, if id.starts_with("UC") { "artist" } else if id.starts_with("MPRE") { "album" } else { "playlist" })
    } else { (video.filter(|id| video_id(id))?, "song") };
    let subtitle = columns.map(|cols| cols.iter().skip(1).map(|v| text(&v["musicResponsiveListItemFlexColumnRenderer"]["text"]))
        .filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ")).unwrap_or_else(|| text(&value["subtitle"]));
    let byline = if columns.is_some() { &value["flexColumns"] } else { &value["subtitle"] };
    Some(Item { id: id.into(), kind: kind.into(), title, subtitle, artists: artists(byline), image: image(value) })
}

fn collect_items(value: &Value, items: &mut Vec<Item>) {
    if items.len() >= 100 { return; }
    match value {
        Value::Object(map) => for (key, v) in map {
            if matches!(key.as_str(), "musicCardShelfRenderer" | "musicTwoRowItemRenderer" | "musicResponsiveListItemRenderer" | "playlistPanelVideoRenderer") {
                let parsed = if key == "playlistPanelVideoRenderer" {
                    v["videoId"].as_str().filter(|id| video_id(id)).map(|id| Item { id: id.into(), kind: "song".into(),
                        title: text(&v["title"]), subtitle: text(&v["longBylineText"]), artists: artists(&v["longBylineText"]), image: image(v) })
                } else { item(v) };
                if let Some(item) = parsed { items.push(item); }
                if key == "musicCardShelfRenderer" { collect_items(&v["contents"], items); }
            } else if !matches!(key.as_str(), "menu" | "header" | "trackingParams") { collect_items(v, items); }
        },
        Value::Array(values) => for v in values { collect_items(v, items); },
        _ => (),
    }
}

fn unique(items: &mut Vec<Item>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert((item.kind.clone(), item.id.clone())));
}

fn shelves(value: &Value, sections: &mut Vec<Section>) {
    if sections.len() >= 10 { return; }
    match value {
        Value::Object(map) => for (key, v) in map {
            if key == "musicCarouselShelfRenderer" || key == "musicShelfRenderer" {
                let title = text(v.get("title").or_else(|| find(&v["header"], "title")).unwrap_or(&Value::Null));
                let mut items = Vec::new();
                collect_items(&v["contents"], &mut items);
                unique(&mut items);
                if !items.is_empty() { sections.push(Section { title, items }); }
            } else if !matches!(key.as_str(), "menu" | "header") { shelves(v, sections); }
        },
        Value::Array(values) => for v in values { shelves(v, sections); },
        _ => (),
    }
}

fn parse(value: &Value, grouped: bool) -> Catalog {
    let mut sections = Vec::new();
    if grouped { shelves(value, &mut sections); }
    if sections.is_empty() {
        let mut items = Vec::new();
        collect_items(value, &mut items);
        unique(&mut items);
        if !items.is_empty() { sections.push(Section { title: String::new(), items }); }
    }
    Catalog { sections }
}

pub fn catalog(kind: &str, value: &str, language: &str, proxy: &str) -> Result<Catalog, String> {
    let (endpoint, mut body) = match kind {
        "home" => ("browse", json!({"browseId":"FEmusic_home"})),
        "search" if !value.trim().is_empty() && value.chars().count() <= 120 => ("search", json!({"query":value.trim()})),
        "browse" if valid_id(value) && ["MPRE", "UC", "VL"].iter().any(|p| value.starts_with(p)) => ("browse", json!({"browseId":value})),
        "radio" if video_id(value) => ("next", json!({"videoId":value,"playlistId":format!("RDAMVM{value}"),"isAudioOnly":true})),
        _ => return Err("Invalid music request".into()),
    };
    let client = client(proxy)?;
    let version = client_version(&client)?;
    let language = if ["en", "ru", "es"].contains(&language) { language } else { "en" };
    body["context"] = json!({"client":{"clientName":"WEB_REMIX","clientVersion":version,"hl":language}});
    let response = client.post(format!("{ORIGIN}/youtubei/v1/{endpoint}?prettyPrint=false"))
        .header("Origin", ORIGIN).json(&body).send().map_err(|_| CATALOG_ERROR)?;
    let value: Value = serde_json::from_slice(&bounded(response)?).map_err(|_| CATALOG_ERROR)?;
    if value.get("error").is_some() { return Err(CATALOG_ERROR.into()); }
    Ok(parse(&value, kind == "home" || kind == "browse"))
}

#[tauri::command]
pub async fn music_catalog(kind: String, value: String, language: String, engine: tauri::State<'_, crate::Engine>) -> Result<Catalog, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || catalog(&kind, &value, &language, &proxy)).await.map_err(|_| CATALOG_ERROR.to_owned())?
}

#[derive(Serialize)]
pub struct Stream { url: String }

fn stream_error(stderr: &[u8]) -> &'static str {
    let error = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if error.contains("429") || error.contains("not a bot") {
        "YouTube is temporarily limiting playback. Try again later."
    } else if error.contains("sign in") || error.contains("private video") || error.contains("members-only") || error.contains("video unavailable") {
        "This track is unavailable for guest playback. Try another track."
    } else {
        "Could not play this track. Try another track or try again later."
    }
}

struct ResolveFailure { message: String, retry: bool }
impl From<&str> for ResolveFailure {
    fn from(message: &str) -> Self { Self { message: message.into(), retry: false } }
}
impl From<String> for ResolveFailure {
    fn from(message: String) -> Self { Self { message, retry: false } }
}

fn extraction_failure(stderr: &[u8]) -> ResolveFailure {
    let message = stream_error(stderr);
    let detail = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    // YouTube can return a session with no direct formats, then provide them
    // on a fresh resolution. Bound this to one retry; never retry account or
    // rate restrictions, or a video explicitly reported as unavailable.
    let retry = message == stream_error(b"unknown") && !detail.contains("video unavailable") &&
        ["requested format is not available", "http error 403", "http error 500", "http error 502", "http error 503", "http error 504", "connection reset"].iter().any(|part| detail.contains(part));
    ResolveFailure { message: message.into(), retry }
}

struct CachedStream { at: Instant, source: Arc<crate::music_audio::Source> }
#[derive(Default)]
struct Streams {
    entries: HashMap<(String, String), CachedStream>,
    limit: Arc<crate::music_audio::PlaybackLimit>,
    next_request: Option<Instant>,
}
static STREAMS: OnceLock<Mutex<Streams>> = OnceLock::new();
static FOREGROUND: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn stream(id: &str, proxy: &str, refresh: bool) -> Result<Stream, String> {
    stream_request(id, proxy, refresh, false)
}

pub fn stream_request(id: &str, proxy: &str, refresh: bool, preload: bool) -> Result<Stream, String> {
    if !video_id(id) { return Err("Invalid music request".into()); }
    use std::sync::atomic::Ordering;
    // A foreground selection cancels speculative extraction before waiting for
    // the shared cache. Playback transfers use their own locks and keep running.
    let generation = if preload { FOREGROUND.load(Ordering::SeqCst) } else { FOREGROUND.fetch_add(1, Ordering::SeqCst) + 1 };
    let cancelled = || preload && FOREGROUND.load(Ordering::SeqCst) != generation;
    // Serialize resolution and reuse verified sources. Rapid clicks must not
    // launch an unbounded number of extractors against the same service.
    let streams = STREAMS.get_or_init(|| Mutex::new(Streams::default()));
    let mut cache = if preload { streams.try_lock().map_err(|_| "Could not open this track")? } else { streams.lock().unwrap() };
    cache.entries.retain(|_, item| item.at.elapsed() < Duration::from_secs(300) && !item.source.failed());
    let key = (id.to_owned(), proxy.to_owned());
    if !refresh {
        if let Some(item) = cache.entries.get(&key) { return Ok(Stream { url: crate::music_audio::register(item.source.clone())? }); }
    }
    if cache.limit.active() {
        return Err(stream_error(b"429").into());
    }
    let deadline = Instant::now() + Duration::from_secs(40);
    for attempt in 0..2 {
        if let Some(next) = cache.next_request {
            while Instant::now() < next {
                if cancelled() { return Err("Could not open this track".into()); }
                std::thread::sleep(next.saturating_duration_since(Instant::now()).min(Duration::from_millis(50)));
            }
        }
        if cancelled() { return Err("Could not open this track".into()); }
        if cache.limit.active() { return Err(stream_error(b"429").into()); }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining < Duration::from_secs(5) { break; }
        cache.next_request = Some(Instant::now() + Duration::from_secs(5));
        let source = match resolve(id, proxy, remaining.min(Duration::from_secs(25)), cache.limit.clone(), &cancelled) {
            Ok(source) => Arc::new(source),
            Err(error) => {
                if error.message == stream_error(b"429") { cache.limit.note(None); }
                if error.retry && attempt == 0 && !cancelled() { continue; }
                return Err(error.message);
            }
        };
        // Renew a rejected signed URL once. A denied account/region or rate
        // limit is handled above and must never trigger a retry loop.
        if cancelled() { return Err("Could not open this track".into()); }
        if let Err(error) = source.verify(deadline.min(Instant::now() + Duration::from_secs(12))) {
            if error == crate::music_audio::SourceError::Limited {
                cache.limit.note(None);
                return Err(error.to_string());
            }
            if error == crate::music_audio::SourceError::Denied && attempt == 0 && !cancelled() { continue; }
            return Err(error.to_string());
        }
        let address = crate::music_audio::register(source.clone())?;
        if cache.entries.len() >= 12 {
            if let Some(oldest) = cache.entries.iter().max_by_key(|(_,item)| item.at.elapsed()).map(|(key,_)| key.clone()) { cache.entries.remove(&oldest); }
        }
        cache.entries.insert(key, CachedStream { at: Instant::now(), source });
        return Ok(Stream { url: address });
    }
    Err("Could not open this track".into())
}

fn resolve(id: &str, proxy: &str, timeout: Duration, limit: Arc<crate::music_audio::PlaybackLimit>, cancelled: &dyn Fn() -> bool) -> Result<crate::music_audio::Source, ResolveFailure> {
    let exe = crate::binary("yt-dlp")?;
    let deno = crate::binary("deno")?;
    let mut command = crate::ytdlp_command_with(&exe, proxy);
    command
        .args(["--js-runtimes", &format!("deno:{}", deno.display())])
        .args(["--extractor-args", "youtube:player_client=web_embedded;player_skip=webpage,initial_data"])
        // The relay verifies actual audio bytes. yt-dlp's separate format probe
        // duplicates that request and can discard a briefly unavailable URL.
        .args(["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--skip-download", "--dump-single-json", "--no-warnings", "--no-colors",
            "--socket-timeout", "10", "--retries", "0", "--extractor-retries", "0", "-f", "bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]"]);
    let output = crate::engine_update::json_output_cancellable(command.arg("--")
        .arg(format!("https://www.youtube.com/watch?v={id}")), timeout, cancelled)?;
    if !output.status.success() {
        return Err(extraction_failure(&output.stderr));
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|_| "Could not open this track")?;
    let raw = value["url"].as_str().ok_or("Could not open this track")?;
    let url = url::Url::parse(raw).map_err(|_| "Could not open this track")?;
    let size = value["filesize"].as_u64().or_else(|| url.query_pairs().find(|(key,_)| key == "clen").and_then(|(_,v)| v.parse().ok())).ok_or("Could not open this track")?;
    let mime = match value["ext"].as_str() { Some("m4a") => "audio/mp4", Some("webm") => "audio/webm", _ => return Err("Could not open this track".into()) };
    let agent = value["http_headers"]["User-Agent"].as_str().unwrap_or(AGENT);
    crate::music_audio::Source::new(url, size, mime, agent, proxy, limit).map_err(Into::into)
}

#[tauri::command]
pub async fn music_stream(id: String, refresh: Option<bool>, preload: Option<bool>, engine: tauri::State<'_, crate::Engine>) -> Result<Stream, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || stream_request(&id, &proxy, refresh.unwrap_or(false), preload.unwrap_or(false))).await.map_err(|_| "Could not open this track".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_keeps_album_navigation_and_deduplicates_tracks() {
        let album = json!({"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Album"}]},
            "navigationEndpoint":{"browseEndpoint":{"browseId":"MPREtest"}},
            "thumbnailOverlay":{"watchEndpoint":{"videoId":"abcdefghijk"}}}});
        let song = json!({"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"abcdefghijk"},
            "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Song"}]}}}],
            "thumbnail":{"thumbnails":[{"url":"https://untrusted.example/a.jpg"}]}}});
        let parsed = parse(&json!({"contents":[album,song.clone(),song]}), false);
        assert_eq!(parsed.sections[0].items.len(), 2);
        assert_eq!(parsed.sections[0].items[0].kind, "album");
        assert_eq!(parsed.sections[0].items[1].image, "");
    }

    #[test]
    fn invalid_music_requests_do_not_reach_the_network() {
        assert!(catalog("browse", "https://localhost", "en", "").is_err());
        assert!(catalog("search", "", "en", "").is_err());
        assert!(stream("--exec=bad", "", false).is_err());
    }

    #[test]
    fn playback_errors_distinguish_rate_limits_from_unavailable_tracks() {
        assert!(stream_error(b"HTTP Error 429").contains("temporarily limiting"));
        assert!(stream_error(b"Sign in to confirm you're not a bot").contains("temporarily limiting"));
        assert!(stream_error(b"Private video").contains("guest playback"));
        assert!(stream_error(b"Video unavailable").contains("guest playback"));
        assert!(stream_error(b"Network error").contains("Could not play"));
    }

    #[test]
    fn extraction_retries_transient_formats_without_retrying_access_restrictions() {
        for error in ["Requested format is not available", "Unable to download API page: HTTP Error 503", "HTTP Error 403"] {
            assert!(extraction_failure(error.as_bytes()).retry);
        }
        for error in ["HTTP Error 429", "Sign in to confirm you're not a bot", "Private video", "Video unavailable", "Sign in to confirm your age", "members-only"] {
            assert!(!extraction_failure(error.as_bytes()).retry);
        }
    }

    #[test]
    fn search_keeps_the_featured_artist_and_skips_non_music_pages() {
        let artist = json!({"musicCardShelfRenderer":{"title":{"runs":[{"text":"Artist", "navigationEndpoint":{"browseEndpoint":{"browseId":"UCartist"}}}]}}});
        let podcast = json!({"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Podcast"}]}, "navigationEndpoint":{"browseEndpoint":{"browseId":"MPEDtest", "pageType":"MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE"}},"overlay":{"videoId":"abcdefghijk"}}});
        let parsed = parse(&json!([artist,podcast]), false);
        assert_eq!(parsed.sections[0].items.len(), 1);
        assert_eq!(parsed.sections[0].items[0].kind, "artist");
    }

    #[test]
    #[ignore = "live guest YouTube Music check"]
    fn live_guest_catalog() {
        if std::env::var_os("DEVILOAD_LIVE_MUSIC_TEST").is_none() { return; }
        let home = catalog("home", "", "en", "").unwrap();
        assert!(!home.sections.is_empty());
        let search = catalog("search", "Massive Attack", "en", "").unwrap();
        assert!(search.sections.iter().flat_map(|s| &s.items).any(|i| i.kind == "song"));
        assert!(search.sections.iter().flat_map(|s| &s.items).any(|i| i.title == "Massive Attack" && i.kind == "artist"));
        let album = home.sections.iter().flat_map(|s| &s.items).find(|i| i.kind == "album").unwrap();
        let album = catalog("browse", &album.id, "en", "").unwrap();
        assert!(album.sections.iter().flat_map(|s| &s.items).any(|i| i.kind == "song"));
        if let Ok(folder) = std::env::var("DEVILOAD_MUSIC_PROBE_DIR") {
            std::fs::create_dir_all(&folder).unwrap();
            for (name, data) in [("home", &home), ("search", &search), ("album", &album)] {
                std::fs::write(std::path::Path::new(&folder).join(format!("{name}.json")), serde_json::to_vec(data).unwrap()).unwrap();
            }
        }
    }

    #[test]
    #[ignore = "live anonymous playback check"]
    fn live_guest_playback() {
        if std::env::var_os("DEVILOAD_LIVE_MUSIC_TEST").is_none() { return; }
        let search = catalog("search", "Massive Attack Teardrop", "en", "").unwrap();
        let tracks: Vec<_> = search.sections.iter().flat_map(|s| &s.items).filter(|i| i.kind == "song").take(2).collect();
        assert_eq!(tracks.len(),2);
        let client = Client::builder().no_proxy().build().unwrap();
        for track in tracks {
            let stream = stream(&track.id, "", false).unwrap();
            for range in ["bytes=0-1023","bytes=-1024"] {
                let response = client.get(&stream.url).header("Range", range).send().unwrap();
                assert_eq!(response.status(),206,"audio server rejected the stream");
                assert_eq!(response.bytes().unwrap().len(),1024);
            }
        }
    }
}
