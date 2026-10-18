//! Optional public discovery. No accounts, credentials, listens, or playback URLs.
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, io::Read, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

const ERROR: &str = "Music discovery is unavailable right now.";
const MAX_BODY: u64 = 1024 * 1024;
const MAX_RECORDINGS: usize = 12;
const MAX_CACHE: usize = 64;
const BUDGET: Duration = Duration::from_secs(18);
const TAGS: &[&str] = &["pop", "rock", "electronic", "jazz", "ambient", "classical", "instrumental", "hip hop", "phonk", "metal", "folk", "soul", "r&b", "dance"];
static RUNTIME: OnceLock<Mutex<State>> = OnceLock::new();
static EPOCH: OnceLock<Instant> = OnceLock::new();

#[derive(Clone, Debug, Default, Serialize)]
pub struct Discovery {
    pub recordings: Vec<Recording>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub retryable: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Recording {
    pub mbid: String,
    pub title: String,
    pub artists: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

struct Cached { value: Option<Value>, expires: Duration, touched: Duration }
#[derive(Default)]
struct State {
    cache: HashMap<String, Cached>,
    next: HashMap<String, Duration>,
    retryable: bool,
}
struct Reply { status: u16, retry_after: Option<u64>, remaining: Option<u64>, reset_in: Option<u64>, bytes: Vec<u8> }
trait Transport {
    fn now(&self) -> Duration;
    fn wait(&self, duration: Duration);
    fn get(&self, address: &url::Url, timeout: Duration) -> Result<Reply, String>;
}
struct Http { client: Client }
impl Transport for Http {
    fn now(&self) -> Duration { EPOCH.get_or_init(Instant::now).elapsed() }
    fn wait(&self, duration: Duration) { std::thread::sleep(duration); }
    fn get(&self, address: &url::Url, timeout: Duration) -> Result<Reply, String> {
        let response = self.client.get(address.clone()).timeout(timeout).send().map_err(|_| ERROR)?;
        let status = response.status().as_u16();
        let header = |key| response.headers().get(key).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
        let retry_after = header("retry-after");
        let remaining = header("x-ratelimit-remaining");
        let reset_in = header("x-ratelimit-reset-in");
        if response.content_length().is_some_and(|n| n > MAX_BODY) { return Err(ERROR.into()); }
        let mut bytes = Vec::new();
        response.take(MAX_BODY + 1).read_to_end(&mut bytes).map_err(|_| ERROR)?;
        if bytes.len() as u64 > MAX_BODY { return Err(ERROR.into()); }
        Ok(Reply { status, retry_after, remaining, reset_in, bytes })
    }
}

fn clean(value: &str, max: usize) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) { return None; }
    Some(value.split_whitespace().collect::<Vec<_>>().join(" "))
}
fn key(value: &str) -> String { value.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ") }
fn inputs(artists: &[String], tags: &[String]) -> (Vec<String>, Vec<String>) {
    let mut names: Vec<String> = Vec::new();
    for value in artists.iter().take(16).filter_map(|v| clean(v, 120)) {
        if !names.iter().any(|n| key(n) == key(&value)) { names.push(value); }
        if names.len() == 2 { break; }
    }
    let mut genres = Vec::new();
    for value in tags.iter().take(16).map(|v| key(v)).filter(|v| TAGS.contains(&v.as_str())) {
        if !genres.contains(&value) { genres.push(value); }
        if genres.len() == 2 { break; }
    }
    (names, genres)
}
fn mbid(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(i, b)| if [8, 13, 18, 23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() })
}
fn endpoint(host: &str, path: &str, params: &[(&str, String)]) -> url::Url {
    let mut address = url::Url::parse(&format!("https://{host}{path}")).expect("fixed discovery URL");
    for (name, value) in params { address.query_pairs_mut().append_pair(name, value); }
    address
}
fn allowed(address: &url::Url) -> bool {
    address.scheme() == "https" && address.username().is_empty() && address.password().is_none() && address.port().is_none()
        && match address.host_str() {
            Some("musicbrainz.org") => ["/ws/2/artist/", "/ws/2/recording/"].contains(&address.path()),
            Some("api.listenbrainz.org") => address.path() == "/1/lb-radio/tags" || address.path().strip_prefix("/1/lb-radio/artist/").is_some_and(mbid),
            _ => false,
        }
}
fn valid_json(address: &url::Url, value: &Value) -> bool {
    if value.get("error").is_some() { return false; }
    match address.path() {
        "/ws/2/artist/" => value["artists"].is_array(),
        "/ws/2/recording/" => value["recordings"].is_array(),
        "/1/lb-radio/tags" => value.is_array(),
        _ => value.as_object().is_some_and(|map| map.iter().all(|(id, rows)| mbid(id) && rows.is_array())),
    }
}
fn fetch<T: Transport>(state: &mut State, transport: &T, address: url::Url, deadline: Duration) -> Option<Value> {
    if !allowed(&address) { return None; }
    let now = transport.now();
    let cache_key = address.as_str().to_owned();
    if let Some(cached) = state.cache.get_mut(&cache_key) {
        if cached.expires > now { cached.touched = now; state.retryable |= cached.value.is_none(); return cached.value.clone(); }
    }
    let host = address.host_str()?.to_owned();
    let next = *state.next.get(&host).unwrap_or(&now);
    // Do not park a worker through a service backoff or enqueue more work.
    if next > now + Duration::from_secs(1) || next >= deadline { state.retryable = true; return None; }
    if next > now { transport.wait(next - now); }
    let now = transport.now();
    if now >= deadline { state.retryable = true; return None; }
    state.next.insert(host.clone(), now + Duration::from_secs(1));
    let response = transport.get(&address, (deadline - now).min(Duration::from_secs(8)));
    let mut ttl = Duration::from_secs(60);
    let value = match response {
        Ok(reply) => {
            let after = transport.now();
            if reply.status == 429 || reply.status == 503 || reply.remaining == Some(0) {
                let seconds = reply.retry_after.or(reply.reset_in).unwrap_or(60).clamp(1, 3600);
                state.next.insert(host, after + Duration::from_secs(seconds));
            }
            if reply.status == 200 && reply.bytes.len() as u64 <= MAX_BODY {
                serde_json::from_slice::<Value>(&reply.bytes).ok().filter(|v| valid_json(&address, v))
            } else { None }
        }
        Err(_) => None,
    };
    if let Some(v) = &value {
        let empty = v.as_array().is_some_and(Vec::is_empty) || ["artists", "recordings"].iter().any(|field| v[*field].as_array().is_some_and(Vec::is_empty))
            || address.path().starts_with("/1/lb-radio/artist/") && radio_ids(v).is_empty();
        ttl = Duration::from_secs(if empty { 600 } else { 86400 });
    } else { state.retryable = true; }
    if state.cache.len() >= MAX_CACHE && !state.cache.contains_key(&cache_key) {
        if let Some(oldest) = state.cache.iter().min_by_key(|(_, entry)| entry.touched).map(|(key, _)| key.clone()) { state.cache.remove(&oldest); }
    }
    let after = transport.now();
    state.cache.insert(cache_key, Cached { value: value.clone(), expires: after + ttl, touched: after });
    value
}
fn exact_artist(value: &Value, name: &str) -> Option<String> {
    let mut exact = value["artists"].as_array()?.iter().take(5).filter(|artist| {
        let score = artist["score"].as_u64().or_else(|| artist["score"].as_str()?.parse().ok()).unwrap_or(0);
        score >= 95 && artist["name"].as_str().is_some_and(|n| key(n) == key(name)) && artist["id"].as_str().is_some_and(mbid)
    }).map(|artist| artist["id"].as_str().unwrap().to_lowercase());
    let found = exact.next()?;
    exact.all(|id| id == found).then_some(found)
}
fn radio_ids(value: &Value) -> Vec<String> {
    fn visit(value: &Value, ids: &mut Vec<String>, depth: usize) {
        if depth > 5 || ids.len() >= MAX_RECORDINGS { return; }
        match value {
            Value::Object(map) => {
                if let Some(id) = map.get("recording_mbid").and_then(Value::as_str).filter(|id| mbid(id)) {
                    let id = id.to_lowercase(); if !ids.contains(&id) { ids.push(id); }
                }
                for child in map.values().take(32) { visit(child, ids, depth + 1); }
            }
            Value::Array(items) => for child in items.iter().take(64) { visit(child, ids, depth + 1); },
            _ => (),
        }
    }
    let mut ids = Vec::new(); visit(value, &mut ids, 0); ids
}
fn metadata(value: &Value, ids: &[String]) -> Vec<Recording> {
    let mut recordings = Vec::new();
    for item in value["recordings"].as_array().into_iter().flatten().take(24) {
        let Some(id) = item["id"].as_str().filter(|id| mbid(id)).map(str::to_lowercase) else { continue; };
        if !ids.contains(&id) || recordings.iter().any(|r: &Recording| r.mbid == id) { continue; }
        let Some(mut title) = item["title"].as_str().and_then(|v| clean(v, 240)) else { continue; };
        if let Some(comment) = item["disambiguation"].as_str().filter(|v| !v.trim().is_empty()) {
            let Some(comment) = clean(comment, 120) else { continue; };
            let words = key(&comment);
            if !["live", "remix", "remaster", "acoustic", "instrumental", "demo", "cover", "mono", "stereo", " edit", "edit ", "extended", "album version", "single version"].iter().any(|kind| words.contains(kind)) { continue; }
            title = format!("{title} ({comment})");
            if title.chars().count() > 240 { continue; }
        }
        let Some(credits) = item["artist-credit"].as_array().filter(|rows| !rows.is_empty() && rows.len() <= 4) else { continue; };
        let mut artists = Vec::new();
        let mut complete = true;
        for credit in credits {
            let name = credit["artist"]["name"].as_str().and_then(|v| clean(v, 120))
                .or_else(|| credit["name"].as_str().and_then(|v| clean(v, 120)));
            let Some(name) = name else { complete = false; break; };
            if !artists.contains(&name) { artists.push(name); }
        }
        if !complete || artists.is_empty() { continue; }
        let duration = item["length"].as_f64().filter(|v| v.is_finite() && *v > 0.0 && *v <= 86_400_000.0).map(|v| v / 1000.0);
        recordings.push(Recording { mbid: id, title, artists, duration });
        if recordings.len() == MAX_RECORDINGS { break; }
    }
    recordings.sort_by_key(|r| ids.iter().position(|id| id == &r.mbid).unwrap_or(MAX_RECORDINGS));
    recordings
}
fn discover_with<T: Transport>(state: &mut State, transport: &T, artists: &[String], tags: &[String]) -> Discovery {
    state.retryable = false;
    let (artists, tags) = inputs(artists, tags);
    let deadline = transport.now() + BUDGET;
    let mut lists = Vec::new();
    for name in artists {
        // Escape the complete Lucene phrase rather than allowing artist input to add fields/operators.
        let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
        let address = endpoint("musicbrainz.org", "/ws/2/artist/", &[("query", format!("artist:\"{escaped}\"")), ("fmt", "json".into()), ("limit", "5".into())]);
        let Some(artist) = fetch(state, transport, address, deadline).and_then(|v| exact_artist(&v, &name)) else { continue; };
        let address = endpoint("api.listenbrainz.org", &format!("/1/lb-radio/artist/{artist}"), &[("mode", "easy".into()), ("max_similar_artists", "2".into()), ("max_recordings_per_artist", "2".into()), ("pop_begin", "0".into()), ("pop_end", "100".into())]);
        if let Some(value) = fetch(state, transport, address, deadline) { lists.push(radio_ids(&value)); }
    }
    // Tags are a fallback, not extra network traffic when artist radio is available.
    if lists.iter().all(Vec::is_empty) && !tags.is_empty() {
        let mut params = vec![("operator", "OR".into()), ("count", "6".into()), ("pop_begin", "0".into()), ("pop_end", "100".into())];
        for tag in tags { params.push(("tag", tag)); }
        if let Some(value) = fetch(state, transport, endpoint("api.listenbrainz.org", "/1/lb-radio/tags", &params), deadline) { lists.push(radio_ids(&value)); }
    }
    let mut ids = Vec::new();
    for i in 0..MAX_RECORDINGS {
        for list in &lists { if let Some(id) = list.get(i) { if !ids.contains(id) && ids.len() < MAX_RECORDINGS { ids.push(id.clone()); } } }
    }
    if ids.is_empty() { return Discovery { recordings: Vec::new(), retryable: state.retryable }; }
    let query = ids.iter().map(|id| format!("rid:{id}")).collect::<Vec<_>>().join(" OR ");
    let address = endpoint("musicbrainz.org", "/ws/2/recording/", &[("query", query), ("fmt", "json".into()), ("limit", MAX_RECORDINGS.to_string())]);
    let recordings = fetch(state, transport, address, deadline).map(|value| metadata(&value, &ids)).unwrap_or_default();
    Discovery { recordings, retryable: state.retryable }
}

fn http(proxy: &str) -> Result<Http, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = Client::builder().user_agent(concat!("Deviload/", env!("CARGO_PKG_VERSION"), " (https://github.com/Pronexsteam/deviload)"))
        .timeout(Duration::from_secs(8)).connect_timeout(Duration::from_secs(3)).redirect(reqwest::redirect::Policy::none());
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| ERROR)?); }
    Ok(Http { client: builder.build().map_err(|_| ERROR)? })
}
pub fn discover(artists: &[String], tags: &[String], proxy: &str) -> Result<Discovery, String> {
    let (artists, tags) = inputs(artists, tags);
    if artists.is_empty() && tags.is_empty() { return Ok(Discovery::default()); }
    // All work happens in spawn_blocking. Contention drops optional enrichment immediately;
    // it cannot hold up playback or create an unbounded queue of discovery requests.
    let Ok(mut state) = RUNTIME.get_or_init(|| Mutex::new(State::default())).try_lock() else { return Ok(Discovery { recordings: Vec::new(), retryable: true }); };
    let transport = http(proxy)?;
    Ok(discover_with(&mut state, &transport, &artists, &tags))
}

#[tauri::command]
pub async fn music_discovery(artists: Vec<String>, tags: Vec<String>, engine: tauri::State<'_, crate::Engine>) -> Result<Discovery, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || discover(&artists, &tags, &proxy)).await.map_err(|_| ERROR.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{cell::{Cell, RefCell}, collections::VecDeque};

    const ARTIST: &str = "056e4f3e-d505-4dad-8ec1-d04f521cbb56";
    const SONG: &str = "2c718ee9-ad54-4016-ae43-e8df5ea1b4e1";
    const OTHER: &str = "1ab5cca0-b92f-4049-988e-bf6c887b51b3";
    struct Fake { clock: Cell<Duration>, lag: Cell<Duration>, replies: RefCell<VecDeque<Result<Reply, String>>>, calls: RefCell<Vec<(url::Url, Duration, Duration)>> }
    impl Fake {
        fn new(values: Vec<Value>) -> Self {
            Self { clock: Cell::new(Duration::ZERO), lag: Cell::new(Duration::ZERO), replies: RefCell::new(values.into_iter().map(|v| Ok(Reply { status: 200, retry_after: None, remaining: None, reset_in: None, bytes: serde_json::to_vec(&v).unwrap() })).collect()), calls: RefCell::new(Vec::new()) }
        }
    }
    impl Transport for Fake {
        fn now(&self) -> Duration { self.clock.get() }
        fn wait(&self, duration: Duration) { self.clock.set(self.clock.get() + duration); }
        fn get(&self, address: &url::Url, timeout: Duration) -> Result<Reply, String> {
            self.calls.borrow_mut().push((address.clone(), self.now(), timeout));
            self.wait(self.lag.get().min(timeout));
            if self.lag.get() > timeout { return Err(ERROR.into()); }
            self.replies.borrow_mut().pop_front().expect("unexpected network request")
        }
    }
    fn artist() -> Value { json!({"count":3,"artists":[{"id":ARTIST,"score":100,"name":"Daft Punk","disambiguation":"French electronic duo"},{"id":"80846e42-6bba-4fed-9d08-f095b15f28ec","score":66,"name":"Daft Punk NFT"}]}) }
    fn radio() -> Value {
        // Public /lb-radio/artist response captured 2026-10-18, unrelated fields omitted.
        json!({ARTIST:[{"recording_mbid":SONG,"similar_artist_mbid":ARTIST,"similar_artist_name":"Daft Punk","total_listen_count":69598}],"c8b03190-306c-4120-bb0b-6f2ebfc06ea9":[{"recording_mbid":OTHER,"similar_artist_mbid":"c8b03190-306c-4120-bb0b-6f2ebfc06ea9","similar_artist_name":"The Weeknd","total_listen_count":11}]})
    }
    fn recordings() -> Value {
        // Public MusicBrainz batch-search response captured 2026-10-18;
        // aliases/releases and other fields irrelevant to matching are omitted.
        json!({"count":2,"recordings":[{"id":SONG,"score":100,"title":"Touch","length":498000,"artist-credit":[{"joinphrase":" feat. ","name":"Daft Punk","artist":{"id":ARTIST,"name":"Daft Punk","sort-name":"Daft Punk"}},{"name":"Paul Williams","artist":{"id":"2307602e-a3ce-4f37-bb2b-d54f1980ed5f","name":"Paul Williams"}}]}, {"id":OTHER,"title":"Loft Music (slab'ed)","length":451004,"artist-credit":[{"name":"The Weeknd","artist":{"id":"c8b03190-306c-4120-bb0b-6f2ebfc06ea9","name":"The Weeknd"}}]}]})
    }
    fn tag_url() -> url::Url { endpoint("api.listenbrainz.org", "/1/lb-radio/tags", &[("tag", "jazz".into())]) }

    #[test]
    fn discovery_bounds_inputs_and_only_allows_known_genres() {
        let (names, tags) = inputs(&["  Daft   Punk  ".into(), "daft punk".into(), "x\nInjected".into(), "a".repeat(121), "Miles Davis".into(), "Third".into()], &["Jazz".into(), "private playlist name".into(), "r&b".into(), "rock".into()]);
        assert_eq!(names, ["Daft Punk", "Miles Davis"]);
        assert_eq!(tags, ["jazz", "r&b"]);
        assert_eq!(inputs(&[], &["https://other.example".into()]).1.len(), 0);
    }
    #[test]
    fn discovery_requires_unique_exact_canonical_artist() {
        assert_eq!(exact_artist(&artist(), "DAFT PUNK").as_deref(), Some(ARTIST));
        assert_eq!(exact_artist(&artist(), "Daft"), None);
        let mut ambiguous = artist();
        ambiguous["artists"].as_array_mut().unwrap().push(json!({"id":OTHER,"score":"100","name":"Daft Punk"}));
        assert_eq!(exact_artist(&ambiguous, "Daft Punk"), None);
        assert_eq!(exact_artist(&json!({"artists":[{"id":ARTIST,"score":94,"name":"Daft Punk"}]}), "Daft Punk"), None);
    }
    #[test]
    fn discovery_parses_actual_radio_shapes_and_caps_ids() {
        assert_eq!(radio_ids(&radio()), [SONG, OTHER]);
        // Public tag-radio shape captured 2026-10-18.
        assert_eq!(radio_ids(&json!([{"percent":99.9836333878887,"recording_mbid":"77b7cac3-e550-49e5-9e96-a13cc3d6a200","source":"release-group","tag_count":3}])), ["77b7cac3-e550-49e5-9e96-a13cc3d6a200"]);
        let records: Vec<_> = (0..30).map(|n| json!({"recording_mbid":format!("00000000-0000-4000-8000-{n:012}")})).collect();
        assert_eq!(radio_ids(&json!(records)).len(), MAX_RECORDINGS);
        assert!(radio_ids(&json!([{"recording_mbid":"https://other.example"}])).is_empty());
    }
    #[test]
    fn discovery_metadata_preserves_versions_and_rejects_unrelated_ids() {
        let mut value = recordings();
        value["recordings"][0]["disambiguation"] = json!("live at the BBC");
        let rows = metadata(&value, &[SONG.into()]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Touch (live at the BBC)");
        assert_eq!(rows[0].artists, ["Daft Punk", "Paul Williams"]);
        assert_eq!(rows[0].duration, Some(498.0));
        value["recordings"][0]["disambiguation"] = json!("unidentified take");
        assert!(metadata(&value, &[SONG.into()]).is_empty());
    }
    #[test]
    fn discovery_metadata_requires_title_artist_and_valid_duration_when_present() {
        let mut value = recordings();
        value["recordings"][0]["length"] = json!(-1);
        assert_eq!(metadata(&value, &[SONG.into()])[0].duration, None);
        value["recordings"][0]["title"] = json!("a".repeat(241));
        assert!(metadata(&value, &[SONG.into()]).is_empty());
        value["recordings"][0]["title"] = json!("Touch");
        value["recordings"][0]["artist-credit"] = json!([]);
        assert!(metadata(&value, &[SONG.into()]).is_empty());
    }
    #[test]
    fn discovery_metadata_never_drops_unrepresentable_or_excess_guest_credits() {
        let mut value = recordings();
        value["recordings"][0]["artist-credit"][1] = json!({"artist":{"name":"a".repeat(121)}});
        assert!(metadata(&value, &[SONG.into()]).is_empty());
        value["recordings"][0]["artist-credit"][1] = json!({"name":"Paul Williams","artist":{"name":"a".repeat(121)}});
        assert_eq!(metadata(&value, &[SONG.into()])[0].artists, ["Daft Punk", "Paul Williams"]);
        value["recordings"][0]["artist-credit"] = json!([{"artist":{"name":"Lead"}},{"artist":{"name":"Guest A"}},{"artist":{"name":"Guest B"}},{"artist":{"name":"Guest C"}},{"artist":{"name":"Guest D"}}]);
        assert!(metadata(&value, &[SONG.into()]).is_empty());
        value["recordings"][0]["artist-credit"] = json!([{"artist":{"name":"Lead"}}," feat. "]);
        assert!(metadata(&value, &[SONG.into()]).is_empty());
    }
    #[test]
    fn discovery_only_uses_fixed_https_public_endpoints() {
        assert!(allowed(&tag_url()));
        for raw in ["http://api.listenbrainz.org/1/lb-radio/tags", "https://evil.example/1/lb-radio/tags", "https://api.listenbrainz.org/1/submit-listens", "https://api.listenbrainz.org/1/metadata/lookup/", "https://musicbrainz.org/ws/2/url/", "https://user@musicbrainz.org/ws/2/artist/", "https://musicbrainz.org:444/ws/2/artist/"] {
            assert!(!allowed(&url::Url::parse(raw).unwrap()), "{raw}");
        }
    }
    #[test]
    fn discovery_batches_recordings_and_reuses_positive_cache() {
        let fake = Fake::new(vec![artist(), radio(), recordings()]);
        let mut state = State::default();
        let result = discover_with(&mut state, &fake, &["Daft Punk".into()], &["jazz".into()]);
        assert_eq!(result.recordings.len(), 2);
        assert!(!result.retryable);
        assert_eq!(fake.calls.borrow().len(), 3);
        let calls = fake.calls.borrow();
        assert!(calls[2].0.query_pairs().any(|(k, v)| k == "query" && v == format!("rid:{SONG} OR rid:{OTHER}")));
        assert_eq!(calls[2].1, Duration::from_secs(1));
        assert!(calls.iter().all(|(_, _, timeout)| *timeout <= Duration::from_secs(8)));
        drop(calls);
        let again = discover_with(&mut state, &fake, &["Daft Punk".into()], &[]);
        assert_eq!(again.recordings.len(), 2);
        assert_eq!(fake.calls.borrow().len(), 3);
    }
    #[test]
    fn discovery_tag_fallback_is_bounded_and_artist_input_cannot_inject_query_fields() {
        let fake = Fake::new(vec![json!({"artists":[]}), json!([{"recording_mbid":SONG}]), recordings()]);
        let result = discover_with(&mut State::default(), &fake, &["A\" OR artist:B".into()], &["jazz".into(), "pop".into(), "rock".into()]);
        assert_eq!(result.recordings.len(), 1);
        let calls = fake.calls.borrow();
        assert!(calls[0].0.query_pairs().any(|(k,v)| k == "query" && v == "artist:\"A\\\" OR artist:B\""));
        assert_eq!(calls[1].0.query_pairs().filter(|(k,_)| k == "tag").count(), 2);
        assert_eq!(calls.len(), 3);
    }
    #[test]
    fn discovery_negative_cache_expires_after_ten_minutes() {
        let fake = Fake::new(vec![json!([]), json!([])]);
        let mut state = State::default();
        let deadline = Duration::from_secs(2000);
        assert_eq!(fetch(&mut state, &fake, tag_url(), deadline), Some(json!([])));
        fake.clock.set(Duration::from_secs(599));
        fetch(&mut state, &fake, tag_url(), deadline);
        assert_eq!(fake.calls.borrow().len(), 1);
        fake.clock.set(Duration::from_secs(600));
        fetch(&mut state, &fake, tag_url(), deadline);
        assert_eq!(fake.calls.borrow().len(), 2);
    }
    #[test]
    fn discovery_positive_cache_expires_after_one_day() {
        let rows = json!([{"recording_mbid":SONG}]);
        let fake = Fake::new(vec![rows.clone(), rows.clone()]);
        let mut state = State::default();
        let deadline = Duration::from_secs(100000);
        assert_eq!(fetch(&mut state, &fake, tag_url(), deadline), Some(rows.clone()));
        fake.clock.set(Duration::from_secs(86399));
        fetch(&mut state, &fake, tag_url(), deadline);
        assert_eq!(fake.calls.borrow().len(), 1);
        fake.clock.set(Duration::from_secs(86400));
        assert_eq!(fetch(&mut state, &fake, tag_url(), deadline), Some(rows));
        assert_eq!(fake.calls.borrow().len(), 2);
    }
    #[test]
    fn discovery_total_request_budget_bounds_slow_services() {
        let fake = Fake::new(vec![artist(), radio(), recordings()]);
        fake.lag.set(Duration::from_secs(8));
        let result = discover_with(&mut State::default(), &fake, &["Daft Punk".into()], &["jazz".into()]);
        assert!(result.recordings.is_empty());
        assert!(result.retryable);
        assert_eq!(fake.now(), BUDGET);
        assert_eq!(fake.calls.borrow().len(), 3);
        assert_eq!(fake.calls.borrow()[2].2, Duration::from_secs(2));
    }
    #[test]
    fn discovery_failures_are_retryable_and_cached_for_one_minute() {
        let fake = Fake::new(vec![]);
        fake.replies.borrow_mut().extend([Err(ERROR.into()), Ok(Reply { status: 200, retry_after: None, remaining: None, reset_in: None, bytes: b"[]".to_vec() })]);
        let mut state = State::default();
        let deadline = Duration::from_secs(2000);
        assert!(fetch(&mut state, &fake, tag_url(), deadline).is_none());
        assert!(state.retryable);
        state.retryable = false;
        fake.clock.set(Duration::from_secs(59));
        assert!(fetch(&mut state, &fake, tag_url(), deadline).is_none());
        assert!(state.retryable);
        assert_eq!(fake.calls.borrow().len(), 1);
        fake.clock.set(Duration::from_secs(60));
        assert_eq!(fetch(&mut state, &fake, tag_url(), deadline), Some(json!([])));
        assert_eq!(fake.calls.borrow().len(), 2);
    }
    #[test]
    fn discovery_rate_limit_backoff_is_bounded_and_does_not_block_worker() {
        let fake = Fake::new(vec![]);
        fake.replies.borrow_mut().push_back(Ok(Reply { status: 429, retry_after: Some(999999), remaining: Some(0), reset_in: Some(2), bytes: b"{}".to_vec() }));
        let mut state = State::default();
        let deadline = Duration::from_secs(5000);
        assert!(fetch(&mut state, &fake, tag_url(), deadline).is_none());
        assert_eq!(state.next["api.listenbrainz.org"], Duration::from_secs(3600));
        let other = endpoint("api.listenbrainz.org", "/1/lb-radio/tags", &[("tag","pop".into())]);
        assert!(fetch(&mut state, &fake, other, deadline).is_none());
        assert_eq!(fake.now(), Duration::ZERO);
        assert_eq!(fake.calls.borrow().len(), 1);
    }
    #[test]
    fn discovery_response_caps_cache_size_and_rejects_oversized_or_invalid_json() {
        let fake = Fake::new(vec![]);
        fake.replies.borrow_mut().push_back(Ok(Reply { status: 200, retry_after: None, remaining: None, reset_in: None, bytes: vec![b' '; MAX_BODY as usize + 1] }));
        let mut state = State::default();
        assert!(fetch(&mut state, &fake, tag_url(), Duration::from_secs(100)).is_none());
        for n in 0..70 {
            fake.replies.borrow_mut().push_back(Ok(Reply { status: 200, retry_after: None, remaining: None, reset_in: None, bytes: b"[]".to_vec() }));
            let address = endpoint("musicbrainz.org", "/ws/2/artist/", &[("query", n.to_string())]);
            fetch(&mut state, &fake, address, Duration::from_secs(100));
        }
        assert_eq!(state.cache.len(), MAX_CACHE);
        assert!(!state.cache.contains_key(tag_url().as_str()));
    }
    #[test]
    fn discovery_empty_inputs_have_no_network_and_retryable_is_optional() {
        let result = discover_with(&mut State::default(), &Fake::new(vec![]), &[], &[]);
        assert_eq!(serde_json::to_value(result).unwrap(), json!({"recordings":[]}));
    }
    #[test]
    fn discovery_unexpected_json_is_retryable_and_empty_radio_is_negative_cached() {
        let fake = Fake::new(vec![json!({"unexpected":"shape"}), json!({})]);
        let mut state = State::default();
        assert!(fetch(&mut state, &fake, tag_url(), Duration::from_secs(100)).is_none());
        assert!(state.retryable);
        let address = endpoint("api.listenbrainz.org", &format!("/1/lb-radio/artist/{ARTIST}"), &[]);
        assert_eq!(fetch(&mut state, &fake, address.clone(), Duration::from_secs(100)), Some(json!({})));
        assert_eq!(state.cache[address.as_str()].expires, Duration::from_secs(601));
    }
    #[test]
    #[ignore = "live optional public discovery; set DEVILOAD_LIVE_DISCOVERY=1"]
    fn discovery_live_public_tags() {
        if std::env::var("DEVILOAD_LIVE_DISCOVERY").as_deref() != Ok("1") { return; }
        struct Trace(Http);
        impl Transport for Trace {
            fn now(&self) -> Duration { self.0.now() }
            fn wait(&self, duration: Duration) { self.0.wait(duration); }
            fn get(&self, address: &url::Url, timeout: Duration) -> Result<Reply, String> {
                let start = Instant::now();
                let response = self.0.get(address, timeout);
                eprintln!("discovery live {}{} status={:?} elapsed={:.2}s", address.host_str().unwrap_or(""), address.path(), response.as_ref().ok().map(|r| r.status), start.elapsed().as_secs_f64());
                response
            }
        }
        let transport = Trace(http("").unwrap());
        let artists = if std::env::var("DEVILOAD_LIVE_DISCOVERY_MODE").as_deref() == Ok("artist") { vec!["Daft Punk".into()] } else { Vec::new() };
        let result = discover_with(&mut State::default(), &transport, &artists, &["jazz".into()]);
        assert!(!result.recordings.is_empty(), "public service returned no recordings (retryable={})", result.retryable);
        assert!(result.recordings.iter().all(|r| mbid(&r.mbid) && !r.title.is_empty() && !r.artists.is_empty()));
    }
}
