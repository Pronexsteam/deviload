use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::{Arc, Mutex, OnceLock}, thread, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

// Public application identifier, shared by every installation. No account tokens.
const APPLICATION_ID: &str = include_str!("../discord-application-id.txt");

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    enabled: bool,
    playing: bool,
    private_session: bool,
    #[serde(default)] title: String,
    #[serde(default)] artist: String,
    #[serde(default)] image: String,
    #[serde(default)] position: f64,
    #[serde(default)] duration: f64,
}

fn configured() -> bool {
    let id = APPLICATION_ID.trim();
    (17..=20).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_digit())
}

fn clean(value: &str) -> String {
    let mut result = String::new();
    for c in value.trim().chars().filter(|c| !c.is_control()) {
        if result.len() + c.len_utf8() > 120 { break; }
        result.push(c);
    }
    result
}

fn activity(value: &Presence, now: i64) -> Value {
    let title = clean(&value.title);
    if !value.enabled || !value.playing || value.private_session || title.is_empty() { return Value::Null; }
    let image = url::Url::parse(&value.image).ok().filter(|url| url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && url.port().is_none()
        && matches!(url.host_str(), Some("i.ytimg.com" | "lh3.googleusercontent.com" | "yt3.googleusercontent.com")) && value.image.len() <= 512);
    let mut result = json!({"type": 2, "details": title, "state": clean(&value.artist),
        "assets":{"large_image":image.as_ref().map(|url| url.as_str()).unwrap_or("download"),"large_text":"Devil Music","small_image":"download","small_text":"Deviload"}});
    if value.duration.is_finite() && value.position.is_finite() && value.duration > 0.0 && value.position >= 0.0 {
        let duration = value.duration.min(86400.0);
        let start = now - (value.position.min(duration) * 1000.0) as i64;
        result["timestamps"] = json!({"start": start, "end": start + (duration * 1000.0) as i64});
    }
    result
}

struct Latest { value: Presence, updated: Instant }
static LATEST: OnceLock<Arc<Mutex<Latest>>> = OnceLock::new();

// One worker and one replaceable snapshot: Discord never runs on the audio/UI thread.
fn worker(latest: Arc<Mutex<Latest>>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut last = Value::Null;
    let mut retry = Instant::now();
    let mut sequence = 0u64;
    let mut sent = Instant::now() - Duration::from_secs(30);
    loop {
        thread::sleep(Duration::from_secs(2));
        let value = {
            let state = latest.lock().unwrap();
            if state.updated.elapsed() > Duration::from_secs(45) { Presence::default() } else {
                let mut value = state.value.clone();
                if value.playing { value.position += state.updated.elapsed().as_secs_f64(); }
                value
            }
        };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
        let next = activity(&value, now);
        if next.is_null() {
            if let Some(mut connection) = client.take() { let _ = connection.clear_activity(); let _ = connection.close(); }
            last = Value::Null;
            continue;
        }
        if client.is_none() {
            if Instant::now() < retry { continue; }
            retry = Instant::now() + Duration::from_secs(15);
            let mut connection = DiscordIpcClient::new(APPLICATION_ID.trim());
            // Validate READY rather than treating any handshake response as success.
            let ready = connection.connect_ipc().and_then(|_| connection.send(json!({"v":1,"client_id":APPLICATION_ID.trim()}), 0))
                .and_then(|_| connection.recv());
            if !matches!(ready, Ok((1, ref reply)) if reply["evt"] == "READY") { continue; }
            client = Some(connection);
        }
        // The frontend supplies a snapshot every 15 seconds. Small clock jitter is ignored.
        let same_track = next["details"] == last["details"] && next["state"] == last["state"] && next["assets"] == last["assets"];
        let same_time = (next["timestamps"]["start"].as_i64().unwrap_or(0) - last["timestamps"]["start"].as_i64().unwrap_or(0)).abs() < 2000;
        if sent.elapsed() < Duration::from_secs(5) || (same_track && same_time && sent.elapsed() < Duration::from_secs(15)) { continue; }
        sequence += 1;
        let connection = client.as_mut().unwrap();
        let result = connection.send(json!({"cmd":"SET_ACTIVITY","args":{"pid":std::process::id(),"activity":next},"nonce":sequence.to_string()}), 1)
            .and_then(|_| connection.recv());
        if matches!(result, Ok((1, ref reply)) if reply["evt"] != "ERROR") { last = next; sent = Instant::now(); }
        else { client = None; last = Value::Null; retry = Instant::now() + Duration::from_secs(15); }
    }
}

#[tauri::command]
pub fn music_presence(window: tauri::WebviewWindow, mut presence: Presence) -> bool {
    if window.label() != "main" || !configured() { return false; }
    presence.title = clean(&presence.title);
    presence.artist = clean(&presence.artist);
    if !presence.enabled || presence.private_session { presence = Presence::default(); }
    if !presence.enabled && LATEST.get().is_none() { return true; }
    let latest = LATEST.get_or_init(|| {
        let state = Arc::new(Mutex::new(Latest { value: Presence::default(), updated: Instant::now() }));
        let worker_state = state.clone();
        thread::spawn(move || worker(worker_state));
        state
    });
    *latest.lock().unwrap() = Latest { value: presence, updated: Instant::now() };
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presence_clears_on_pause_disable_and_private_session() {
        let mut p = Presence { enabled:true, playing:true, title:"Song".into(), ..Default::default() };
        assert!(!activity(&p, 100000).is_null());
        p.private_session = true; assert!(activity(&p, 100000).is_null());
        p.private_session = false; p.playing = false; assert!(activity(&p, 100000).is_null());
        p.playing = true; p.enabled = false; assert!(activity(&p, 100000).is_null());
    }
    #[test]
    fn presence_bounds_metadata_and_builds_seek_timestamps() {
        let p = Presence { enabled:true, playing:true, title:"🔥".repeat(100), artist:"A\nB".into(), position:30.0, duration:180.0, ..Default::default() };
        let a = activity(&p, 1000000);
        assert_eq!(a["timestamps"], json!({"start":970000,"end":1150000}));
        assert!(a["details"].as_str().unwrap().len() <= 120);
        assert_eq!(a["state"], "AB");
        assert_eq!(a["type"], 2);
    }
}
