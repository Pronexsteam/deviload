// Phone link: one QR code pairs a phone on the same network. The phone page lists the
// files sent from the computer, uploads files back once the computer accepts them, and
// can hand a link to the download queue. The link lives until it is stopped.
use super::{completed_media, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{IpAddr, TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}},
    thread,
    time::{Duration, Instant},
};
use tauri::Emitter;

const MAX_UPLOAD: u64 = 16 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 50;
const MAX_WAITING_OFFERS: usize = 10;
const LINKS_PER_MINUTE: usize = 20;
// With no phone requests and no transfer running for this long, the link turns itself off.
const IDLE_OFF: Duration = Duration::from_secs(30 * 60);

// What the phone link needs from the rest of the app; tests use their own.
pub(super) trait PhoneHost: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
    fn queue_link(&self, url: &str) -> Result<usize, String>;
    fn inbox(&self) -> PathBuf;
    fn received(&self, file: &Path) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub(super) struct ShareState(Arc<Mutex<Option<Hub>>>);

struct Hub {
    token: String,
    // Each start gets its own number, so an old listener never serves a newer session.
    session: u64,
    url: String,
    public: bool,
    page: PhonePage,
    host: Arc<dyn PhoneHost>,
    files: Vec<Outgoing>,
    offers: Vec<Offer>,
    device: String,
    seen: Option<Instant>,
    started: Instant,
    links: Vec<Instant>,
    next_id: u64,
}

impl Hub {
    fn idle(&self) -> bool {
        let busy = self.offers.iter().any(|o| o.state == OfferState::Receiving)
            || self.files.iter().any(|f| f.sent.load(Ordering::Relaxed) > 0 && !f.done.load(Ordering::Relaxed));
        !busy && self.seen.unwrap_or(self.started).max(self.started).elapsed() >= IDLE_OFF
    }
}

#[derive(Clone)]
struct Outgoing { id: u64, path: PathBuf, name: String, size: u64, sent: Arc<AtomicU64>, done: Arc<AtomicBool> }

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum OfferState { Waiting, Accepted, Declined, Receiving, Done, Failed }

#[derive(Clone)]
struct Offer { id: u64, name: String, size: u64, state: OfferState, received: Arc<AtomicU64>, device: String }

// Phone page wording comes from the UI so it follows the chosen language.
#[derive(Clone, Default, Deserialize)]
pub(super) struct PhonePage { lang: String, strings: HashMap<String, String> }

const PAGE_KEYS: [&str; 20] = ["heading", "fromComputer", "nothingYet", "download", "toComputer", "sendFiles",
    "waiting", "accepted", "declined", "sending", "sent", "failed", "linkTitle", "linkPlaceholder", "linkButton",
    "linkAdded", "homeHint", "kilobytes", "megabytes", "offline"];

impl PhonePage {
    fn checked(self) -> PhonePage {
        let strings = PAGE_KEYS.iter().map(|key| {
            let value = self.strings.get(*key).cloned().unwrap_or_default();
            (key.to_string(), value.chars().filter(|c| !c.is_control()).take(200).collect())
        }).collect();
        PhonePage { lang: if self.lang == "ru" { "ru".into() } else { "en".into() }, strings }
    }
}

impl ShareState {
    fn with<T>(&self, token: &str, action: impl FnOnce(&mut Hub) -> T) -> Option<T> {
        let mut guard = self.0.lock().ok()?;
        guard.as_mut().filter(|hub| hub.token == token).map(action)
    }
}

fn lan_address() -> Result<IpAddr, String> {
    for destination in ["192.0.2.1:80", "8.8.8.8:80"] {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(destination).is_ok() {
                if let Ok(address) = socket.local_addr() {
                    if let IpAddr::V4(ip) = address.ip() {
                        if ip.is_private() || ip.is_link_local() { return Ok(IpAddr::V4(ip)); }
                    }
                }
            }
        }
    }
    Err("No local network found. Connect the computer and the phone to the same Wi-Fi network.".into())
}

#[cfg(windows)]
fn public_network(ip: IpAddr) -> bool {
    use std::os::windows::process::CommandExt;
    let script = format!("$a=Get-NetIPAddress -IPAddress '{}' -ErrorAction SilentlyContinue; if($a){{(Get-NetConnectionProfile -InterfaceIndex $a.InterfaceIndex -ErrorAction SilentlyContinue).NetworkCategory}}", ip);
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .output();
    output.is_ok_and(|output| String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("public"))
}
#[cfg(not(windows))]
fn public_network(_ip: IpAddr) -> bool { false }

// The token and port survive restarts, so a bookmark or home-screen icon on the phone keeps working.
#[derive(Default, Serialize, Deserialize)]
struct Pairing { token: String, port: u16 }

fn pairing_file(dir: &Path) -> PathBuf { dir.join("phone.json") }

fn load_pairing(dir: &Path) -> Pairing {
    let saved: Pairing = fs::read(pairing_file(dir)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    if saved.token.len() == 48 && saved.token.bytes().all(|b| b.is_ascii_hexdigit()) { return saved; }
    let mut random = [0u8; 24];
    rand::rng().fill_bytes(&mut random);
    Pairing { token: random.iter().map(|byte| format!("{byte:02x}")).collect(), port: 0 }
}

struct AppHost { app: tauri::AppHandle, engine: Engine }

impl PhoneHost for AppHost {
    fn emit(&self, event: &str, payload: serde_json::Value) { let _ = self.app.emit(event, payload); }
    fn queue_link(&self, url: &str) -> Result<usize, String> {
        let urls = crate::model::parse_urls(url)?;
        if urls.len() != 1 { return Err("Send one link at a time".into()); }
        crate::binary("yt-dlp")?;
        let mut d = self.engine.data.lock().unwrap();
        // The phone sends a plain link: the current defaults apply, without a clip or a picked stream.
        let mut options = d.options.clone();
        options.clip_start = None;
        options.clip_end = None;
        options.clip_format = "source".into();
        options.format_id.clear();
        options.playlist_items.clear();
        options.validate()?;
        let old = d.clone();
        let count = crate::queue_urls(&mut d, urls, &options, None, true);
        if let Err(e) = crate::save(&self.engine.dir, &d) { *d = old; return Err(e); }
        Ok(count)
    }
    fn inbox(&self) -> PathBuf {
        PathBuf::from(&self.engine.data.lock().unwrap().options.folder).join("Deviload from phone")
    }
    fn received(&self, file: &Path) -> Result<(), String> {
        let mut d = self.engine.data.lock().unwrap();
        let id = d.jobs.iter().map(|j| j.id).max().unwrap_or(0) + 1;
        let options = crate::model::Options { archive: false, ..d.options.clone() };
        let mut job = crate::model::Job { id, url: String::new(), options, status: "done".into(), percent: 100.0,
            speed: String::new(), file: file.to_string_lossy().into_owned(), log: vec![], scheduled_at: None,
            auto_retry: false, retry_attempts: 0, pid: None };
        job.log.push("Received from the phone".into());
        d.jobs.push(job);
        crate::save(&self.engine.dir, &d)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PhoneLink { url: String, public_network: bool }

fn ensure_started(page: PhonePage, engine: &Engine, state: &ShareState, app: &tauri::AppHandle) -> Result<PhoneLink, String> {
    let page = page.checked();
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(hub) = guard.as_mut() {
            hub.page = page;
            return Ok(PhoneLink { url: hub.url.clone(), public_network: hub.public });
        }
    }
    let ip = lan_address()?;
    let mut pairing = load_pairing(&engine.dir);
    // A listener that was just stopped may hold the saved port for a moment.
    let saved = (pairing.port != 0).then(|| (0..5).find_map(|attempt| {
        if attempt > 0 { thread::sleep(Duration::from_millis(120)); }
        TcpListener::bind((ip, pairing.port)).ok()
    })).flatten();
    let listener = saved.map_or_else(|| TcpListener::bind((ip, 0)), Ok)
        .map_err(|e| format!("Could not start the local network transfer: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    pairing.port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let _ = fs::write(pairing_file(&engine.dir), serde_json::to_vec(&pairing).unwrap_or_default());
    let url = format!("http://{ip}:{}/p/{}", pairing.port, pairing.token);
    let host: Arc<dyn PhoneHost> = Arc::new(AppHost { app: app.clone(), engine: engine.clone() });
    let public = public_network(ip);
    let session = rand::rng().next_u64();
    *state.0.lock().map_err(|e| e.to_string())? = Some(Hub { token: pairing.token.clone(), session, url: url.clone(), public, page, host,
        files: vec![], offers: vec![], device: String::new(), seen: None, started: Instant::now(), links: vec![], next_id: 1 });
    let share = state.clone();
    let shutdown = engine.shutdown.clone();
    let token = pairing.token;
    let current = move |share: &ShareState| share.0.lock().ok().is_some_and(|hub| hub.as_ref().is_some_and(|hub| hub.session == session));
    let idle_app = app.clone();
    thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) && current(&share) {
            let stopped = share.0.lock().ok().is_some_and(|mut hub| {
                let idle = hub.as_ref().is_some_and(|hub| hub.session == session && hub.idle());
                if idle { *hub = None; }
                idle
            });
            if stopped { let _ = idle_app.emit("phone-stopped", "idle"); break; }
            match listener.accept() {
                Ok((stream, _)) => {
                    let share = share.clone();
                    let token = token.clone();
                    thread::spawn(move || { let _ = serve(stream, &share, &token); });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(150)),
                Err(_) => break,
            }
        }
    });
    Ok(PhoneLink { url, public_network: public })
}

#[tauri::command]
pub(super) fn phone_start(page: PhonePage, engine: tauri::State<'_, Engine>, state: tauri::State<'_, ShareState>, app: tauri::AppHandle) -> Result<PhoneLink, String> {
    ensure_started(page, &engine, &state, &app)
}

#[tauri::command]
pub(super) fn phone_send(id: u64, page: PhonePage, engine: tauri::State<'_, Engine>, state: tauri::State<'_, ShareState>, app: tauri::AppHandle) -> Result<PhoneLink, String> {
    let file = completed_media(&engine, id)?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let name = file.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let link = ensure_started(page, &engine, &state, &app)?;
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let hub = guard.as_mut().ok_or("The phone link is off")?;
    hub.files.retain(|item| item.path != file);
    let id = hub.next_id;
    hub.next_id += 1;
    hub.started = Instant::now();
    hub.files.insert(0, Outgoing { id, path: file, name, size, sent: Arc::new(AtomicU64::new(0)), done: Arc::new(AtomicBool::new(false)) });
    hub.files.truncate(MAX_FILES);
    Ok(link)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileView { id: u64, name: String, size: u64, sent: u64, done: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OfferView { id: u64, name: String, size: u64, state: OfferState, received: u64, device: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PhoneStatus { url: String, device: String, connected: bool, files: Vec<FileView>, offers: Vec<OfferView> }

fn file_views(hub: &Hub) -> Vec<FileView> {
    hub.files.iter().map(|f| FileView { id: f.id, name: f.name.clone(), size: f.size,
        sent: f.sent.load(Ordering::Relaxed).min(f.size), done: f.done.load(Ordering::Relaxed) }).collect()
}
fn offer_views(hub: &Hub) -> Vec<OfferView> {
    hub.offers.iter().map(|o| OfferView { id: o.id, name: o.name.clone(), size: o.size, state: o.state,
        received: o.received.load(Ordering::Relaxed).min(o.size), device: o.device.clone() }).collect()
}

#[tauri::command]
pub(super) fn phone_status(state: tauri::State<'_, ShareState>) -> Option<PhoneStatus> {
    let guard = state.0.lock().ok()?;
    let hub = guard.as_ref()?;
    Some(PhoneStatus { url: hub.url.clone(), device: hub.device.clone(),
        connected: hub.seen.is_some_and(|seen| seen.elapsed() < Duration::from_secs(12)),
        files: file_views(hub), offers: offer_views(hub) })
}

#[tauri::command]
pub(super) fn phone_answer(id: u64, accept: bool, state: tauri::State<'_, ShareState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let offer = guard.as_mut().and_then(|hub| hub.offers.iter_mut().find(|o| o.id == id)).ok_or("The phone cancelled this file")?;
    if offer.state == OfferState::Waiting { offer.state = if accept { OfferState::Accepted } else { OfferState::Declined }; }
    Ok(())
}

#[tauri::command]
pub(super) fn phone_stop(state: tauri::State<'_, ShareState>) {
    *state.0.lock().unwrap() = None;
}

// A new token makes every old QR code, bookmark and home-screen icon stop working.
#[tauri::command]
pub(super) fn phone_forget(engine: tauri::State<'_, Engine>, state: tauri::State<'_, ShareState>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    match fs::remove_file(pairing_file(&engine.dir)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn html_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        .replace('"', "&quot;").replace('\'', "&#39;")
}

fn encoded_name(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(byte) { encoded.push(*byte as char); }
        else { encoded.push_str(&format!("%{byte:02X}")); }
    }
    encoded
}

fn media_type(file: &Path) -> &'static str {
    match file.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => "video/mp4", "webm" => "video/webm", "mov" => "video/quicktime", "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg", "m4a" => "audio/mp4", "ogg" | "opus" => "audio/ogg", "wav" => "audio/wav", "flac" => "audio/flac", "aac" => "audio/aac", "gif" => "image/gif", _ => "application/octet-stream",
    }
}

// Keeps the name readable but never a path, a device name or something Windows refuses.
fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base.chars().filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c)).take(120).collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if cleaned.is_empty() { "file".into() } else if reserved { format!("_{cleaned}") } else { cleaned }
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() { return candidate; }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (2..10_000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(candidate)
}

fn device_name(agent: &str) -> String {
    let lower = agent.to_ascii_lowercase();
    for (needle, name) in [("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"), ("windows", "Windows"), ("mac os", "Mac")] {
        if lower.contains(needle) { return name.into(); }
    }
    "Browser".into()
}

fn range_for(header: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = header else { return Ok(None); };
    let spec = value.strip_prefix("bytes=").ok_or(())?;
    if size == 0 || spec.contains(',') { return Err(()); }
    let (start, end) = spec.split_once('-').ok_or(())?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 { return Err(()); }
        (size.saturating_sub(suffix), size - 1)
    } else {
        let start = start.parse::<u64>().map_err(|_| ())?;
        let end = if end.is_empty() { size - 1 } else { end.parse::<u64>().map_err(|_| ())?.min(size - 1) };
        (start, end)
    };
    if start >= size || end < start { return Err(()); }
    Ok(Some((start, end)))
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, bytes: &[u8]) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", bytes.len())?;
    stream.write_all(bytes)
}

fn respond_json(stream: &mut TcpStream, status: &str, value: serde_json::Value) -> std::io::Result<()> {
    respond(stream, status, "application/json", value.to_string().as_bytes())
}

struct Request { method: String, path: String, range: Option<String>, length: Option<u64>, agent: String }

fn read_request(reader: &mut BufReader<TcpStream>) -> std::io::Result<Option<Request>> {
    let mut line = String::new();
    reader.read_line(&mut line)?;
    if line.len() > 2048 { return Ok(None); }
    let parts: Vec<_> = line.split_whitespace().collect();
    if parts.len() != 3 { return Ok(None); }
    let mut request = Request { method: parts[0].to_owned(), path: parts[1].to_owned(), range: None, length: None, agent: String::new() };
    for _ in 0..60 {
        line.clear();
        reader.read_line(&mut line)?;
        if line == "\r\n" || line == "\n" || line.is_empty() { break; }
        if line.len() > 8192 { return Ok(None); }
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim().to_owned();
        match name.trim().to_ascii_lowercase().as_str() {
            "range" => request.range = Some(value),
            "content-length" => request.length = value.parse().ok(),
            "user-agent" => request.agent = value.chars().take(300).collect(),
            _ => {}
        }
    }
    Ok(Some(request))
}

fn read_json(reader: &mut BufReader<TcpStream>, length: Option<u64>) -> Option<serde_json::Value> {
    let length = length.filter(|length| *length <= 4096)?;
    let mut body = Vec::new();
    reader.by_ref().take(length).read_to_end(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

fn serve(stream: TcpStream, state: &ShareState, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    let mut reader = BufReader::new(stream);
    let Some(request) = read_request(&mut reader)? else { return Ok(()) };
    let root = format!("/p/{token}");
    let Some(route) = request.path.strip_prefix(&root).map(str::to_owned) else {
        return respond(reader.get_mut(), "404 Not Found", "text/plain; charset=utf-8", b"Not found");
    };
    let device = device_name(&request.agent);
    let Some(host) = state.with(token, |hub| {
        hub.seen = Some(Instant::now());
        hub.device = device.clone();
        hub.host.clone()
    }) else {
        return respond(reader.get_mut(), "410 Gone", "text/plain; charset=utf-8", b"The phone link is off. Turn it on in Deviload.");
    };
    match (request.method.as_str(), route.as_str()) {
        ("GET", "" | "/") => {
            let page = state.with(token, |hub| phone_page(&root, &hub.page)).unwrap_or_default();
            respond(reader.get_mut(), "200 OK", "text/html; charset=utf-8", page.as_bytes())
        }
        ("GET", "/manifest.webmanifest") => {
            let manifest = serde_json::json!({"name": "Deviload", "short_name": "Deviload", "start_url": root, "scope": root,
                "display": "standalone", "background_color": "#101317", "theme_color": "#101317",
                "icons": [{"src": format!("{root}/icon.png"), "sizes": "128x128", "type": "image/png"}]});
            respond(reader.get_mut(), "200 OK", "application/manifest+json", manifest.to_string().as_bytes())
        }
        ("GET", "/icon.png") => respond(reader.get_mut(), "200 OK", "image/png", include_bytes!("../icons/128x128.png")),
        ("GET", route) if route.starts_with("/mascot/") => {
            let image: Option<&[u8]> = match route {
                "/mascot/front.png" => Some(include_bytes!("../../src/assets/mascot/front.png")),
                "/mascot/look.png" => Some(include_bytes!("../../src/assets/mascot/look.png")),
                "/mascot/working.png" => Some(include_bytes!("../../src/assets/mascot/working.png")),
                "/mascot/victory.png" => Some(include_bytes!("../../src/assets/mascot/victory.png")),
                "/mascot/error.png" => Some(include_bytes!("../../src/assets/mascot/error.png")),
                _ => None,
            };
            match image {
                Some(bytes) => respond(reader.get_mut(), "200 OK", "image/png", bytes),
                None => respond(reader.get_mut(), "404 Not Found", "text/plain; charset=utf-8", b"Not found"),
            }
        }
        ("GET", "/state") => {
            let body = state.with(token, |hub| serde_json::json!({"files": file_views(hub), "offers": offer_views(hub)})).unwrap_or_default();
            respond_json(reader.get_mut(), "200 OK", body)
        }
        ("POST", "/offer") => {
            let body = read_json(&mut reader, request.length);
            let name = body.as_ref().and_then(|b| b["name"].as_str()).map(safe_name);
            let size = body.as_ref().and_then(|b| b["size"].as_u64()).filter(|size| (1..=MAX_UPLOAD).contains(size));
            let (Some(name), Some(size)) = (name, size) else {
                return respond_json(reader.get_mut(), "400 Bad Request", serde_json::json!({"error": "bad offer"}));
            };
            let offer = state.with(token, |hub| {
                if hub.offers.iter().filter(|o| o.state == OfferState::Waiting).count() >= MAX_WAITING_OFFERS { return None; }
                let offer = Offer { id: hub.next_id, name, size, state: OfferState::Waiting, received: Arc::new(AtomicU64::new(0)), device: device.clone() };
                hub.next_id += 1;
                hub.offers.insert(0, offer.clone());
                hub.offers.truncate(MAX_FILES);
                Some(offer)
            }).flatten();
            let Some(offer) = offer else {
                return respond_json(reader.get_mut(), "429 Too Many Requests", serde_json::json!({"error": "busy"}));
            };
            host.emit("phone-offer", serde_json::json!({"id": offer.id, "name": offer.name, "size": offer.size, "device": device}));
            respond_json(reader.get_mut(), "200 OK", serde_json::json!({"id": offer.id}))
        }
        ("POST", "/link") => {
            let url = read_json(&mut reader, request.length).and_then(|b| b["url"].as_str().map(str::to_owned));
            let allowed = state.with(token, |hub| {
                hub.links.retain(|at| at.elapsed() < Duration::from_secs(60));
                if hub.links.len() >= LINKS_PER_MINUTE { return false; }
                hub.links.push(Instant::now());
                true
            }).unwrap_or(false);
            let result = match (url, allowed) {
                (Some(url), true) => host.queue_link(&url).map(|count| (url, count)),
                (None, _) => Err("Send one link at a time".into()),
                (_, false) => Err("Too many links in a minute".into()),
            };
            match result {
                Ok((url, count)) => {
                    host.emit("phone-link", serde_json::json!({"url": url, "count": count}));
                    respond_json(reader.get_mut(), "200 OK", serde_json::json!({"count": count}))
                }
                Err(error) => respond_json(reader.get_mut(), "400 Bad Request", serde_json::json!({"error": error})),
            }
        }
        ("POST", route) if route.starts_with("/upload/") => {
            let id = route["/upload/".len()..].parse::<u64>().unwrap_or(0);
            receive(reader, state, token, id, request.length, host)
        }
        ("GET" | "HEAD", route) if route.starts_with("/file/") || route.starts_with("/media/") => {
            let download = route.starts_with("/file/");
            let id = route.rsplit('/').next().and_then(|id| id.parse::<u64>().ok()).unwrap_or(0);
            let Some(file) = state.with(token, |hub| hub.files.iter().find(|f| f.id == id).cloned()).flatten() else {
                return respond(reader.get_mut(), "404 Not Found", "text/plain; charset=utf-8", b"Not found");
            };
            send_file(reader.get_mut(), state, token, &file, download, request.method == "HEAD", request.range.as_deref())
        }
        _ => respond(reader.get_mut(), "404 Not Found", "text/plain; charset=utf-8", b"Not found"),
    }
}

fn send_file(stream: &mut TcpStream, state: &ShareState, token: &str, file: &Outgoing, download: bool, head: bool, range: Option<&str>) -> std::io::Result<()> {
    let bounds = match range_for(range, file.size) {
        Ok(value) => value,
        Err(()) => { write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", file.size)?; return Ok(()); }
    };
    if download && bounds.is_none_or(|(start, _)| start == 0) { file.sent.store(0, Ordering::Relaxed); file.done.store(false, Ordering::Relaxed); }
    let (start, end) = bounds.unwrap_or((0, file.size.saturating_sub(1)));
    let length = if file.size == 0 { 0 } else { end - start + 1 };
    let status = if bounds.is_some() { "206 Partial Content" } else { "200 OK" };
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n", media_type(&file.path))?;
    if bounds.is_some() { write!(stream, "Content-Range: bytes {start}-{end}/{}\r\n", file.size)?; }
    if download { write!(stream, "Content-Disposition: attachment; filename=\"deviload-download\"; filename*=UTF-8''{}\r\n", encoded_name(&file.name))?; }
    stream.write_all(b"\r\n")?;
    if head { return Ok(()); }
    let mut source = File::open(&file.path)?;
    source.seek(SeekFrom::Start(start))?;
    let mut remaining = length;
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 && state.with(token, |_| ()).is_some() {
        let chunk = buffer.len().min(remaining as usize);
        let read = source.read(&mut buffer[..chunk])?;
        if read == 0 { break; }
        stream.write_all(&buffer[..read])?;
        remaining -= read as u64;
        if download { file.sent.fetch_add(read as u64, Ordering::Relaxed); }
    }
    if download && remaining == 0 { file.done.store(true, Ordering::Relaxed); }
    Ok(())
}

fn set_offer(state: &ShareState, token: &str, id: u64, next: OfferState) {
    state.with(token, |hub| if let Some(offer) = hub.offers.iter_mut().find(|o| o.id == id) { offer.state = next; });
}

// Uploads go to a temporary file first; only a complete file gets its real name.
fn receive(mut reader: BufReader<TcpStream>, state: &ShareState, token: &str, id: u64, length: Option<u64>, host: Arc<dyn PhoneHost>) -> std::io::Result<()> {
    let offer = state.with(token, |hub| {
        let offer = hub.offers.iter_mut().find(|o| o.id == id && o.state == OfferState::Accepted)?;
        if length != Some(offer.size) { return None; }
        offer.state = OfferState::Receiving;
        Some(offer.clone())
    }).flatten();
    let Some(offer) = offer else {
        return respond_json(reader.get_mut(), "409 Conflict", serde_json::json!({"error": "not accepted"}));
    };
    let inbox = host.inbox();
    let result = (|| -> Result<PathBuf, String> {
        fs::create_dir_all(&inbox).map_err(|e| e.to_string())?;
        if fs2::available_space(&inbox).map_err(|e| e.to_string())? < offer.size + 64 * 1024 * 1024 {
            return Err("Not enough free space on the computer".into());
        }
        let mut temp = tempfile::NamedTempFile::new_in(&inbox).map_err(|e| e.to_string())?;
        let mut remaining = offer.size;
        let mut buffer = vec![0u8; 256 * 1024];
        while remaining > 0 {
            if state.with(token, |_| ()).is_none() { return Err("The phone link was turned off".into()); }
            let chunk = buffer.len().min(remaining as usize);
            let read = reader.read(&mut buffer[..chunk]).map_err(|e| e.to_string())?;
            if read == 0 { return Err("The phone stopped sending".into()); }
            temp.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            remaining -= read as u64;
            offer.received.fetch_add(read as u64, Ordering::Relaxed);
        }
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        let target = unique_path(&inbox, &offer.name);
        temp.persist_noclobber(&target).map_err(|e| e.to_string())?;
        host.received(&target)?;
        Ok(target)
    })();
    match result {
        Ok(target) => {
            set_offer(state, token, id, OfferState::Done);
            host.emit("phone-received", serde_json::json!({"name": offer.name, "file": target.to_string_lossy()}));
            respond_json(reader.get_mut(), "200 OK", serde_json::json!({"ok": true}))
        }
        Err(error) => {
            set_offer(state, token, id, OfferState::Failed);
            respond_json(reader.get_mut(), "500 Internal Server Error", serde_json::json!({"error": error}))
        }
    }
}

fn phone_page(root: &str, page: &PhonePage) -> String {
    // The strings travel as JSON inside a script; "<" is escaped so no text can close the tag.
    let strings = serde_json::to_string(&page.strings).unwrap_or_else(|_| "{}".into()).replace('<', "\\u003c");
    let heading = html_escape(page.strings.get("heading").map_or("Deviload", String::as_str));
    let lang = &page.lang;
    format!(r##"<!doctype html><html lang="{lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101317"><link rel="manifest" href="{root}/manifest.webmanifest"><link rel="icon" href="{root}/icon.png"><link rel="apple-touch-icon" href="{root}/icon.png"><title>Deviload</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#101317;color:#f4f1ee;font:15px/1.4 system-ui,sans-serif}}main{{max-width:620px;margin:0 auto;padding:18px 16px 40px}}
header{{display:flex;align-items:center;gap:12px;margin:6px 0 18px}}
.mascot{{position:relative;width:64px;height:64px;flex:none;transform-origin:50% 100%}}.mascot img{{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity .22s}}
.mascot[data-pose=front] img[data-pose=front],.mascot[data-pose=look] img[data-pose=look],.mascot[data-pose=working] img[data-pose=working],.mascot[data-pose=victory] img[data-pose=victory],.mascot[data-pose=error] img[data-pose=error]{{opacity:1}}
.mascot[data-pose=front]{{animation:breathe 3.4s ease-in-out infinite}}.mascot[data-pose=look]{{animation:peek 4.2s ease-in-out infinite}}.mascot[data-pose=working]{{animation:work .46s ease-in-out infinite alternate}}
.mascot[data-pose=victory]{{animation:jump .62s cubic-bezier(.3,1.5,.5,1) 3}}.mascot[data-pose=error]{{animation:shake .42s ease-in-out 3}}
@keyframes breathe{{0%,100%{{transform:none}}50%{{transform:translateY(-2px) scale(1.025)}}}}@keyframes peek{{0%,100%{{transform:rotate(-3deg)}}50%{{transform:rotate(3deg)}}}}
@keyframes work{{from{{transform:rotate(-2deg)}}to{{transform:translateY(-4px) rotate(2deg)}}}}@keyframes jump{{0%,100%{{transform:none}}45%{{transform:translateY(-12px) rotate(-4deg)}}}}
@keyframes shake{{0%,100%{{transform:none}}25%{{transform:translateX(-3px) rotate(-3deg)}}75%{{transform:translateX(3px) rotate(3deg)}}}}
@media (prefers-reduced-motion:reduce){{.mascot{{animation:none!important}}}}header b{{display:block;font-size:13px;letter-spacing:.12em;color:#ff9b75}}header span{{font-size:13px;color:#9aa4ac}}
section{{background:#1b2127;border:1px solid #33404a;border-radius:16px;padding:16px;margin:0 0 14px}}h2{{margin:0 0 10px;font-size:16px}}
.item{{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #2a333b}}.item:first-of-type{{border-top:0}}.item div{{flex:1;min-width:0}}.item strong{{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}}.item small{{color:#9aa4ac}}
a.button,button,label.button{{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border:0;border-radius:10px;background:#f27050;color:#17191c;font:700 15px system-ui,sans-serif;text-decoration:none;cursor:pointer}}
.quiet{{background:#2a333b!important;color:#e7ecef!important}}.bar{{height:6px;margin-top:6px;border-radius:6px;background:#303940;overflow:hidden}}.bar i{{display:block;height:100%;width:0;background:linear-gradient(90deg,#f86d45,#ffc07a);transition:width .3s}}
.empty{{color:#9aa4ac;font-size:14px}}input[type=url]{{width:100%;min-height:44px;margin:0 0 10px;padding:0 12px;border:1px solid #3a4650;border-radius:10px;background:#11161a;color:#f4f1ee;font-size:15px}}
#link-result{{margin:8px 0 0;color:#9aa4ac;font-size:14px}}.hint{{color:#7f8a92;font-size:13px;text-align:center}}.offline{{display:none;margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#3a1f1c;color:#ffb4a4}}body.off .offline{{display:block}}
</style>
<main><header><div class="mascot" id="mascot" data-pose="front"><img data-pose="front" src="{root}/mascot/front.png" alt=""><img data-pose="look" src="{root}/mascot/look.png" alt=""><img data-pose="working" src="{root}/mascot/working.png" alt=""><img data-pose="victory" src="{root}/mascot/victory.png" alt=""><img data-pose="error" src="{root}/mascot/error.png" alt=""></div><div><b>DEVILOAD</b><span>{heading}</span></div></header>
<p class="offline" id="offline"></p>
<section><h2 id="t-from"></h2><div id="files"></div></section>
<section><h2 id="t-to"></h2><div id="uploads"></div><label class="button" id="pick-label"><input id="pick" type="file" multiple hidden><span id="t-send"></span></label></section>
<section><h2 id="t-link"></h2><input id="link" type="url" inputmode="url" autocomplete="off"><button id="link-send" type="button"></button><p id="link-result"></p></section>
<p class="hint" id="t-home"></p></main>
<script>
var T={strings},B="{root}",uploads={{}},moodTimer=0;
function $(id){{return document.getElementById(id)}}
function mood(pose,back){{var m=$("mascot");clearTimeout(moodTimer);if(m.dataset.pose!==pose){{m.dataset.pose=pose;m.style.animation="none";void m.offsetWidth;m.style.animation=""}}if(back)moodTimer=setTimeout(function(){{mood(back)}},3200)}}
function busy(){{for(var id in uploads)if(uploads[id].state==="receiving")return true;return false}}
function size(n){{return n<1048576?T.kilobytes.replace("{{size}}",Math.max(1,Math.ceil(n/1024))):T.megabytes.replace("{{size}}",(n/1048576).toFixed(1))}}
function el(tag,cls,text){{var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}}
function bar(share){{var b=el("div","bar"),i=el("i");i.style.width=Math.round(share*100)+"%";b.appendChild(i);return b}}
$("t-from").textContent=T.fromComputer;$("t-to").textContent=T.toComputer;$("t-send").textContent=T.sendFiles;$("t-link").textContent=T.linkTitle;
$("link").placeholder=T.linkPlaceholder;$("link-send").textContent=T.linkButton;$("t-home").textContent=T.homeHint;$("offline").textContent=T.offline;
function render(state){{
  var files=$("files");files.innerHTML="";
  if(!state.files.length)files.appendChild(el("p","empty",T.nothingYet));
  state.files.forEach(function(f){{var row=el("div","item"),text=el("div");text.appendChild(el("strong","",f.name));text.appendChild(el("small","",size(f.size)));
    var a=el("a","button",T.download);a.href=B+"/file/"+f.id;a.setAttribute("download","");row.appendChild(text);row.appendChild(a);files.appendChild(row)}});
  state.offers.forEach(function(o){{var u=uploads[o.id];if(!u)return;u.state=o.state;
    if(o.state==="accepted"&&!u.started)start(o.id);
    paint(o.id)}});
}}
function paint(id){{var u=uploads[id];var label={{waiting:T.waiting,accepted:T.accepted,declined:T.declined,receiving:T.sending,done:T.sent,failed:T.failed}}[u.state]||T.waiting;
  if(u.state==="receiving"&&u.share!=null)label=T.sending+" · "+Math.round(u.share*100)+"%";
  u.row.innerHTML="";var text=el("div");text.appendChild(el("strong","",u.file.name));text.appendChild(el("small","",size(u.file.size)+" · "+label));
  if(u.state==="receiving")text.appendChild(bar(u.share||0));u.row.appendChild(text)}}
function start(id){{var u=uploads[id];u.started=true;u.state="receiving";u.share=0;var x=new XMLHttpRequest();x.open("POST",B+"/upload/"+id);
  x.upload.onprogress=function(e){{if(e.lengthComputable){{u.share=e.loaded/e.total;paint(id)}}}};
  mood("working");
  x.onload=function(){{u.state=x.status===200?"done":"failed";paint(id);if(!busy())mood(u.state==="done"?"victory":"error","front")}};
  x.onerror=function(){{u.state="failed";paint(id);if(!busy())mood("error","front")}};x.send(u.file)}}
$("pick").onchange=function(){{Array.prototype.forEach.call(this.files,function(file){{var row=el("div","item");$("uploads").appendChild(row);
  fetch(B+"/offer",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{name:file.name,size:file.size}})}})
  .then(function(r){{return r.json()}}).then(function(j){{if(!j.id)throw 0;uploads[j.id]={{file:file,row:row,state:"waiting"}};paint(j.id)}})
  .catch(function(){{row.textContent=file.name+" · "+T.failed}})}});this.value=""}};
$("link-send").onclick=function(){{var v=$("link").value.trim();if(!v)return;
  fetch(B+"/link",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{url:v}})}}).then(function(r){{return r.json()}})
  .then(function(j){{$("link-result").textContent=j.error?T.failed:T.linkAdded;if(!j.error){{$("link").value="";mood("victory","front")}}else mood("error","front")}}).catch(function(){{$("link-result").textContent=T.offline}})}};
function poll(){{fetch(B+"/state",{{cache:"no-store"}}).then(function(r){{if(!r.ok)throw 0;return r.json()}}).then(function(s){{document.body.classList.remove("off");render(s)}})
  .catch(function(){{document.body.classList.add("off");if(!busy())mood("look")}}).then(function(){{setTimeout(poll,document.hidden?6000:1500)}})}}
poll();
</script></html>"##)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct TestHost { dir: PathBuf, events: Mutex<Vec<String>>, links: Mutex<Vec<String>>, files: Mutex<Vec<PathBuf>> }
    impl PhoneHost for TestHost {
        fn emit(&self, event: &str, _payload: serde_json::Value) { self.events.lock().unwrap().push(event.into()); }
        fn queue_link(&self, url: &str) -> Result<usize, String> {
            if crate::model::parse_urls(url)?.len() != 1 { return Err("Send one link at a time".into()); }
            self.links.lock().unwrap().push(url.into());
            Ok(1)
        }
        fn inbox(&self) -> PathBuf { self.dir.join("Deviload from phone") }
        fn received(&self, file: &Path) -> Result<(), String> { self.files.lock().unwrap().push(file.into()); Ok(()) }
    }

    fn hub(host: Arc<TestHost>, files: Vec<Outgoing>) -> ShareState {
        let state = ShareState::default();
        *state.0.lock().unwrap() = Some(Hub { token: "secret".into(), session: 1, url: String::new(), public: false, started: Instant::now(),
            page: PhonePage { lang: "en".into(), strings: HashMap::new() }.checked(), host, files, offers: vec![],
            device: String::new(), seen: None, links: vec![], next_id: 10 });
        state
    }

    fn exchange(state: &ShareState, request: &[u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server_state = state.clone();
        let server = thread::spawn(move || { let (stream, _) = listener.accept().unwrap(); serve(stream, &server_state, "secret").unwrap(); });
        let mut client = TcpStream::connect(address).unwrap();
        client.write_all(request).unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).unwrap();
        server.join().unwrap();
        String::from_utf8_lossy(&response).into_owned()
    }

    fn post(path: &str, body: &str) -> Vec<u8> {
        format!("POST /p/secret{path} HTTP/1.1\r\nUser-Agent: Mozilla/5.0 (Linux; Android 14)\r\nContent-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
    }

    #[test]
    fn ranges_are_bounded() {
        assert_eq!(range_for(Some("bytes=3-9"), 8), Ok(Some((3, 7))));
        assert_eq!(range_for(Some("bytes=-2"), 8), Ok(Some((6, 7))));
        assert_eq!(range_for(Some("bytes=8-"), 8), Err(()));
    }

    #[test]
    fn sent_files_stream_by_range_and_stop_with_the_link() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"abcdefgh").unwrap();
        let outgoing = Outgoing { id: 3, path: file.path().to_path_buf(), name: "clip.mp4".into(), size: 8,
            sent: Arc::new(AtomicU64::new(0)), done: Arc::new(AtomicBool::new(false)) };
        let state = hub(Arc::new(TestHost::default()), vec![outgoing.clone()]);
        let response = exchange(&state, b"GET /p/secret/media/3 HTTP/1.1\r\nRange: bytes=2-4\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 206 Partial Content") && response.ends_with("\r\ncde"), "{response}");
        let response = exchange(&state, b"GET /p/secret/file/3 HTTP/1.1\r\n\r\n");
        assert!(response.contains("filename*=UTF-8''clip.mp4") && response.ends_with("\r\nabcdefgh"));
        assert!(exchange(&state, b"GET /p/secret/mascot/victory.png HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 200 OK\r\nContent-Type: image/png"));
        assert!(exchange(&state, b"GET /p/secret/mascot/../../x.png HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
        assert!(outgoing.done.load(Ordering::Relaxed));
        assert!(exchange(&state, b"GET /p/other/state HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
        *state.0.lock().unwrap() = None;
        assert!(exchange(&state, b"GET /p/secret/file/3 HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 410 Gone"));
    }

    #[test]
    fn uploads_need_the_computer_to_accept_first() {
        let dir = tempfile::tempdir().unwrap();
        let host = Arc::new(TestHost { dir: dir.path().into(), ..TestHost::default() });
        let state = hub(host.clone(), vec![]);
        let response = exchange(&state, &post("/offer", r#"{"name":"../../evil<1>.mp4","size":5}"#));
        assert!(response.ends_with(r#"{"id":10}"#), "{response}");
        assert_eq!(state.0.lock().unwrap().as_ref().unwrap().device, "Android");
        assert_eq!(*host.events.lock().unwrap(), ["phone-offer"]);
        // Not accepted yet: nothing is written.
        assert!(exchange(&state, &post("/upload/10", "hello")).starts_with("HTTP/1.1 409"));
        set_offer(&state, "secret", 10, OfferState::Accepted);
        assert!(exchange(&state, &post("/upload/10", "hel")).starts_with("HTTP/1.1 409"), "a wrong size is refused");
        let response = exchange(&state, &post("/upload/10", "hello"));
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        let saved = dir.path().join("Deviload from phone").join("evil1.mp4");
        assert_eq!(fs::read(&saved).unwrap(), b"hello");
        assert_eq!(*host.files.lock().unwrap(), [saved]);
        assert_eq!(state.0.lock().unwrap().as_ref().unwrap().offers[0].state, OfferState::Done);
        let again = exchange(&state, &post("/offer", r#"{"name":"evil1.mp4","size":2}"#));
        assert!(again.ends_with(r#"{"id":11}"#));
        set_offer(&state, "secret", 11, OfferState::Accepted);
        exchange(&state, &post("/upload/11", "hi"));
        assert!(dir.path().join("Deviload from phone").join("evil1 (2).mp4").is_file());
        assert!(exchange(&state, &post("/offer", r#"{"name":"x","size":0}"#)).starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn links_from_the_phone_join_the_queue_with_a_limit() {
        let host = Arc::new(TestHost::default());
        let state = hub(host.clone(), vec![]);
        let response = exchange(&state, &post("/link", r#"{"url":"https://www.youtube.com/watch?v=abc"}"#));
        assert!(response.ends_with(r#"{"count":1}"#), "{response}");
        assert!(exchange(&state, &post("/link", r#"{"url":"ftp://example.com/x"}"#)).starts_with("HTTP/1.1 400"));
        for _ in 0..LINKS_PER_MINUTE { exchange(&state, &post("/link", r#"{"url":"https://example.com/v"}"#)); }
        assert!(exchange(&state, &post("/link", r#"{"url":"https://example.com/v"}"#)).contains("Too many links"));
        assert_eq!(host.links.lock().unwrap()[0], "https://www.youtube.com/watch?v=abc");
    }

    #[test]
    fn the_phone_page_escapes_every_string() {
        let mut strings = HashMap::new();
        strings.insert("heading".to_string(), "</script><b>".to_string());
        let page = phone_page("/p/secret", &PhonePage { lang: "en".into(), strings }.checked());
        assert!(!page.contains("</script><b>"));
        assert!(page.contains("&lt;/script&gt;&lt;b&gt;") && page.contains("\\u003c/script>\\u003cb>"));
    }

    #[test]
    fn the_link_turns_off_only_when_idle() {
        let state = hub(Arc::new(TestHost::default()), vec![]);
        let mut guard = state.0.lock().unwrap();
        let hub = guard.as_mut().unwrap();
        assert!(!hub.idle());
        hub.started = Instant::now() - IDLE_OFF - Duration::from_secs(1);
        assert!(hub.idle());
        hub.seen = Some(Instant::now());
        assert!(!hub.idle(), "a recent phone request keeps it on");
        hub.seen = Some(Instant::now() - IDLE_OFF - Duration::from_secs(1));
        hub.offers.push(Offer { id: 1, name: "a".into(), size: 1, state: OfferState::Receiving, received: Arc::new(AtomicU64::new(0)), device: String::new() });
        assert!(!hub.idle(), "a running upload keeps it on");
    }

    #[test]
    fn names_are_safe_on_windows() {
        assert_eq!(safe_name("..\\..\\a:b?.mp4"), "ab.mp4");
        assert_eq!(safe_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_name("COM1"), "_COM1");
        assert_eq!(safe_name("  ...  "), "file");
        assert_eq!(safe_name("Clip. "), "Clip");
        assert_eq!(html_escape("<a&b>"), "&lt;a&amp;b&gt;");
        assert_eq!(encoded_name("Café clip.mp4"), "Caf%C3%A9%20clip.mp4");
        assert_eq!(device_name("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "iPhone");
    }
}
