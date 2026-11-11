//! Casting Devil Music to a TV or speaker at home: DLNA (UPnP AV) renderers and Chromecast devices.
//! The device fetches the song from a small server on this computer's home-network address. That server answers
//! only for the song being cast, under a random path, and stops when casting ends. Devices are found on the
//! local network only; nothing about them leaves it.
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, mpsc, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

const NOT_FOUND: &str = "The device is no longer available. Look for devices again.";
const UNSUPPORTED: &str = "This song cannot be cast.";
const FAILED: &str = "The device did not accept the song.";
const NOT_CASTING: &str = "Nothing is being cast.";

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Device {
    id: String,
    name: String,
    kind: &'static str,
    #[serde(skip)] host: String,
    #[serde(skip)] control: String,
    #[serde(skip)] service: String,
    #[serde(skip)] rendering: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Status { device: String, state: String, position: f64, duration: f64, error: bool }

fn known() -> &'static Mutex<HashMap<String, Device>> { static DEVICES: OnceLock<Mutex<HashMap<String, Device>>> = OnceLock::new(); DEVICES.get_or_init(Default::default) }
fn private(ip: &IpAddr) -> bool { matches!(ip, IpAddr::V4(v4) if v4.is_private() || v4.is_link_local()) }
fn token() -> String { let mut b = [0u8; 16]; rand::rng().fill_bytes(&mut b); b.iter().map(|x| format!("{x:02x}")).collect() }
fn lan() -> Result<Ipv4Addr, String> { match crate::share::lan_address()? { IpAddr::V4(ip) => Ok(ip), _ => Err("This computer is not connected to a home network.".into()) } }
fn client() -> Result<reqwest::blocking::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    // Devices sit on the home network: never through the proxy from the settings.
    reqwest::blocking::Client::builder().no_proxy().connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(5)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())
}

// ---------- Minimal XML reading for device descriptions and SOAP answers ----------

fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    // Matches <name>, <prefix:name> and <name attr="…">.
    let mut from = 0;
    while let Some(start) = xml[from..].find('<').map(|i| i + from) {
        let end = xml[start..].find('>')? + start;
        let head = &xml[start + 1..end];
        let local = head.split_whitespace().next().unwrap_or("").rsplit(':').next().unwrap_or("");
        if local == name && !head.starts_with('/') && !head.ends_with('/') {
            let rest = &xml[end + 1..];
            let mut at = 0;
            loop {
                let i = rest[at..].find("</")? + at;
                let j = rest[i..].find('>')? + i;
                if rest[i + 2..j].rsplit(':').next() == Some(name) { return Some(rest[..i].trim()); }
                at = j + 1;
            }
        }
        from = end + 1;
    }
    None
}
fn blocks<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let (open, close) = (format!("<{name}>"), format!("</{name}>"));
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        let Some(end) = after.find(&close) else { break };
        out.push(&after[..end]);
        rest = &after[end + close.len()..];
    }
    out
}
fn unescape(text: &str) -> String { text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&") }
fn escape(text: &str) -> String { text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;") }

/// A renderer from its description: its name and the AVTransport and RenderingControl control addresses.
fn renderer(location: &str, xml: &str) -> Option<Device> {
    let base = url::Url::parse(tag(xml, "URLBase").filter(|b| !b.is_empty()).unwrap_or(location)).ok()?;
    let name = unescape(tag(xml, "friendlyName").unwrap_or("Media renderer")).chars().filter(|c| !c.is_control()).take(80).collect::<String>();
    let mut transport = None;
    let mut rendering = String::new();
    for service in blocks(xml, "service") {
        let kind = tag(service, "serviceType").unwrap_or("");
        let control = base.join(tag(service, "controlURL").unwrap_or("")).ok()?;
        if control.host_str() != base.host_str() { continue; }
        if kind.starts_with("urn:schemas-upnp-org:service:AVTransport:") { transport = Some((control.to_string(), kind.to_string())); }
        if kind.starts_with("urn:schemas-upnp-org:service:RenderingControl:") { rendering = control.to_string(); }
    }
    let (control, service) = transport?;
    let udn = tag(xml, "UDN").unwrap_or(location);
    Some(Device { id: format!("dlna:{udn}"), name, kind: "dlna", host: base.host_str()?.to_string(), control, service, rendering })
}

fn ssdp(ip: Ipv4Addr, wait: Duration) -> Vec<String> {
    let Ok(socket) = UdpSocket::bind((ip, 0)) else { return vec![] };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
    let search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
    for _ in 0..2 { let _ = socket.send_to(search.as_bytes(), "239.255.255.250:1900"); }
    let (deadline, mut found, mut buf) = (Instant::now() + wait, Vec::new(), [0u8; 2048]);
    while Instant::now() < deadline {
        let Ok((n, from)) = socket.recv_from(&mut buf) else { continue };
        if !private(&from.ip()) { continue; }
        let text = String::from_utf8_lossy(&buf[..n]);
        let Some(location) = text.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("location")).map(|(_, v)| v.trim().to_string())) else { continue };
        // Only a description on the device that answered: an answer cannot send this computer elsewhere.
        let same = url::Url::parse(&location).ok().and_then(|u| u.host_str().map(str::to_owned)) == Some(from.ip().to_string());
        if same && !found.contains(&location) { found.push(location); }
    }
    found
}

// ---------- mDNS (Chromecast discovery) ----------

fn dns_name(packet: &[u8], mut at: usize) -> Option<(String, usize)> {
    let (mut labels, mut end, mut jumps) = (Vec::new(), None, 0);
    loop {
        let len = *packet.get(at)? as usize;
        if len == 0 { at += 1; break; }
        if len & 0xc0 == 0xc0 {
            let pointer = ((len & 0x3f) << 8) | *packet.get(at + 1)? as usize;
            end.get_or_insert(at + 2);
            jumps += 1;
            if jumps > 16 { return None; }
            at = pointer;
            continue;
        }
        labels.push(String::from_utf8_lossy(packet.get(at + 1..at + 1 + len)?).into_owned());
        at += 1 + len;
    }
    Some((labels.join("."), end.unwrap_or(at)))
}

/// Chromecast devices in one mDNS answer: name from the TXT record, address from A or the sender.
fn cast_devices(packet: &[u8], sender: IpAddr) -> Vec<Device> {
    let count = |i: usize| packet.get(i..i + 2).map(|b| u16::from_be_bytes([b[0], b[1]]) as usize).unwrap_or(0);
    if packet.len() < 12 { return vec![]; }
    let (questions, records) = (count(4), count(6) + count(8) + count(10));
    let mut at = 12;
    for _ in 0..questions { let Some((_, next)) = dns_name(packet, at) else { return vec![] }; at = next + 4; }
    let (mut ptr, mut srv, mut txt, mut addr) = (Vec::new(), HashMap::new(), HashMap::new(), HashMap::new());
    for _ in 0..records {
        let Some((name, next)) = dns_name(packet, at) else { break };
        let Some(head) = packet.get(next..next + 10) else { break };
        let kind = u16::from_be_bytes([head[0], head[1]]);
        let length = u16::from_be_bytes([head[8], head[9]]) as usize;
        let start = next + 10;
        let Some(data) = packet.get(start..start + length) else { break };
        match kind {
            12 if name.eq_ignore_ascii_case("_googlecast._tcp.local") => { if let Some((target, _)) = dns_name(packet, start) { ptr.push(target); } }
            33 if data.len() > 6 => { if let Some((target, _)) = dns_name(packet, start + 6) { srv.insert(name.to_ascii_lowercase(), (u16::from_be_bytes([data[4], data[5]]), target.to_ascii_lowercase())); } }
            16 => {
                let mut fields = HashMap::new();
                let mut i = 0;
                while i < data.len() { let n = data[i] as usize; if let Some(item) = data.get(i + 1..i + 1 + n) { if let Some((k, v)) = String::from_utf8_lossy(item).split_once('=') { fields.insert(k.to_string(), v.to_string()); } } i += 1 + n; }
                txt.insert(name.to_ascii_lowercase(), fields);
            }
            1 if data.len() == 4 => { addr.insert(name.to_ascii_lowercase(), IpAddr::V4(Ipv4Addr::new(data[0], data[1], data[2], data[3]))); }
            _ => {}
        }
        at = start + length;
    }
    ptr.into_iter().filter_map(|instance| {
        let key = instance.to_ascii_lowercase();
        let (port, target) = srv.get(&key).cloned().unwrap_or((8009, String::new()));
        let ip = addr.get(&target).copied().unwrap_or(sender);
        if !private(&ip) { return None; }
        let fields = txt.get(&key);
        let name = fields.and_then(|f| f.get("fn")).cloned().unwrap_or_else(|| instance.split("._googlecast").next().unwrap_or("Chromecast").to_string());
        let name: String = name.chars().filter(|c| !c.is_control()).take(80).collect();
        Some(Device { id: format!("cast:{ip}:{port}"), name, kind: "cast", host: format!("{ip}:{port}"), control: String::new(), service: String::new(), rendering: String::new() })
    }).collect()
}

fn mdns(ip: Ipv4Addr, wait: Duration) -> Vec<Device> {
    let Ok(socket) = UdpSocket::bind((ip, 0)) else { return vec![] };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
    let mut query = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    for label in ["_googlecast", "_tcp", "local"] { query.push(label.len() as u8); query.extend_from_slice(label.as_bytes()); }
    // PTR question, class IN with the unicast-response bit: answers come straight back to this socket.
    query.extend_from_slice(&[0, 0, 12, 0x80, 1]);
    for _ in 0..2 { let _ = socket.send_to(&query, "224.0.0.251:5353"); }
    let (deadline, mut found, mut buf) = (Instant::now() + wait, Vec::<Device>::new(), [0u8; 9000]);
    while Instant::now() < deadline {
        let Ok((n, from)) = socket.recv_from(&mut buf) else { continue };
        for device in cast_devices(&buf[..n], from.ip()) { if !found.iter().any(|d| d.id == device.id) { found.push(device); } }
    }
    found
}

#[tauri::command]
pub async fn music_cast_devices(window: tauri::WebviewWindow) -> Result<Vec<Device>, String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    tauri::async_runtime::spawn_blocking(|| {
        let ip = lan()?;
        let wait = Duration::from_millis(2600);
        let casts = thread::spawn(move || mdns(ip, wait));
        let mut devices = Vec::new();
        if let Ok(client) = client() {
            for location in ssdp(ip, wait) {
                let Ok(response) = client.get(&location).send() else { continue };
                let Ok(text) = response.text() else { continue };
                if let Some(device) = renderer(&location, &text) { if !devices.iter().any(|d: &Device| d.id == device.id) { devices.push(device); } }
            }
        }
        devices.extend(casts.join().unwrap_or_default());
        let mut map = known().lock().unwrap();
        for device in &devices { map.insert(device.id.clone(), device.clone()); }
        Ok(devices)
    }).await.map_err(|e| e.to_string())?
}

// ---------- The song server on the home network ----------

#[derive(Clone, Debug, PartialEq)]
enum Source { Proxy(String), File(PathBuf) }
struct Song { source: Source, mime: String, path: String }
struct Server { address: SocketAddr, token: String, song: Mutex<Option<Song>>, stopped: AtomicBool, active: AtomicUsize }

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mp3") => "audio/mpeg", Some("flac") => "audio/flac", Some("wav") => "audio/wav", Some("ogg" | "opus") => "audio/ogg",
        Some("webm") => "audio/webm", Some("aiff" | "aif") => "audio/aiff", _ => "audio/mp4",
    }
}

/// Only this app's own local audio servers may be proxied to the home network.
fn local_source(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let ports = [crate::music_engine::local_port(), crate::music_audio::relay_port()];
    (parsed.scheme() == "http" && parsed.host_str() == Some("127.0.0.1") && parsed.username().is_empty() && parsed.password().is_none()
        && ports.contains(&parsed.port())).then(|| parsed.to_string())
}

fn range(header: Option<&str>, size: u64) -> Option<(u64, u64)> {
    let spec = header?.strip_prefix("bytes=")?;
    if spec.contains(',') || size == 0 { return None; }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() { let n: u64 = b.parse().ok()?; (size.saturating_sub(n), size - 1) } else { (a.parse().ok()?, if b.is_empty() { size - 1 } else { b.parse::<u64>().ok()?.min(size - 1) }) };
    (start <= end && start < size).then_some((start, end))
}

// Response headers DLNA renderers look for, not a message.
const DLNA: &'static str = "transferMode.dlna.org: Streaming\r\ncontentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\nAccess-Control-Allow-Origin: *\r\n";

fn serve(mut stream: TcpStream, server: &Server) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut head = Vec::new();
    let mut byte = [0u8];
    while !head.ends_with(b"\r\n\r\n") { if head.len() > 8192 { return Ok(()); } stream.read_exact(&mut byte)?; head.push(byte[0]); }
    let text = String::from_utf8_lossy(&head);
    let mut lines = text.lines();
    let parts: Vec<&str> = lines.next().unwrap_or("").split_whitespace().collect();
    let headers: HashMap<String, String> = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect();
    let refuse = |stream: &mut TcpStream, code: &str| write!(stream, "HTTP/1.1 {code}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    if parts.len() != 3 || !matches!(parts[0], "GET" | "HEAD") { return refuse(&mut stream, "405 Method Not Allowed"); }
    let (source, mime) = {
        let song = server.song.lock().unwrap();
        match song.as_ref().filter(|s| s.path == parts[1]) { Some(s) => (s.source.clone(), s.mime.clone()), None => return refuse(&mut stream, "404 Not Found") }
    };
    let head_only = parts[0] == "HEAD";
    match source {
        Source::File(path) => {
            let mut file = std::fs::File::open(&path)?;
            let size = file.metadata()?.len();
            let (start, end, code) = match range(headers.get("range").map(String::as_str), size) { Some((a, b)) => (a, b, "206 Partial Content"), None => (0, size.saturating_sub(1), "200 OK") };
            let length = if size == 0 { 0 } else { end - start + 1 };
            let partial = if code.starts_with("206") { format!("Content-Range: bytes {start}-{end}/{size}\r\n") } else { String::new() };
            write!(stream, "HTTP/1.1 {code}\r\nContent-Type: {mime}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\n{partial}{DLNA}Connection: close\r\n\r\n")?;
            if !head_only { use std::io::Seek; file.seek(std::io::SeekFrom::Start(start))?; std::io::copy(&mut file.take(length), &mut stream)?; }
        }
        Source::Proxy(url) => {
            let client = reqwest::blocking::Client::builder().no_proxy().no_gzip().no_brotli().connect_timeout(Duration::from_secs(3)).timeout(None).build().map_err(std::io::Error::other)?;
            let mut request = client.get(&url);
            if let Some(r) = headers.get("range") { request = request.header("Range", r); }
            let mut response = request.send().map_err(std::io::Error::other)?;
            let status = response.status().as_u16();
            if !matches!(status, 200 | 206) { return refuse(&mut stream, "502 Bad Gateway"); }
            let pass = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(|v| format!("{name}: {v}\r\n")).unwrap_or_default();
            let extra = format!("{}{}", pass("Content-Length"), pass("Content-Range"));
            write!(stream, "HTTP/1.1 {status} {}\r\nContent-Type: {mime}\r\n{extra}Accept-Ranges: bytes\r\n{DLNA}Connection: close\r\n\r\n", if status == 206 { "Partial Content" } else { "OK" })?;
            if !head_only { std::io::copy(&mut response, &mut stream)?; }
        }
    }
    stream.flush()
}

impl Server {
    fn start(ip: Ipv4Addr) -> Result<Arc<Self>, String> {
        let listener = TcpListener::bind((ip, 0)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let server = Arc::new(Server { address: listener.local_addr().map_err(|e| e.to_string())?, token: token(), song: Mutex::new(None), stopped: AtomicBool::new(false), active: AtomicUsize::new(0) });
        let worker = server.clone();
        thread::spawn(move || while !worker.stopped.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, from)) => {
                    // Devices open several connections at once; a bounded number keeps a stuck one from piling up.
                    if !private(&from.ip()) || worker.active.load(Ordering::Relaxed) >= 8 { continue; }
                    let _ = stream.set_nonblocking(false);
                    worker.active.fetch_add(1, Ordering::Relaxed);
                    let one = worker.clone();
                    thread::spawn(move || { let _ = serve(stream, &one); one.active.fetch_sub(1, Ordering::Relaxed); });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(40)),
                Err(_) => thread::sleep(Duration::from_millis(200)),
            }
        });
        Ok(server)
    }
    fn offer(&self, source: Source, mime: &str) -> String {
        let extension = match mime { "audio/mpeg" => "mp3", "audio/flac" => "flac", "audio/wav" => "wav", "audio/ogg" => "ogg", "audio/webm" => "webm", "audio/aiff" => "aiff", _ => "m4a" };
        let path = format!("/{}/{}.{extension}", self.token, token());
        *self.song.lock().unwrap() = Some(Song { source, mime: mime.to_string(), path: path.clone() });
        format!("http://{}{path}", self.address)
    }
}

// ---------- DLNA control ----------

fn soap(control: &str, service: &str, action: &str, args: &str) -> Result<String, String> {
    let body = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{service}\">{args}</u:{action}></s:Body></s:Envelope>");
    let response = client()?.post(control).header("Content-Type", "text/xml; charset=\"utf-8\"").header("SOAPAction", format!("\"{service}#{action}\"")).body(body).send().map_err(|_| FAILED)?;
    let ok = response.status().is_success();
    let text = response.text().unwrap_or_default();
    if ok { Ok(text) } else { Err(FAILED.into()) }
}
fn clock(seconds: f64) -> String { let s = seconds.max(0.0) as u64; format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) }
fn seconds(clock: &str) -> f64 { clock.split('.').next().unwrap_or("").split(':').filter_map(|p| p.parse::<f64>().ok()).fold(0.0, |total, part| total * 60.0 + part) }
fn didl(url: &str, mime: &str, meta: &Meta) -> String {
    let art = meta.image.as_deref().map(|i| format!("<upnp:albumArtURI>{}</upnp:albumArtURI>", escape(i))).unwrap_or_default();
    format!("<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"-1\" restricted=\"1\"><dc:title>{}</dc:title><upnp:artist>{}</upnp:artist><dc:creator>{}</dc:creator>{art}<upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo=\"http-get:*:{mime}:*\">{}</res></item></DIDL-Lite>",
        escape(&meta.title), escape(&meta.artist), escape(&meta.artist), escape(url))
}

// ---------- Chromecast control (CASTV2 over TLS) ----------

fn varint(mut n: u64, out: &mut Vec<u8>) { loop { let b = (n & 0x7f) as u8; n >>= 7; if n == 0 { out.push(b); break; } out.push(b | 0x80); } }
fn field(number: u64, value: &str, out: &mut Vec<u8>) { varint(number << 3 | 2, out); varint(value.len() as u64, out); out.extend_from_slice(value.as_bytes()); }
/// One framed CastMessage: version 0, string payload.
fn cast_frame(source: &str, destination: &str, namespace: &str, payload: &str) -> Vec<u8> {
    let mut body = vec![0x08, 0x00];
    field(2, source, &mut body);
    field(3, destination, &mut body);
    field(4, namespace, &mut body);
    body.extend_from_slice(&[0x28, 0x00]);
    field(6, payload, &mut body);
    let mut frame = (body.len() as u32).to_be_bytes().to_vec();
    frame.extend(body);
    frame
}
/// The source, namespace and JSON payload of one CastMessage body.
fn cast_parse(body: &[u8]) -> Option<(String, String, Value)> {
    let (mut at, mut source, mut namespace, mut payload) = (0, String::new(), String::new(), Value::Null);
    let read = |at: &mut usize| -> Option<u64> { let mut n = 0u64; for shift in (0..64).step_by(7) { let b = *body.get(*at)?; *at += 1; n |= ((b & 0x7f) as u64) << shift; if b & 0x80 == 0 { return Some(n); } } None };
    while at < body.len() {
        let key = read(&mut at)?;
        match key & 7 {
            0 => { read(&mut at)?; }
            2 => {
                let len = read(&mut at)? as usize;
                let data = body.get(at..at + len)?;
                at += len;
                match key >> 3 { 2 => source = String::from_utf8_lossy(data).into(), 4 => namespace = String::from_utf8_lossy(data).into(), 6 => payload = serde_json::from_slice(data).unwrap_or(Value::Null), _ => {} }
            }
            _ => return None,
        }
    }
    Some((source, namespace, payload))
}

#[derive(Debug)]
struct AnyCertificate(Arc<rustls::crypto::CryptoProvider>);
impl rustls::client::danger::ServerCertVerifier for AnyCertificate {
    // Cast devices present certificates signed by Google's device CA, not a public one; the connection stays
    // encrypted, and the device is the one this computer found on its own network.
    fn verify_server_cert(&self, _: &rustls::pki_types::CertificateDer<'_>, _: &[rustls::pki_types::CertificateDer<'_>], _: &rustls::pki_types::ServerName<'_>, _: &[u8], _: rustls::pki_types::UnixTime) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &rustls::pki_types::CertificateDer<'_>, dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &rustls::pki_types::CertificateDer<'_>, dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> { self.0.signature_verification_algorithms.supported_schemes() }
}

enum Command { Load(String, String, Meta, f64, bool), Play, Pause, Seek(f64), Volume(f64), Stop }
// Protocol names, not messages.
const MEDIA_APP: &'static str = "CC1AD845";
const NS_CONNECTION: &'static str = "urn:x-cast:com.google.cast.tp.connection";
const NS_HEARTBEAT: &'static str = "urn:x-cast:com.google.cast.tp.heartbeat";
const NS_RECEIVER: &'static str = "urn:x-cast:com.google.cast.receiver";
const NS_MEDIA: &'static str = "urn:x-cast:com.google.cast.media";

struct CastState { status: Status, at: Instant, gone: bool }

fn cast_session(host: String, name: String, commands: mpsc::Receiver<Command>, shared: Arc<Mutex<CastState>>) -> Result<(), String> {
    let address: SocketAddr = host.parse().map_err(|_| NOT_FOUND)?;
    let tcp = TcpStream::connect_timeout(&address, Duration::from_secs(4)).map_err(|_| NOT_FOUND)?;
    tcp.set_read_timeout(Some(Duration::from_millis(150))).map_err(|e| e.to_string())?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider.clone()).with_safe_default_protocol_versions().map_err(|e| e.to_string())?
        .dangerous().with_custom_certificate_verifier(Arc::new(AnyCertificate(provider))).with_no_client_auth();
    let connection = rustls::ClientConnection::new(Arc::new(config), rustls::pki_types::ServerName::from(address.ip())).map_err(|e| e.to_string())?;
    let mut tls = rustls::StreamOwned::new(connection, tcp);
    let send = |tls: &mut rustls::StreamOwned<rustls::ClientConnection, TcpStream>, to: &str, ns: &str, payload: Value| -> Result<(), String> {
        tls.write_all(&cast_frame("sender-0", to, ns, &payload.to_string())).and_then(|_| tls.flush()).map_err(|_| NOT_FOUND.to_string())
    };
    send(&mut tls, "receiver-0", NS_CONNECTION, json!({"type": "CONNECT"}))?;
    send(&mut tls, "receiver-0", NS_RECEIVER, json!({"type": "LAUNCH", "appId": MEDIA_APP, "requestId": 1}))?;
    let (mut transport, mut session, mut media) = (String::new(), String::new(), 0i64);
    let (mut request, mut pending, mut buffer, mut ping, mut asked) = (2i64, Vec::<Command>::new(), Vec::<u8>::new(), Instant::now(), Instant::now());
    loop {
        while let Ok(command) = commands.try_recv() { pending.push(command); }
        if !transport.is_empty() {
            for command in pending.drain(..) {
                request += 1;
                let message = match command {
                    Command::Load(url, mime, meta, at, play) => {
                        let images = meta.image.map(|i| json!([{"url": i}])).unwrap_or(json!([]));
                        json!({"type": "LOAD", "requestId": request, "autoplay": play, "currentTime": at,
                            "media": {"contentId": url, "contentType": mime, "streamType": "BUFFERED", "metadata": {"metadataType": 3, "title": meta.title, "artist": meta.artist, "images": images}}})
                    }
                    Command::Play => json!({"type": "PLAY", "requestId": request, "mediaSessionId": media}),
                    Command::Pause => json!({"type": "PAUSE", "requestId": request, "mediaSessionId": media}),
                    Command::Seek(at) => json!({"type": "SEEK", "requestId": request, "mediaSessionId": media, "currentTime": at}),
                    Command::Volume(level) => { send(&mut tls, "receiver-0", NS_RECEIVER, json!({"type": "SET_VOLUME", "requestId": request, "volume": {"level": level}}))?; continue; }
                    Command::Stop => { let _ = send(&mut tls, "receiver-0", NS_RECEIVER, json!({"type": "STOP", "requestId": request, "sessionId": session})); return Ok(()); }
                };
                send(&mut tls, &transport, NS_MEDIA, message)?;
            }
        } else if pending.iter().any(|c| matches!(c, Command::Stop)) { return Ok(()); }
        if ping.elapsed() > Duration::from_secs(5) { send(&mut tls, "receiver-0", NS_HEARTBEAT, json!({"type": "PING"}))?; ping = Instant::now(); }
        if !transport.is_empty() && media != 0 && asked.elapsed() > Duration::from_secs(2) {
            request += 1;
            send(&mut tls, &transport, NS_MEDIA, json!({"type": "GET_STATUS", "requestId": request, "mediaSessionId": media}))?;
            asked = Instant::now();
        }
        let mut chunk = [0u8; 16384];
        match tls.read(&mut chunk) {
            Ok(0) => return Err(NOT_FOUND.into()),
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => return Err(NOT_FOUND.into()),
        }
        while buffer.len() >= 4 {
            let size = u32::from_be_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]) as usize;
            if size > 1 << 20 { return Err(NOT_FOUND.into()); }
            if buffer.len() < 4 + size { break; }
            let body: Vec<u8> = buffer.drain(..4 + size).skip(4).collect();
            let Some((from, ns, payload)) = cast_parse(&body) else { continue };
            match (ns.as_str(), payload["type"].as_str().unwrap_or("")) {
                (NS_HEARTBEAT, "PING") => send(&mut tls, &from, NS_HEARTBEAT, json!({"type": "PONG"}))?,
                (NS_RECEIVER, "RECEIVER_STATUS") => {
                    let app = payload["status"]["applications"].as_array().and_then(|apps| apps.iter().find(|a| a["appId"] == MEDIA_APP));
                    match app {
                        Some(app) if transport.is_empty() => {
                            transport = app["transportId"].as_str().unwrap_or("").to_string();
                            session = app["sessionId"].as_str().unwrap_or("").to_string();
                            send(&mut tls, &transport, NS_CONNECTION, json!({"type": "CONNECT"}))?;
                        }
                        // Another app took the device: casting ends.
                        None if !transport.is_empty() => { shared.lock().unwrap().gone = true; return Ok(()); }
                        _ => {}
                    }
                }
                (NS_MEDIA, "MEDIA_STATUS") => {
                    if let Some(item) = payload["status"].as_array().and_then(|s| s.first()) {
                        media = item["mediaSessionId"].as_i64().unwrap_or(media);
                        let mut state = shared.lock().unwrap();
                        let player = item["playerState"].as_str().unwrap_or("IDLE");
                        state.status = Status {
                            device: name.clone(),
                            state: match player { "PLAYING" => "playing", "PAUSED" => "paused", "BUFFERING" => "buffering", _ => "idle" }.into(),
                            position: item["currentTime"].as_f64().unwrap_or(state.status.position),
                            duration: item["media"]["duration"].as_f64().unwrap_or(state.status.duration),
                            error: player == "IDLE" && item["idleReason"] == "ERROR",
                        };
                        state.at = Instant::now();
                    }
                }
                (NS_MEDIA, "LOAD_FAILED" | "INVALID_REQUEST") => { let mut state = shared.lock().unwrap(); state.status.error = true; state.status.state = "idle".into(); }
                (NS_CONNECTION, "CLOSE") if from == transport || from == "receiver-0" => { shared.lock().unwrap().gone = true; return Ok(()); }
                _ => {}
            }
        }
    }
}

// ---------- The active cast ----------

#[derive(Clone, Debug, Default)]
struct Meta { title: String, artist: String, image: Option<String> }
#[derive(Clone)]
enum Link { Dlna(Device), Cast(mpsc::Sender<Command>, Arc<Mutex<CastState>>) }
#[derive(Clone)]
struct Active { device: Device, server: Arc<Server>, link: Link }
// A copy of the cast taken under the lock and used after it is released: a TV that does not answer its SOAP request
// for seconds must not block pause, stop or the next status.
fn current() -> Option<Active> { active().lock().unwrap().clone() }
fn active() -> &'static Mutex<Option<Active>> { static ACTIVE: OnceLock<Mutex<Option<Active>>> = OnceLock::new(); ACTIVE.get_or_init(|| Mutex::new(None)) }

fn clean(text: &str, limit: usize) -> String { text.chars().filter(|c| !c.is_control()).take(limit).collect() }
fn meta(title: &str, artist: &str, image: &str) -> Meta {
    let image = url::Url::parse(image).ok().filter(|u| u.scheme() == "https").map(|u| u.to_string());
    Meta { title: clean(title, 200), artist: clean(artist, 200), image }
}

/// What the device should fetch for this song: this app's own audio server, a local file, or a download.
fn source_for(engine: &crate::Engine, id: &str, url: &str) -> Result<(Source, String), String> {
    if crate::music_local::local_id(id) { let path = crate::music_local::source(id, &engine.dir)?; let mime = mime_for(&path).to_string(); return Ok((Source::File(path), mime)); }
    if let Some(local) = local_source(url) {
        // Ask the local server what it sends.
        let mime = client().ok().and_then(|c| c.get(&local).header("Range", "bytes=0-1").send().ok())
            .and_then(|r| r.headers().get("content-type").and_then(|v| v.to_str().ok()).map(|v| v.split(';').next().unwrap_or("").trim().to_string()))
            .filter(|m| m.starts_with("audio/")).unwrap_or_else(|| "audio/mp4".into());
        return Ok((Source::Proxy(local), mime));
    }
    if let Some(path) = crate::music_offline::offline_path(engine, id) { let mime = mime_for(&path).to_string(); return Ok((Source::File(path), mime)); }
    Err(UNSUPPORTED.into())
}

fn load(active: &Active, source: Source, mime: &str, meta: Meta, position: f64, play: bool) -> Result<(), String> {
    let url = active.server.offer(source, mime);
    match &active.link {
        Link::Dlna(device) => {
            let metadata = escape(&didl(&url, mime, &meta));
            let _ = soap(&device.control, &device.service, "Stop", "<InstanceID>0</InstanceID>");
            soap(&device.control, &device.service, "SetAVTransportURI", &format!("<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{metadata}</CurrentURIMetaData>", escape(&url)))?;
            if play { soap(&device.control, &device.service, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")?; }
            if position > 1.0 { let _ = soap(&device.control, &device.service, "Seek", &format!("<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>", clock(position))); }
            Ok(())
        }
        Link::Cast(commands, _) => commands.send(Command::Load(url, mime.to_string(), meta, position, play)).map_err(|_| NOT_FOUND.to_string()),
    }
}

fn stop_active() {
    let old = active().lock().unwrap().take();
    if let Some(old) = old {
        old.server.stopped.store(true, Ordering::Relaxed);
        match old.link {
            Link::Dlna(device) => { let _ = soap(&device.control, &device.service, "Stop", "<InstanceID>0</InstanceID>"); }
            Link::Cast(commands, _) => { let _ = commands.send(Command::Stop); }
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn music_cast_start(window: tauri::WebviewWindow, engine: tauri::State<'_, crate::Engine>, device: String, id: String, url: String, title: String, artist: String, image: String, position: f64, playing: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let device = known().lock().unwrap().get(&device).cloned().ok_or(NOT_FOUND)?;
        let (source, mime) = source_for(&engine, &id, &url)?;
        stop_active();
        let server = Server::start(lan()?)?;
        let link = match device.kind {
            "cast" => {
                let (tx, rx) = mpsc::channel();
                let shared = Arc::new(Mutex::new(CastState { status: Status { device: device.name.clone(), state: "buffering".into(), ..Status::default() }, at: Instant::now(), gone: false }));
                let (host, name, state) = (device.host.clone(), device.name.clone(), shared.clone());
                thread::spawn(move || { if cast_session(host, name, rx, state.clone()).is_err() { state.lock().unwrap().gone = true; } });
                Link::Cast(tx, shared)
            }
            _ => Link::Dlna(device.clone()),
        };
        let started = Active { device, server, link };
        let result = load(&started, source, &mime, meta(&title, &artist, &image), position.max(0.0), playing);
        if result.is_err() { started.server.stopped.store(true, Ordering::Relaxed); return result; }
        *active().lock().unwrap() = Some(started);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn music_cast_load(window: tauri::WebviewWindow, engine: tauri::State<'_, crate::Engine>, id: String, url: String, title: String, artist: String, image: String, position: f64, playing: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, mime) = source_for(&engine, &id, &url)?;
        let current = current().ok_or(NOT_CASTING)?;
        load(&current, source, &mime, meta(&title, &artist, &image), position.max(0.0), playing)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn music_cast_control(window: tauri::WebviewWindow, action: String, value: Option<f64>) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        if action == "stop" { stop_active(); return Ok(()); }
        let value = value.filter(|v| v.is_finite()).unwrap_or(0.0);
        let current = current().ok_or(NOT_CASTING)?;
        match &current.link {
            Link::Dlna(d) => {
                let s = &d.service;
                match action.as_str() {
                    "play" => soap(&d.control, s, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>").map(|_| ()),
                    "pause" => soap(&d.control, s, "Pause", "<InstanceID>0</InstanceID>").map(|_| ()),
                    "seek" => soap(&d.control, s, "Seek", &format!("<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>", clock(value))).map(|_| ()),
                    "volume" if !d.rendering.is_empty() => soap(&d.rendering, "urn:schemas-upnp-org:service:RenderingControl:1", "SetVolume", &format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{}</DesiredVolume>", (value.clamp(0.0, 1.0) * 100.0).round() as u32)).map(|_| ()),
                    "volume" => Ok(()),
                    _ => Err("Unknown cast action".into()),
                }
            }
            Link::Cast(commands, _) => {
                let command = match action.as_str() { "play" => Command::Play, "pause" => Command::Pause, "seek" => Command::Seek(value.max(0.0)), "volume" => Command::Volume(value.clamp(0.0, 1.0)), _ => return Err("Unknown cast action".into()) };
                commands.send(command).map_err(|_| NOT_FOUND.to_string())
            }
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn music_cast_status(window: tauri::WebviewWindow) -> Result<Option<Status>, String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(current) = current() else { return Ok(None) };
        match &current.link {
            Link::Cast(_, shared) => {
                let state = shared.lock().unwrap();
                if state.gone { return Ok(Some(Status { device: current.device.name.clone(), state: "gone".into(), ..Status::default() })); }
                let mut status = state.status.clone();
                if status.state == "playing" { status.position += state.at.elapsed().as_secs_f64(); }
                Ok(Some(status))
            }
            Link::Dlna(d) => {
                let transport = soap(&d.control, &d.service, "GetTransportInfo", "<InstanceID>0</InstanceID>");
                let Ok(transport) = transport else { return Ok(Some(Status { device: d.name.clone(), state: "gone".into(), ..Status::default() })) };
                let position = soap(&d.control, &d.service, "GetPositionInfo", "<InstanceID>0</InstanceID>").unwrap_or_default();
                let state = match tag(&transport, "CurrentTransportState").unwrap_or("") { "PLAYING" => "playing", "PAUSED_PLAYBACK" => "paused", "TRANSITIONING" => "buffering", _ => "idle" };
                Ok(Some(Status { device: d.name.clone(), state: state.into(), position: seconds(tag(&position, "RelTime").unwrap_or("0")), duration: seconds(tag(&position, "TrackDuration").unwrap_or("0")), error: tag(&transport, "CurrentTransportStatus") == Some("ERROR_OCCURRED") }))
            }
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const DESCRIPTION: &str = r#"<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Living room TV &amp; sound</friendlyName><UDN>uuid:1234</UDN><serviceList>
        <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc/control</controlURL></service>
        <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>upnp/av</controlURL></service>
        </serviceList></device></root>"#;

    #[test]
    fn a_renderer_description_gives_name_and_control_addresses() {
        let device = renderer("http://192.168.1.20:9197/dmr/desc.xml", DESCRIPTION).unwrap();
        assert_eq!(device.name, "Living room TV & sound");
        assert_eq!(device.id, "dlna:uuid:1234");
        assert_eq!(device.control, "http://192.168.1.20:9197/dmr/upnp/av");
        assert_eq!(device.rendering, "http://192.168.1.20:9197/rc/control");
        assert_eq!(device.service, "urn:schemas-upnp-org:service:AVTransport:1");
        // A control address on another host is ignored, and without AVTransport there is nothing to cast to.
        let elsewhere = DESCRIPTION.replace("upnp/av", "http://203.0.113.9/av");
        assert!(renderer("http://192.168.1.20:9197/dmr/desc.xml", &elsewhere).is_none());
    }

    #[test]
    fn soap_answers_and_clock_times_are_read() {
        let answer = "<s:Envelope><s:Body><u:GetPositionInfoResponse xmlns:u=\"x\"><Track>1</Track><TrackDuration>0:03:25</TrackDuration><RelTime>00:01:02.500</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>";
        assert_eq!(tag(answer, "RelTime"), Some("00:01:02.500"));
        assert_eq!(seconds(tag(answer, "RelTime").unwrap()), 62.0);
        assert_eq!(seconds(tag(answer, "TrackDuration").unwrap()), 205.0);
        assert_eq!(clock(3723.9), "01:02:03");
        assert_eq!(tag("<a><b/><c>x</c></a>", "c"), Some("x"));
    }

    #[test]
    fn metadata_is_escaped_inside_didl() {
        let text = didl("http://192.168.1.5:5000/t/s.m4a", "audio/mp4", &meta("Rock & <Roll>", "AC/DC", "https://i.ytimg.com/vi/x/hq.jpg"));
        assert!(text.contains("<dc:title>Rock &amp; &lt;Roll&gt;</dc:title>"));
        assert!(text.contains("protocolInfo=\"http-get:*:audio/mp4:*\""));
        assert!(text.contains("<upnp:albumArtURI>https://i.ytimg.com/vi/x/hq.jpg</upnp:albumArtURI>"));
        assert!(meta("a", "b", "http://insecure/x.jpg").image.is_none());
    }

    #[test]
    fn cast_messages_round_trip() {
        let frame = cast_frame("sender-0", "receiver-0", NS_RECEIVER, &json!({"type": "LAUNCH", "appId": MEDIA_APP}).to_string());
        let size = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
        assert_eq!(size, frame.len() - 4);
        let (source, ns, payload) = cast_parse(&frame[4..]).unwrap();
        assert_eq!(source, "sender-0");
        assert_eq!(ns, NS_RECEIVER);
        assert_eq!(payload["appId"], MEDIA_APP);
        let long = "x".repeat(300);
        let (_, _, payload) = cast_parse(&cast_frame("a", "b", NS_MEDIA, &json!({"long": long}).to_string())[4..]).unwrap();
        assert_eq!(payload["long"].as_str().unwrap().len(), 300);
        assert!(cast_parse(&[0x0a, 0x10, 0x41]).is_none());
    }

    fn mdns_answer() -> Vec<u8> {
        let name = |labels: &[&str]| { let mut v = Vec::new(); for l in labels { v.push(l.len() as u8); v.extend_from_slice(l.as_bytes()); } v.push(0); v };
        let record = |owner: Vec<u8>, kind: u16, data: Vec<u8>| { let mut v = owner; v.extend_from_slice(&kind.to_be_bytes()); v.extend_from_slice(&[0x80, 1, 0, 0, 0, 120]); v.extend_from_slice(&(data.len() as u16).to_be_bytes()); v.extend(data); v };
        let instance = ["Chromecast-abc", "_googlecast", "_tcp", "local"];
        let mut packet = vec![0, 0, 0x84, 0, 0, 0, 0, 4, 0, 0, 0, 0];
        packet.extend(record(name(&["_googlecast", "_tcp", "local"]), 12, name(&instance)));
        let mut srv = vec![0, 0, 0, 0, 0x1f, 0x49];
        srv.extend(name(&["abc", "local"]));
        packet.extend(record(name(&instance), 33, srv));
        let mut txt = Vec::new();
        for item in ["id=abc", "fn=Kitchen speaker", "md=Google Nest Mini"] { txt.push(item.len() as u8); txt.extend_from_slice(item.as_bytes()); }
        packet.extend(record(name(&instance), 16, txt));
        packet.extend(record(name(&["abc", "local"]), 1, vec![192, 168, 1, 44]));
        packet
    }

    #[test]
    fn mdns_answers_name_chromecasts() {
        let devices = cast_devices(&mdns_answer(), IpAddr::V4(Ipv4Addr::new(192, 168, 1, 99)));
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "Kitchen speaker");
        assert_eq!(devices[0].host, "192.168.1.44:8009");
        assert_eq!(devices[0].kind, "cast");
        assert!(cast_devices(&[1, 2, 3], IpAddr::V4(Ipv4Addr::LOCALHOST)).is_empty());
        // A looping compression pointer ends instead of hanging.
        let mut looped = vec![0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12];
        looped.extend_from_slice(&[0, 12, 0, 1, 0, 0, 0, 1, 0, 2, 0xc0, 12]);
        assert!(cast_devices(&looped, IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2))).is_empty());
    }

    // A pretend renderer: records each SOAP action and answers like a TV would.
    fn fake_renderer() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let control = format!("http://{}/upnp/av", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        thread::spawn(move || for stream in listener.incoming().flatten() {
            let mut stream = stream;
            let mut data = Vec::new();
            let mut buf = [0u8; 8192];
            loop {
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 { break; }
                data.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&data);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                    if data.len() >= end + 4 + length { break; }
                }
            }
            let text = String::from_utf8_lossy(&data).to_string();
            let action = text.lines().find_map(|l| l.strip_prefix("SOAPAction: ").or_else(|| l.strip_prefix("soapaction: "))).unwrap_or("").to_string();
            log.lock().unwrap().push(format!("{action}\n{text}"));
            let body = if action.contains("GetTransportInfo") { "<CurrentTransportState>PLAYING</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus>" } else if action.contains("GetPositionInfo") { "<RelTime>0:00:42</RelTime><TrackDuration>0:03:00</TrackDuration>" } else { "" };
            let reply = format!("<s:Envelope><s:Body>{body}</s:Body></s:Envelope>");
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        });
        (control, seen)
    }

    #[test]
    fn a_dlna_renderer_gets_the_song_metadata_and_play() {
        let (control, seen) = fake_renderer();
        let device = Device { id: "dlna:test".into(), name: "TV".into(), kind: "dlna", host: "127.0.0.1".into(), control, service: "urn:schemas-upnp-org:service:AVTransport:1".into(), rendering: String::new() };
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("song.flac");
        std::fs::write(&file, b"fLaC").unwrap();
        let active = Active { device: device.clone(), server: Server::start(Ipv4Addr::LOCALHOST).unwrap(), link: Link::Dlna(device) };
        load(&active, Source::File(file), "audio/flac", meta("Song & Co", "Band", ""), 30.0, true).unwrap();
        let log = seen.lock().unwrap().clone();
        let actions: Vec<&str> = log.iter().map(|entry| entry.lines().next().unwrap().rsplit('#').next().unwrap().trim_end_matches('"')).collect();
        assert_eq!(actions, ["Stop", "SetAVTransportURI", "Play", "Seek"]);
        let set = &log[1];
        assert!(set.contains("<CurrentURI>http://127.0.0.1:"), "{set}");
        assert!(set.contains(".flac</CurrentURI>"));
        // The DIDL metadata is escaped once more inside the SOAP body.
        assert!(set.contains("&lt;dc:title&gt;Song &amp;amp; Co&lt;/dc:title&gt;"), "{set}");
        assert!(log[3].contains("<Target>00:00:30</Target>"));
        active.server.stopped.store(true, Ordering::Relaxed);
    }

    #[test]
    fn ranges_follow_http_rules() {
        assert_eq!(range(Some("bytes=0-99"), 1000), Some((0, 99)));
        assert_eq!(range(Some("bytes=900-"), 1000), Some((900, 999)));
        assert_eq!(range(Some("bytes=-100"), 1000), Some((900, 999)));
        assert_eq!(range(Some("bytes=0-5000"), 1000), Some((0, 999)));
        assert_eq!(range(Some("bytes=2000-"), 1000), None);
        assert_eq!(range(Some("bytes=0-1,5-6"), 1000), None);
        assert_eq!(range(None, 1000), None);
    }

    #[test]
    fn only_this_apps_local_audio_is_proxied() {
        assert_eq!(local_source("http://127.0.0.1:1/x"), None);
        assert_eq!(local_source("http://192.168.1.2:80/x"), None);
        assert_eq!(local_source("https://example.com/a.m4a"), None);
    }

    #[test]
    fn the_song_server_serves_only_the_current_song_with_ranges() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("song.mp3");
        std::fs::write(&file, (0..=255u8).collect::<Vec<_>>()).unwrap();
        let server = Server::start(Ipv4Addr::LOCALHOST).unwrap();
        let url = server.offer(Source::File(file), "audio/mpeg");
        let path = url::Url::parse(&url).unwrap().path().to_string();
        // Loopback is not a home-network address, so the test hands connections to serve() directly.
        let answer = |request: &str| {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
            client.write_all(request.as_bytes()).unwrap();
            let (stream, _) = listener.accept().unwrap();
            serve(stream, &server).unwrap();
            let mut out = Vec::new();
            client.read_to_end(&mut out).unwrap();
            out
        };
        let full = answer(&format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n"));
        let text = String::from_utf8_lossy(&full);
        assert!(text.starts_with("HTTP/1.1 200 OK") && text.contains("Content-Type: audio/mpeg") && text.contains("Content-Length: 256"));
        assert!(full.ends_with(&[254, 255]));
        let part = answer(&format!("GET {path} HTTP/1.1\r\nRange: bytes=10-12\r\n\r\n"));
        assert!(String::from_utf8_lossy(&part).contains("Content-Range: bytes 10-12/256"));
        assert!(part.ends_with(&[10, 11, 12]));
        let other = answer("GET /other/x.mp3 HTTP/1.1\r\n\r\n");
        assert!(String::from_utf8_lossy(&other).starts_with("HTTP/1.1 404"));
        let post = answer(&format!("POST {path} HTTP/1.1\r\n\r\n"));
        assert!(String::from_utf8_lossy(&post).starts_with("HTTP/1.1 405"));
        server.stopped.store(true, Ordering::Relaxed);
    }
}
