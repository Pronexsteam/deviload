// Sends finished songs to the person's own ListenBrainz or Last.fm profile. Credentials live in their
// own file, which settings backups, music profiles, diagnostics and listening rooms never read, and
// they are never returned to the page: it only learns the account name.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const FILE: &str = "scrobbling.json";
const PENDING_LIMIT: usize = 1000;
static LOCK: Mutex<()> = Mutex::new(());
static FLUSH: Mutex<()> = Mutex::new(());
// Last.fm keys are issued per application; builds without them simply do not offer Last.fm.
const LASTFM_KEY: Option<&str> = option_env!("DEVILOAD_LASTFM_KEY");
const LASTFM_SECRET: Option<&str> = option_env!("DEVILOAD_LASTFM_SECRET");
// A workflow without the secrets still sets the variables, just empty.
fn lastfm_keys() -> Option<(&'static str, &'static str)> {
    LASTFM_KEY.zip(LASTFM_SECRET).filter(|(key, secret)| !key.trim().is_empty() && !secret.trim().is_empty())
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Account {
    secret: String,
    user: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Listen {
    title: String,
    artist: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    duration: Option<u32>,
    #[serde(default)]
    at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default)]
    services: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Accounts {
    #[serde(default)]
    listenbrainz: Option<Account>,
    #[serde(default)]
    lastfm: Option<Account>,
    #[serde(default)]
    lastfm_token: Option<String>,
    #[serde(default)]
    pending: Vec<Listen>,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn read(dir: &Path) -> Accounts {
    std::fs::read(dir.join(FILE)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn write(dir: &Path, accounts: &Accounts) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec_pretty(accounts).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(dir.join(FILE)).map_err(|e| e.to_string())?;
    Ok(())
}

fn update<T>(dir: &Path, change: impl FnOnce(&mut Accounts) -> T) -> Result<T, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut accounts = read(dir);
    let value = change(&mut accounts);
    write(dir, &accounts)?;
    Ok(value)
}

fn clean(value: &str, limit: usize) -> Option<String> {
    let value: String = value.trim().chars().filter(|c| !c.is_control()).take(limit).collect();
    (!value.is_empty()).then_some(value)
}

// Only well-formed songs that were heard in the last two weeks are accepted from the page.
pub fn checked(raw: &Value, at_required: bool) -> Option<Listen> {
    let title = clean(raw["title"].as_str()?, 500)?;
    let artist = clean(raw["artist"].as_str()?, 500)?;
    let album = raw["album"].as_str().and_then(|a| clean(a, 500));
    let duration = raw["duration"].as_f64().filter(|d| d.is_finite() && *d >= 1.0 && *d <= 86_400.0).map(|d| d.round() as u32);
    let id = raw["id"]
        .as_str()
        .filter(|id| id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        .map(str::to_owned);
    let at = raw["at"].as_i64().unwrap_or(0);
    if at_required && (at < now() - 14 * 86_400 || at > now() + 60) {
        return None;
    }
    Some(Listen { title, artist, album, duration, at, id, services: vec![] })
}

fn client(proxy: &str) -> Result<reqwest::blocking::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::blocking::Client::builder()
        .user_agent(concat!("Deviload/", env!("CARGO_PKG_VERSION"), " (https://github.com/Pronexsteam/deviload)"))
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5));
    if !proxy.is_empty() {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
    }
    builder.build().map_err(|e| e.to_string())
}

fn body(response: reqwest::blocking::Response) -> Result<(u16, Value), String> {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    response.take(256 * 1024).read_to_end(&mut bytes).map_err(|_| "The service did not answer.")?;
    Ok((status, serde_json::from_slice(&bytes).unwrap_or(Value::Null)))
}

// What happened to one submission: kept for a later retry, or finished (sent or refused for good).
#[derive(PartialEq, Debug)]
enum Sent {
    Done,
    Retry,
}

fn outcome(status: u16) -> Sent {
    if status == 429 || status >= 500 || status == 0 { Sent::Retry } else { Sent::Done }
}

fn listenbrainz_item(listen: &Listen, timed: bool) -> Value {
    let mut info = json!({ "media_player": "Deviload", "submission_client": "Deviload", "submission_client_version": env!("CARGO_PKG_VERSION") });
    if let Some(duration) = listen.duration {
        info["duration_ms"] = json!(duration as u64 * 1000);
    }
    if let Some(id) = &listen.id {
        info["origin_url"] = json!(format!("https://music.youtube.com/watch?v={id}"));
        info["music_service"] = json!("music.youtube.com");
    }
    let mut metadata = json!({ "artist_name": listen.artist, "track_name": listen.title, "additional_info": info });
    if let Some(album) = &listen.album {
        metadata["release_name"] = json!(album);
    }
    let mut item = json!({ "track_metadata": metadata });
    if timed {
        item["listened_at"] = json!(listen.at);
    }
    item
}

fn listenbrainz_payload(listen: &Listen, kind: &str) -> Value {
    json!({ "listen_type": kind, "payload": [listenbrainz_item(listen, kind != "playing_now")] })
}

// A backlog goes out as one request; ListenBrainz calls several past listens an import.
fn listenbrainz_batch(listens: &[&Listen]) -> Value {
    let kind = if listens.len() == 1 { "single" } else { "import" };
    json!({ "listen_type": kind, "payload": listens.iter().map(|l| listenbrainz_item(l, true)).collect::<Vec<_>>() })
}

fn listenbrainz(client: &reqwest::blocking::Client, token: &str, payload: &Value) -> Sent {
    match client.post("https://api.listenbrainz.org/1/submit-listens").header("Authorization", format!("Token {token}")).json(payload).send() {
        Ok(response) => outcome(response.status().as_u16()),
        Err(_) => Sent::Retry,
    }
}

// Last.fm signs every call: the sorted parameters followed by the application secret, as MD5.
fn signature(params: &[(String, String)], secret: &str) -> String {
    let mut sorted: Vec<_> = params.iter().filter(|(k, _)| k != "format").collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let mut text = String::new();
    for (key, value) in sorted {
        text.push_str(key);
        text.push_str(value);
    }
    text.push_str(secret);
    md5_hex(text.as_bytes())
}

fn lastfm_call(client: &reqwest::blocking::Client, params: Vec<(String, String)>) -> Result<(u16, Value), String> {
    let Some((key, secret)) = lastfm_keys() else { return Err("Last.fm is not available in this build.".into()) };
    let mut params = params;
    params.push(("api_key".into(), key.to_owned()));
    let sig = signature(&params, secret);
    params.push(("api_sig".into(), sig));
    params.push(("format".into(), "json".to_owned()));
    let form = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(params.iter().map(|(k, v)| (k.as_str(), v.as_str()))).finish();
    let response = client
        .post("https://ws.audioscrobbler.com/2.0/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .map_err(|_| "Last.fm did not answer.")?;
    body(response)
}

fn pairs(list: &[(&str, String)]) -> Vec<(String, String)> {
    list.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn lastfm_now_playing(listen: &Listen, session: &str) -> Vec<(String, String)> {
    let mut params = pairs(&[("method", "track.updateNowPlaying".into()), ("sk", session.to_owned()), ("artist", listen.artist.clone()), ("track", listen.title.clone())]);
    if let Some(album) = &listen.album {
        params.push(("album".into(), album.clone()));
    }
    if let Some(duration) = listen.duration {
        params.push(("duration".into(), duration.to_string()));
    }
    params
}

// Up to 50 scrobbles in one call, numbered artist[0], track[0], timestamp[0] and so on.
fn lastfm_scrobbles(listens: &[&Listen], session: &str) -> Vec<(String, String)> {
    let mut params = pairs(&[("method", "track.scrobble".into()), ("sk", session.to_owned())]);
    for (i, listen) in listens.iter().enumerate() {
        params.push((format!("artist[{i}]"), listen.artist.clone()));
        params.push((format!("track[{i}]"), listen.title.clone()));
        params.push((format!("timestamp[{i}]"), listen.at.to_string()));
        if let Some(album) = &listen.album {
            params.push((format!("album[{i}]"), album.clone()));
        }
        if let Some(duration) = listen.duration {
            params.push((format!("duration[{i}]"), duration.to_string()));
        }
    }
    params
}

fn lastfm(client: &reqwest::blocking::Client, params: Vec<(String, String)>) -> Sent {
    match lastfm_call(client, params) {
        // Code 11 and 16 are temporary service errors; 29 is the rate limit.
        Ok((_, value)) if matches!(value["error"].as_i64(), Some(11 | 16 | 29)) => Sent::Retry,
        Ok((status, _)) => outcome(status),
        Err(_) => Sent::Retry,
    }
}

pub fn status(dir: &Path) -> Value {
    let accounts = read(dir);
    json!({
        "listenbrainz": accounts.listenbrainz.map(|a| a.user),
        "lastfm": accounts.lastfm.map(|a| a.user),
        "lastfmAvailable": lastfm_keys().is_some(),
        "lastfmWaiting": accounts.lastfm_token.is_some(),
        "pending": accounts.pending.len(),
    })
}

fn connect_listenbrainz(dir: &Path, token: &str, proxy: &str) -> Result<Value, String> {
    let token = token.trim();
    if token.is_empty() || token.len() > 128 || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("This does not look like a ListenBrainz user token.".into());
    }
    let response = client(proxy)?
        .get("https://api.listenbrainz.org/1/validate-token")
        .header("Authorization", format!("Token {token}"))
        .send()
        .map_err(|_| "ListenBrainz did not answer. Check your connection and try again.")?;
    let (_, value) = body(response)?;
    let Some(user) = value["user_name"].as_str().filter(|_| value["valid"] == true).and_then(|u| clean(u, 200)) else {
        return Err("ListenBrainz did not accept this token.".into());
    };
    update(dir, |accounts| accounts.listenbrainz = Some(Account { secret: token.to_owned(), user }))?;
    Ok(status(dir))
}

fn begin_lastfm(dir: &Path, proxy: &str) -> Result<String, String> {
    let (_, value) = lastfm_call(&client(proxy)?, pairs(&[("method", "auth.getToken".to_owned())]))?;
    let token = value["token"].as_str().filter(|t| t.len() <= 64 && t.bytes().all(|b| b.is_ascii_alphanumeric())).ok_or("Last.fm did not start the sign-in.")?.to_owned();
    update(dir, |accounts| accounts.lastfm_token = Some(token.clone()))?;
    Ok(format!("https://www.last.fm/api/auth/?api_key={}&token={token}", lastfm_keys().map(|k| k.0).unwrap_or_default()))
}

fn finish_lastfm(dir: &Path, proxy: &str) -> Result<Value, String> {
    let token = read(dir).lastfm_token.ok_or("Start the Last.fm sign-in first.")?;
    let (_, value) = lastfm_call(&client(proxy)?, pairs(&[("method", "auth.getSession".to_owned()), ("token", token)]))?;
    let session = &value["session"];
    let (Some(key), Some(user)) = (session["key"].as_str(), session["name"].as_str().and_then(|u| clean(u, 200))) else {
        return Err("Last.fm has not confirmed access yet. Allow Deviload on the Last.fm page, then try again.".into());
    };
    let key = key.to_owned();
    update(dir, |accounts| {
        accounts.lastfm = Some(Account { secret: key, user });
        accounts.lastfm_token = None;
    })?;
    Ok(status(dir))
}

fn disconnect(dir: &Path, service: &str) -> Result<Value, String> {
    update(dir, |accounts| {
        match service {
            "listenbrainz" => accounts.listenbrainz = None,
            "lastfm" => {
                accounts.lastfm = None;
                accounts.lastfm_token = None;
            }
            _ => {}
        }
        // Songs waiting for a service that is no longer connected are not kept for it.
        for listen in &mut accounts.pending {
            listen.services.retain(|s| s != service);
        }
        accounts.pending.retain(|l| !l.services.is_empty());
    })?;
    Ok(status(dir))
}

fn now_playing(dir: &Path, listen: &Listen, proxy: &str) {
    let accounts = read(dir);
    let Ok(client) = client(proxy) else { return };
    if let Some(account) = &accounts.listenbrainz {
        let _ = listenbrainz(&client, &account.secret, &listenbrainz_payload(listen, "playing_now"));
    }
    if let Some(account) = &accounts.lastfm {
        let _ = lastfm(&client, lastfm_now_playing(listen, &account.secret));
    }
}

fn queue(dir: &Path, mut listen: Listen) -> Result<(), String> {
    update(dir, |accounts| {
        listen.services = [("listenbrainz", accounts.listenbrainz.is_some()), ("lastfm", accounts.lastfm.is_some())]
            .into_iter()
            .filter_map(|(name, on)| on.then(|| name.to_owned()))
            .collect();
        if listen.services.is_empty() || accounts.pending.iter().any(|p| p.at == listen.at && p.title == listen.title) {
            return;
        }
        accounts.pending.push(listen);
        let extra = accounts.pending.len().saturating_sub(PENDING_LIMIT);
        accounts.pending.drain(..extra);
    })
}

// Sends what is waiting, oldest first. Anything the network could not take stays for the next song.
fn flush(dir: &Path, proxy: &str) {
    let Ok(_flushing) = FLUSH.try_lock() else { return };
    let accounts = read(dir);
    let Ok(client) = client(proxy) else { return };
    let mut done: Vec<(i64, String, String)> = Vec::new();
    // One request per service for up to 50 waiting songs, never one request per song.
    for service in ["listenbrainz", "lastfm"] {
        let batch: Vec<&Listen> = accounts.pending.iter().filter(|l| l.services.iter().any(|s| s == service)).take(50).collect();
        if batch.is_empty() {
            continue;
        }
        let sent = match (service, &accounts.listenbrainz, &accounts.lastfm) {
            ("listenbrainz", Some(account), _) => listenbrainz(&client, &account.secret, &listenbrainz_batch(&batch)),
            ("lastfm", _, Some(account)) => lastfm(&client, lastfm_scrobbles(&batch, &account.secret)),
            _ => Sent::Done,
        };
        if sent == Sent::Done {
            done.extend(batch.iter().map(|l| (l.at, l.title.clone(), service.to_owned())));
        }
    }
    finish_flush(dir, &done)
}

fn finish_flush(dir: &Path, done: &[(i64, String, String)]) {
    if done.is_empty() {
        return;
    }
    let _ = update(dir, |accounts| {
        for listen in &mut accounts.pending {
            listen.services.retain(|s| !done.iter().any(|(at, title, service)| *at == listen.at && *title == listen.title && service == s));
        }
        accounts.pending.retain(|l| !l.services.is_empty());
    });
}

fn proxy(engine: &crate::Engine) -> String {
    crate::stored_proxy(&engine.dir)
}

async fn blocking<T: Send + 'static>(task: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scrobble_status(engine: tauri::State<'_, crate::Engine>) -> Value {
    status(&engine.dir)
}

#[tauri::command]
pub async fn scrobble_connect_listenbrainz(token: String, engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    let (dir, proxy) = (engine.dir.clone(), proxy(&engine));
    blocking(move || connect_listenbrainz(&dir, &token, &proxy)).await?
}

#[tauri::command]
pub async fn scrobble_lastfm_begin(engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    let (dir, proxy) = (engine.dir.clone(), proxy(&engine));
    let url = blocking(move || begin_lastfm(&dir, &proxy)).await??;
    crate::open_in_browser(&url).map_err(|e| format!("Could not open Last.fm: {e}"))
}

#[tauri::command]
pub async fn scrobble_lastfm_finish(engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    let (dir, proxy) = (engine.dir.clone(), proxy(&engine));
    blocking(move || finish_lastfm(&dir, &proxy)).await?
}

#[tauri::command]
pub fn scrobble_disconnect(service: String, engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    disconnect(&engine.dir, &service)
}

#[tauri::command]
pub fn scrobble_open_help(service: String) -> Result<(), String> {
    let url = match service.as_str() {
        "listenbrainz" => "https://listenbrainz.org/settings/",
        _ => return Err("Unknown service".into()),
    };
    crate::open_in_browser(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scrobble_now_playing(track: Value, engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    let Some(listen) = checked(&track, false) else { return Ok(()) };
    let (dir, proxy) = (engine.dir.clone(), proxy(&engine));
    blocking(move || now_playing(&dir, &listen, &proxy)).await
}

#[tauri::command]
pub async fn scrobble_listen(track: Value, engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    let Some(listen) = checked(&track, true) else { return Ok(()) };
    let (dir, proxy) = (engine.dir.clone(), proxy(&engine));
    blocking(move || {
        queue(&dir, listen)?;
        flush(&dir, &proxy);
        Ok(())
    })
    .await?
}

// Compact MD5 (RFC 1321), needed only for Last.fm request signatures.
fn md5_hex(input: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4,
        11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64).map(|i| ((i as f64 + 1.0).sin().abs() * 4_294_967_296.0) as u32).collect();
    let mut message = input.to_vec();
    let bits = (input.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bits.to_le_bytes());
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for chunk in message.chunks(64) {
        let m: Vec<u32> = chunk.chunks(4).map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]])).collect();
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let next = a.wrapping_add(f).wrapping_add(k[i]).wrapping_add(m[g]).rotate_left(S[i]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(next);
        }
        state = [state[0].wrapping_add(a), state[1].wrapping_add(b), state[2].wrapping_add(c), state[3].wrapping_add(d)];
    }
    state.iter().flat_map(|v| v.to_le_bytes()).map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_reference_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex("1234567890".repeat(8).as_bytes()), "57edf4a22be3c955ac49da2e2107b67a");
    }

    #[test]
    fn signatures_sort_parameters_and_skip_format() {
        let a = signature(&pairs(&[("method", "auth.getToken".into()), ("api_key", "k".into()), ("format", "json".into())]), "s");
        assert_eq!(a, md5_hex(b"api_keykmethodauth.getTokens"));
    }

    #[test]
    fn only_recent_well_formed_songs_are_accepted() {
        let at = now() - 60;
        let good = json!({ "title": " Song\u{7} ", "artist": "Artist", "album": "", "duration": 201.4, "at": at, "id": "dQw4w9WgXcQ" });
        let listen = checked(&good, true).unwrap();
        assert_eq!((listen.title.as_str(), listen.album, listen.duration, listen.id.as_deref()), ("Song", None, Some(201), Some("dQw4w9WgXcQ")));
        assert!(checked(&json!({ "title": "Song", "artist": "", "at": at }), true).is_none());
        assert!(checked(&json!({ "title": "Song", "artist": "A", "at": at - 30 * 86_400 }), true).is_none());
        assert!(checked(&json!({ "title": "Song", "artist": "A" }), false).is_some());
        assert_eq!(checked(&json!({ "title": "S", "artist": "A", "at": at, "id": "local:abc" }), true).unwrap().id, None);
    }

    #[test]
    fn credentials_stay_out_of_status_and_disconnect_drops_waiting_songs() {
        let dir = tempfile::tempdir().unwrap();
        update(dir.path(), |a| {
            a.listenbrainz = Some(Account { secret: "secret-token".into(), user: "me".into() });
        })
        .unwrap();
        let listen = checked(&json!({ "title": "Song", "artist": "A", "at": now() }), true).unwrap();
        queue(dir.path(), listen.clone()).unwrap();
        queue(dir.path(), listen).unwrap();
        let shown = status(dir.path());
        assert_eq!(shown["listenbrainz"], "me");
        assert_eq!(shown["pending"], 1, "the same listen is queued once");
        assert!(!shown.to_string().contains("secret-token"));
        disconnect(dir.path(), "listenbrainz").unwrap();
        assert_eq!(status(dir.path())["pending"], 0);
        assert!(!std::fs::read_to_string(dir.path().join(FILE)).unwrap().contains("secret-token"));
    }

    #[test]
    fn nothing_is_queued_without_an_account_and_the_queue_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        queue(dir.path(), checked(&json!({ "title": "Song", "artist": "A", "at": now() }), true).unwrap()).unwrap();
        assert_eq!(status(dir.path())["pending"], 0);
        update(dir.path(), |a| a.lastfm = Some(Account { secret: "k".into(), user: "me".into() })).unwrap();
        for i in 0..(PENDING_LIMIT + 5) {
            let mut listen = checked(&json!({ "title": format!("Song {i}"), "artist": "A", "at": now() }), true).unwrap();
            listen.at -= i as i64;
            queue(dir.path(), listen).unwrap();
        }
        assert_eq!(status(dir.path())["pending"], PENDING_LIMIT);
    }

    #[test]
    fn a_backlog_goes_out_as_one_numbered_request_per_service() {
        let one = checked(&json!({ "title": "S1", "artist": "A", "at": 10, "album": "B" }), false).unwrap();
        let two = checked(&json!({ "title": "S2", "artist": "A", "at": 20 }), false).unwrap();
        let params = lastfm_scrobbles(&[&one, &two], "sk");
        let get = |key: &str| params.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str());
        assert_eq!((get("track[0]"), get("track[1]"), get("timestamp[1]"), get("album[0]"), get("album[1]")), (Some("S1"), Some("S2"), Some("20"), Some("B"), None));
        let brainz = listenbrainz_batch(&[&one, &two]);
        assert_eq!(brainz["listen_type"], "import");
        assert_eq!(brainz["payload"].as_array().unwrap().len(), 2);
        assert_eq!(listenbrainz_batch(&[&one])["listen_type"], "single");
    }

    #[test]
    fn retries_only_for_temporary_failures() {
        assert_eq!(outcome(200), Sent::Done);
        assert_eq!(outcome(400), Sent::Done);
        assert_eq!(outcome(429), Sent::Retry);
        assert_eq!(outcome(503), Sent::Retry);
        let listen = checked(&json!({ "title": "S", "artist": "A", "album": "B", "at": 5, "duration": 3, "id": "dQw4w9WgXcQ" }), false).unwrap();
        let now_playing = listenbrainz_payload(&listen, "playing_now");
        assert!(now_playing["payload"][0].get("listened_at").is_none());
        assert_eq!(listenbrainz_payload(&listen, "single")["payload"][0]["listened_at"], 5);
        assert_eq!(now_playing["payload"][0]["track_metadata"]["additional_info"]["duration_ms"], 3000);
    }
}
