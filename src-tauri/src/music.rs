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
pub struct Catalog { sections: Vec<Section>, continuation: Option<String> }

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
    let continuation = find(value, "nextContinuationData").and_then(|v| v["continuation"].as_str())
        .or_else(|| find(value, "continuationCommand").and_then(|v| v["token"].as_str()))
        .filter(|v| v.len() <= 8192).map(str::to_owned);
    Catalog { sections, continuation }
}

pub fn catalog_page(kind: &str, value: &str, language: &str, proxy: &str, filter: &str, continuation: &str) -> Result<Catalog, String> {
    let (endpoint, mut body) = match kind {
        "home" => ("browse", json!({"browseId":"FEmusic_home"})),
        "search" if !value.trim().is_empty() && value.chars().count() <= 120 => ("search", json!({"query":value.trim()})),
        "browse" if valid_id(value) && ["MPRE", "UC", "VL"].iter().any(|p| value.starts_with(p)) => ("browse", json!({"browseId":value})),
        "radio" if video_id(value) => ("next", json!({"videoId":value,"playlistId":format!("RDAMVM{value}"),"isAudioOnly":true})),
        _ => return Err("Invalid music request".into()),
    };
    if continuation.len() > 8192 || continuation.chars().any(char::is_control) { return Err("Invalid music request".into()); }
    if kind == "search" {
        let code = match filter { "all" => None, "songs" => Some("II"), "albums" => Some("IY"), "artists" => Some("Ig"), _ => return Err("Invalid music request".into()) };
        if let Some(code) = code { body["params"] = json!(format!("EgWKAQ{code}AWoMEA4QChADEAQQCRAF")); }
    }
    let client = client(proxy)?;
    let version = client_version(&client)?;
    let language = if ["en", "ru", "es"].contains(&language) { language } else { "en" };
    body["context"] = json!({"client":{"clientName":"WEB_REMIX","clientVersion":version,"hl":language}});
    let mut address = url::Url::parse(&format!("{ORIGIN}/youtubei/v1/{endpoint}?prettyPrint=false")).map_err(|_| CATALOG_ERROR)?;
    if !continuation.is_empty() { address.query_pairs_mut().append_pair("continuation", continuation).append_pair("ctoken", continuation); }
    let request = client.post(address);
    let response = request.header("Origin", ORIGIN).json(&body).send().map_err(|_| CATALOG_ERROR)?;
    let value: Value = serde_json::from_slice(&bounded(response)?).map_err(|_| CATALOG_ERROR)?;
    if value.get("error").is_some() { return Err(CATALOG_ERROR.into()); }
    Ok(parse(&value, kind == "home" || kind == "browse"))
}

#[tauri::command]
pub async fn music_catalog(kind: String, value: String, language: String, filter: Option<String>, continuation: Option<String>, engine: tauri::State<'_, crate::Engine>) -> Result<Catalog, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || catalog_page(&kind, &value, &language, &proxy, filter.as_deref().unwrap_or("all"), continuation.as_deref().unwrap_or(""))).await.map_err(|_| CATALOG_ERROR.to_owned())?
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
static RESOLUTION: Mutex<()> = Mutex::new(());
static WARMED: OnceLock<()> = OnceLock::new();

pub fn prepare_engine() {
    crate::music_engine::prepare();
    WARMED.get_or_init(|| {
        // Warm executable pages before the first Play, without network traffic.
        for name in ["yt-dlp", "deno"] {
            if let Ok(exe) = crate::binary(name) {
                let _ = crate::engine_update::output(crate::command(&exe).arg("--version"), Duration::from_secs(15));
            }
        }
    });
}

#[tauri::command]
pub async fn music_prepare(engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    if crate::stored_proxy(&engine.dir).is_empty() { let _ = tauri::async_runtime::spawn_blocking(prepare_engine).await; }
    Ok(())
}
#[derive(Default)]
struct Selection { generation: u64, key: Option<(String, String)> }
impl Selection {
    fn select(&mut self, key: Option<(String, String)>) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.key = key;
        self.generation
    }
    fn cancelled(&self, generation: u64, key: &(String, String)) -> bool {
        self.generation != generation && self.key.as_ref() != Some(key)
    }
}
static SELECTION: OnceLock<Mutex<Selection>> = OnceLock::new();
fn selection() -> &'static Mutex<Selection> { SELECTION.get_or_init(|| Mutex::new(Selection::default())) }
fn reserve(id: &str, proxy: &str, preload: bool) -> u64 {
    let mut state = selection().lock().unwrap();
    if preload { state.generation } else { state.select(Some((id.into(), proxy.into()))) }
}

#[tauri::command]
pub fn music_cancel_stream() { let generation=selection().lock().unwrap().select(None); crate::music_engine::cancel(generation); }

pub fn stream(id: &str, proxy: &str, refresh: bool) -> Result<Stream, String> {
    stream_request(id, proxy, refresh, false)
}

pub fn stream_request(id: &str, proxy: &str, refresh: bool, preload: bool) -> Result<Stream, String> {
    if !video_id(id) { return Err("Invalid music request".into()); }
    stream_reserved(id, proxy, refresh, preload, reserve(id, proxy, preload))
}

fn stream_reserved(id: &str, proxy: &str, refresh: bool, preload: bool, generation: u64) -> Result<Stream, String> {
    let key = (id.to_owned(), proxy.to_owned());
    // The newest selection cancels stale foreground work as well as preloads.
    // Selecting the track already being prepared adopts that work instead.
    let cancelled = || selection().lock().unwrap().cancelled(generation, &key);
    if proxy.is_empty() && !cancelled() {
        match crate::music_engine::play(id, refresh, preload, generation, &cancelled) {
            Ok(url) if !cancelled() => return Ok(Stream { url }),
            Ok(_) => return Err("Cancelled".into()),
            Err(error) if cancelled() || preload || crate::music_engine::restricted_error(&error) || error.contains("Cancelled") => return Err(error),
            Err(_) => {}, // Bounded legacy path if the bundled worker is unavailable.
        }
    }
    let streams = STREAMS.get_or_init(|| Mutex::new(Streams::default()));
    // Cache hits must not wait behind a speculative network request. Only new
    // extraction is serialized; the cache mutex is never held across I/O.
    let cached = || {
        let mut cache=streams.lock().unwrap();
        cache.entries.retain(|_, item| item.source.reusable(item.at.elapsed()));
        if refresh { None } else { cache.entries.get(&key).map(|item|item.source.clone()) }
    };
    if cancelled() { return Err("Could not open this track".into()); }
    if let Some(source)=cached(){return Ok(Stream{url:crate::music_audio::register(source)?});}
    let deadline = Instant::now() + Duration::from_secs(35);
    let _resolution=loop {
        if let Ok(lock)=RESOLUTION.try_lock(){break lock;}
        if preload||cancelled()||Instant::now()>=deadline{return Err("Could not open this track".into());}
        std::thread::sleep(Duration::from_millis(20));
    };
    if cancelled() { return Err("Could not open this track".into()); }
    if let Some(source)=cached(){return Ok(Stream{url:crate::music_audio::register(source)?});}
    let limit=streams.lock().unwrap().limit.clone();
    if limit.active() {
        return Err(stream_error(b"429").into());
    }
    for attempt in 0..2 {
        let next_request=streams.lock().unwrap().next_request;
        if let Some(next) = next_request {
            // Background work remains conservative. A deliberate click waits
            // at most the one-second foreground spacing, not five seconds.
            let next=if preload{next}else{next-Duration::from_secs(4)};
            while Instant::now() < next {
                if cancelled() { return Err("Could not open this track".into()); }
                std::thread::sleep(next.saturating_duration_since(Instant::now()).min(Duration::from_millis(50)));
            }
        }
        if cancelled() { return Err("Could not open this track".into()); }
        if limit.active() { return Err(stream_error(b"429").into()); }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining < Duration::from_secs(5) { break; }
        streams.lock().unwrap().next_request = Some(Instant::now() + Duration::from_secs(5));
        #[cfg(debug_assertions)] let timing=Instant::now();
        let source = match resolve(id, proxy, remaining.min(Duration::from_secs(25)), limit.clone(), &cancelled) {
            Ok(source) => Arc::new(source),
            Err(error) => {
                if error.message == stream_error(b"429") { limit.note(None); }
                if error.retry && attempt == 0 && !cancelled() { continue; }
                return Err(error.message);
            }
        };
        #[cfg(debug_assertions)] eprintln!("Music source resolved in {} ms (attempt {})",timing.elapsed().as_millis(),attempt+1);
        // Renew a rejected signed URL once. A denied account/region or rate
        // limit is handled above and must never trigger a retry loop.
        if cancelled() { return Err("Could not open this track".into()); }
        #[cfg(debug_assertions)] let verified=Instant::now();
        if let Err(error) = source.verify_cancellable(deadline.min(Instant::now() + Duration::from_secs(12)), &cancelled) {
            if error == crate::music_audio::SourceError::Limited {
                limit.note(None);
                return Err(error.to_string());
            }
            if error == crate::music_audio::SourceError::Denied && attempt == 0 && !cancelled() { continue; }
            return Err(error.to_string());
        }
        if cancelled() { return Err("Could not open this track".into()); }
        #[cfg(debug_assertions)] eprintln!("Music first audio bytes verified in {} ms",verified.elapsed().as_millis());
        let address = crate::music_audio::register(source.clone())?;
        let mut cache=streams.lock().unwrap();
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
        .args(["--extractor-args", "youtube:player_client=web_embedded;player_skip=webpage,initial_data;skip=hls,dash"])
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
    crate::music_audio::Source::new(url, size, mime, agent, proxy, limit)
        .map(|source|source.with_availability(value["available_at"].as_u64())).map_err(Into::into)
}

pub(crate) fn reserve_audio(id: &str) -> Result<String, String> {
    if !video_id(id) { return Err("Invalid music request".into()); }
    let limit=STREAMS.get_or_init(||Mutex::new(Streams::default())).lock().unwrap().limit.clone();
    if limit.active(){return Err(stream_error(b"429").into());}
    // Pausing may finish the current buffer, but choosing another song cancels
    // an obsolete reserve extraction as well as the main worker request.
    let cancelled=||selection().lock().unwrap().key.as_ref().is_some_and(|(selected,_)|selected!=id);
    if cancelled(){return Err("Cancelled".into());}
    let source=resolve(id,"",Duration::from_secs(25),limit.clone(),&cancelled).map_err(|e|e.message)?;
    crate::music_audio::register(Arc::new(source))
}

#[tauri::command]
pub async fn music_stream(id: String, refresh: Option<bool>, preload: Option<bool>, engine: tauri::State<'_, crate::Engine>) -> Result<Stream, String> {
    if !video_id(&id) { return Err("Invalid music request".into()); }
    let proxy = crate::stored_proxy(&engine.dir);
    let preload = preload.unwrap_or(false);
    // Reserve priority before dispatching to the worker pool, whose start order
    // is not necessarily the order of commands from the player.
    let generation = reserve(&id, &proxy, preload);
    tauri::async_runtime::spawn_blocking(move || stream_reserved(&id, &proxy, refresh.unwrap_or(false), preload, generation)).await.map_err(|_| "Could not open this track".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn catalog(kind: &str, value: &str, language: &str, proxy: &str) -> Result<Catalog, String> {
        catalog_page(kind, value, language, proxy, "all", "")
    }
    #[test]
    fn music_catalog_continuations_are_bounded_and_filters_are_validated() {
        let parsed=parse(&json!({"continuationContents":{"musicShelfContinuation":{"contents":[],"continuations":[{"nextContinuationData":{"continuation":"next-page"}}]}}}),false);
        assert_eq!(parsed.continuation.as_deref(),Some("next-page"));
        assert!(catalog_page("search","artist","en","","uploads","").is_err());
        assert!(catalog_page("search","artist","en","","songs",&"x".repeat(8193)).is_err());
    }

    #[test]
    fn latest_selection_cancels_old_work_but_adopts_the_same_prepared_source() {
        let mut state = Selection::default();
        let a = ("abcdefghijk".into(), String::new());
        let b = ("lmnopqrstuv".into(), String::new());
        let prepared = state.generation;
        state.select(Some(a.clone()));
        assert!(!state.cancelled(prepared, &a));
        assert!(state.cancelled(prepared, &b));
        let playing = state.generation;
        state.select(Some(b.clone()));
        assert!(state.cancelled(playing, &a));
        state.select(None);
        assert!(state.cancelled(prepared, &a));
        assert!(state.cancelled(playing, &b));
    }

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
