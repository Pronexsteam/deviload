//! An opt-in local control API for the person's own tools (stream overlays, Stream Deck, scripts).
//! It listens on 127.0.0.1 only, is off until turned on, and every request carries the person's token.
//! Separate from the phone remote and its LAN token; the YouTube account never passes through it.
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::{Read, Write}, net::{TcpListener, TcpStream}, path::{Path, PathBuf}, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, thread, time::{Duration, Instant}};
use tauri::{Emitter, Manager};

pub const PORT: u16 = 17311;
const FILE: &str = "control-api.json";

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
pub struct Settings { #[serde(default)] pub enabled: bool, #[serde(default)] pub token: String }

#[derive(Serialize)]
pub struct Status { enabled: bool, running: bool, url: String, token: String, error: Option<String> }

struct Server { stopped: Arc<AtomicBool>, token: String }
static SERVER: OnceLock<Mutex<Option<Server>>> = OnceLock::new();
static ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
fn server() -> &'static Mutex<Option<Server>> { SERVER.get_or_init(|| Mutex::new(None)) }
fn last_error() -> &'static Mutex<Option<String>> { ERROR.get_or_init(|| Mutex::new(None)) }

fn new_token() -> String { let mut bytes = [0u8; 24]; rand::rng().fill_bytes(&mut bytes); bytes.iter().map(|b| format!("{b:02x}")).collect() }
fn valid_token(token: &str) -> bool { token.len() == 48 && token.bytes().all(|b| b.is_ascii_hexdigit()) }

pub fn load(dir: &Path) -> Settings {
    let mut settings: Settings = std::fs::read(dir.join(FILE)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    if !valid_token(&settings.token) { settings.token.clear(); }
    settings
}
fn save(dir: &Path, settings: &Settings) -> Result<(), String> {
    let path = dir.join(FILE);
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}

fn stop() { if let Some(old) = server().lock().unwrap().take() { old.stopped.store(true, Ordering::Relaxed); } }

fn start(app: tauri::AppHandle, token: String) -> Result<(), String> {
    stop();
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|_| "The control API port is in use".to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stopped = Arc::new(AtomicBool::new(false));
    let (flag, key) = (stopped.clone(), token.clone());
    thread::spawn(move || {
        // One request at a time with short timeouts, so a stalled client cannot pile up threads.
        while !flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => { let _ = serve(stream, &key, &crate::music_mini::current, &|action, value| emit(&app, action, value)); }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(30)),
                Err(_) => thread::sleep(Duration::from_millis(250)),
            }
        }
    });
    *server().lock().unwrap() = Some(Server { stopped, token });
    Ok(())
}

fn emit(app: &tauri::AppHandle, action: &str, value: Option<f64>) -> Result<(), String> {
    if matches!(action, "volume" | "seek") { app.emit_to("main", "music-mini-adjust", serde_json::json!({"action": action, "value": value})).map_err(|e| e.to_string()) }
    else { app.emit_to("main", "music-control", action).map_err(|e| e.to_string()) }
}

/// Called once at startup: an API the person turned on comes back with the app.
pub fn restore(app: &tauri::AppHandle, dir: &Path) {
    let settings = load(dir);
    if settings.enabled && valid_token(&settings.token) { *last_error().lock().unwrap() = start(app.clone(), settings.token).err(); }
}

fn status(dir: &Path) -> Status {
    let settings = load(dir);
    let running = server().lock().unwrap().as_ref().is_some_and(|s| !s.stopped.load(Ordering::Relaxed) && s.token == settings.token);
    Status { enabled: settings.enabled, running, url: format!("http://127.0.0.1:{PORT}/api/v1"), token: settings.token, error: if settings.enabled && !running { last_error().lock().unwrap().clone() } else { None } }
}

fn engine_dir(app: &tauri::AppHandle) -> PathBuf { app.state::<crate::Engine>().dir.clone() }

#[tauri::command]
pub fn music_control_api_status(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Status, String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    Ok(status(&engine_dir(&app)))
}

#[tauri::command]
pub fn music_control_api_set(app: tauri::AppHandle, window: tauri::WebviewWindow, enabled: bool, renew: Option<bool>) -> Result<Status, String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let dir = engine_dir(&app);
    let mut settings = load(&dir);
    settings.enabled = enabled;
    if settings.token.is_empty() || renew == Some(true) { settings.token = new_token(); }
    save(&dir, &settings)?;
    *last_error().lock().unwrap() = None;
    if enabled { if let Err(error) = start(app.clone(), settings.token.clone()) { *last_error().lock().unwrap() = Some(error); } } else { stop(); }
    Ok(status(&dir))
}

struct Request { method: String, path: String, query: HashMap<String, String>, headers: HashMap<String, String>, body: Vec<u8> }

fn read_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    let invalid = || std::io::Error::from(std::io::ErrorKind::InvalidData);
    let start = Instant::now();
    let (mut bytes, mut byte) = (Vec::new(), [0u8]);
    while !bytes.ends_with(b"\r\n\r\n") {
        if bytes.len() >= 8192 || start.elapsed() > Duration::from_secs(2) { return Err(invalid()); }
        stream.read_exact(&mut byte)?;
        bytes.push(byte[0]);
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid())?;
    let mut lines = text.split("\r\n");
    let parts: Vec<_> = lines.next().unwrap_or("").split_whitespace().collect();
    if parts.len() != 3 || !matches!(parts[2], "HTTP/1.1" | "HTTP/1.0") { return Err(invalid()); }
    let (path, query) = parts[1].split_once('?').unwrap_or((parts[1], ""));
    let query = query.split('&').filter_map(|pair| pair.split_once('=')).map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let mut headers = HashMap::new();
    for line in lines.filter(|l| !l.is_empty()) {
        let (k, v) = line.split_once(':').ok_or_else(invalid)?;
        if headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string()).is_some() { return Err(invalid()); }
    }
    if headers.contains_key("transfer-encoding") { return Err(invalid()); }
    let length = headers.get("content-length").map(|v| v.parse::<usize>()).transpose().map_err(|_| invalid())?.unwrap_or(0);
    if length > 1024 { return Err(invalid()); }
    let mut body = vec![0; length];
    stream.read_exact(&mut body)?;
    Ok(Request { method: parts[0].to_string(), path: path.to_string(), query, headers, body })
}

fn response(stream: &mut TcpStream, code: u16, body: &[u8], open: bool) -> std::io::Result<()> {
    // Only the read-only state is readable from a page (an OBS browser source); commands never are.
    let cors = if open { "Access-Control-Allow-Origin: *\r\n" } else { "" };
    write!(stream, "HTTP/1.1 {code} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n{cors}\r\n", body.len())?;
    stream.write_all(body)
}
// The page an OBS browser source shows: the song playing, read from the state above with the same token.
const OVERLAY: &'static str = include_str!("music_overlay.html");
fn page(stream: &mut TcpStream, body: &[u8]) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https:; connect-src 'self'\r\n\r\n", body.len())?;
    stream.write_all(body)
}
fn error(stream: &mut TcpStream, code: u16, message: &str) -> std::io::Result<()> { response(stream, code, &serde_json::to_vec(&serde_json::json!({"error": message}))?, false) }

fn same(a: &str, b: &str) -> bool { a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Value { value: f64 }

fn command(path: &str) -> Option<&str> {
    path.strip_prefix("/api/v1/").filter(|a| matches!(*a, "play" | "next" | "previous" | "shuffle" | "repeat" | "mute" | "volume" | "seek"))
}

fn serve(mut stream: TcpStream, token: &str, state: &dyn Fn() -> crate::music_mini::MiniState, emit: &dyn Fn(&str, Option<f64>) -> Result<(), String>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    let r = match read_request(&mut stream) { Ok(r) => r, Err(_) => return error(&mut stream, 400, "Invalid request") };
    // A page that renamed its own host to this address (DNS rebinding) names that host here and is refused.
    let host_ok = r.headers.get("host").is_some_and(|h| [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")].contains(h));
    if !host_ok { return error(&mut stream, 403, "Forbidden"); }
    let given = r.headers.get("authorization").and_then(|v| v.strip_prefix("Bearer ")).map(str::trim).or_else(|| r.query.get("token").map(String::as_str));
    if !given.is_some_and(|g| same(g, token)) { return error(&mut stream, 401, "Token required"); }
    if r.method == "GET" && r.path == "/api/v1/state" { return response(&mut stream, 200, &serde_json::to_vec(&state())?, true); }
    if r.method == "GET" && r.path == "/overlay" { return page(&mut stream, OVERLAY.as_bytes()); }
    let Some(action) = command(&r.path) else { return error(&mut stream, 404, "Not found") };
    if r.method != "POST" { return error(&mut stream, 405, "Use POST"); }
    // Browsers name the page that sent a request; the person's tools and scripts do not. Pages may not steer the player.
    if r.headers.contains_key("origin") { return error(&mut stream, 403, "Forbidden"); }
    let value = if matches!(action, "volume" | "seek") {
        match serde_json::from_slice::<Value>(&r.body) { Ok(v) if v.value.is_finite() && (0.0..=1.0).contains(&v.value) => Some(v.value), _ => return error(&mut stream, 400, "Send {\"value\": 0..1}") }
    } else { None };
    if emit(action, value).is_err() { return error(&mut stream, 503, "Player unavailable"); }
    response(&mut stream, 200, b"{\"ok\":true}", false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn exchange(raw: &str, token: &str) -> (String, Vec<(String, Option<f64>)>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        client.write_all(raw.as_bytes()).unwrap();
        let (stream, _) = listener.accept().unwrap();
        let sent = std::cell::RefCell::new(Vec::new());
        serve(stream, token, &crate::music_mini::MiniState::default, &|a, v| { sent.borrow_mut().push((a.to_string(), v)); Ok(()) }).unwrap();
        let mut answer = String::new();
        client.read_to_string(&mut answer).unwrap();
        (answer, sent.into_inner())
    }
    fn token() -> String { "ab".repeat(24) }

    #[test]
    fn state_needs_the_token_and_a_local_host() {
        let t = token();
        let (answer, _) = exchange(&format!("GET /api/v1/state HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 401"));
        let (answer, _) = exchange(&format!("GET /api/v1/state?token={t} HTTP/1.1\r\nHost: evil.example:{PORT}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 403"));
        let (answer, _) = exchange(&format!("GET /api/v1/state?token={t} HTTP/1.1\r\nHost: localhost:{PORT}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 200") && answer.contains("Access-Control-Allow-Origin: *") && answer.contains("\"playing\":false"));
        let (answer, _) = exchange(&format!("GET /api/v1/state HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {t}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn commands_reach_the_player_but_never_from_a_web_page() {
        let t = token();
        let (answer, sent) = exchange(&format!("POST /api/v1/next HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {t}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 200"));
        assert_eq!(sent, vec![("next".to_string(), None)]);
        let (answer, sent) = exchange(&format!("POST /api/v1/next HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: https://evil.example\r\nAuthorization: Bearer {t}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 403") && sent.is_empty());
        let body = "{\"value\":0.4}";
        let (answer, sent) = exchange(&format!("POST /api/v1/volume HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {t}\r\nContent-Length: {}\r\n\r\n{body}", body.len()), &t);
        assert!(answer.starts_with("HTTP/1.1 200"));
        assert_eq!(sent, vec![("volume".to_string(), Some(0.4))]);
        let body = "{\"value\":3}";
        let (answer, sent) = exchange(&format!("POST /api/v1/seek HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {t}\r\nContent-Length: {}\r\n\r\n{body}", body.len()), &t);
        assert!(answer.starts_with("HTTP/1.1 400") && sent.is_empty());
        let (answer, sent) = exchange(&format!("GET /api/v1/next HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {t}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 405") && sent.is_empty());
        let (answer, sent) = exchange(&format!("POST /api/v1/close HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {t}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 404") && sent.is_empty());
    }

    #[test]
    fn the_overlay_page_needs_the_token_and_only_reads() {
        let t = token();
        let (answer, _) = exchange(&format!("GET /overlay HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 401"));
        let (answer, sent) = exchange(&format!("GET /overlay?token={t} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 200") && answer.contains("text/html") && answer.contains("connect-src 'self'"));
        assert!(answer.contains("/api/v1/state") && sent.is_empty());
    }

    #[test]
    fn a_wrong_token_is_refused() {
        let t = token();
        let wrong = "cd".repeat(24);
        let (answer, sent) = exchange(&format!("POST /api/v1/play HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {wrong}\r\n\r\n"), &t);
        assert!(answer.starts_with("HTTP/1.1 401") && sent.is_empty());
    }

    #[test]
    fn settings_are_off_by_default_and_round_trip() {
        let dir = std::env::temp_dir().join(format!("deviload-control-api-{}", new_token()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(load(&dir), Settings::default());
        let settings = Settings { enabled: true, token: new_token() };
        save(&dir, &settings).unwrap();
        assert_eq!(load(&dir), settings);
        std::fs::write(dir.join(FILE), b"{\"enabled\":true,\"token\":\"short\"}").unwrap();
        assert_eq!(load(&dir).token, "");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
