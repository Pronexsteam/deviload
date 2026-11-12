//! RGB lighting that follows the music, through OpenRGB's SDK server (one free program that drives most keyboards,
//! mice, RAM, fans, strips and motherboards). Deviload connects on this computer only, puts each device into its
//! direct mode, paints the colour it is given, and on stop gives every device back the effect it had before.
//!
//! The client speaks protocol version 0, which every OpenRGB server understands: it never asks for a newer version,
//! so the server answers in the version-0 layout parsed here.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;

const MAGIC: &[u8; 4] = b"ORGB";
const REQUEST_CONTROLLER_COUNT: u32 = 0;
const REQUEST_CONTROLLER_DATA: u32 = 1;
const SET_CLIENT_NAME: u32 = 50;
const UPDATE_LEDS: u32 = 1050;
const SET_CUSTOM_MODE: u32 = 1100;
const UPDATE_MODE: u32 = 1101;
const MAX_PACKET: u32 = 4 * 1024 * 1024;
const MAX_DEVICES: u32 = 64;

/// One lit device: how many colours it takes, and the effect it was showing before Deviload took it.
#[derive(Debug, Clone, PartialEq)]
struct Device {
    name: String,
    leds: u16,
    active_mode: i32,
    mode_bytes: Vec<u8>,
}

struct Session {
    stream: TcpStream,
    devices: Vec<Device>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn packet(device: u32, id: u32, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(16 + data.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&device.to_le_bytes());
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    out
}

fn read_packet(stream: &mut TcpStream) -> Result<(u32, u32, Vec<u8>), String> {
    let mut head = [0u8; 16];
    stream.read_exact(&mut head).map_err(|_| "unreachable")?;
    if &head[0..4] != MAGIC { return Err("protocol".into()); }
    let device = u32::from_le_bytes(head[4..8].try_into().unwrap());
    let id = u32::from_le_bytes(head[8..12].try_into().unwrap());
    let size = u32::from_le_bytes(head[12..16].try_into().unwrap());
    if size > MAX_PACKET { return Err("protocol".into()); }
    let mut data = vec![0u8; size as usize];
    stream.read_exact(&mut data).map_err(|_| "unreachable")?;
    Ok((device, id, data))
}

/// Waits for the answer with [id], skipping the server's own notices (a device list change, for one).
fn expect(stream: &mut TcpStream, id: u32) -> Result<Vec<u8>, String> {
    for _ in 0..16 {
        let (_, got, data) = read_packet(stream)?;
        if got == id { return Ok(data); }
    }
    Err("protocol".into())
}

/// A little reader over the controller description.
struct Cursor<'a> { data: &'a [u8], at: usize }
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(n).filter(|end| *end <= self.data.len()).ok_or("protocol")?;
        let out = &self.data[self.at..end];
        self.at = end;
        Ok(out)
    }
    fn u16(&mut self) -> Result<u16, String> { Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap())) }
    fn u32(&mut self) -> Result<u32, String> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn i32(&mut self) -> Result<i32, String> { Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn string(&mut self) -> Result<String, String> {
        let len = self.u16()? as usize;
        let raw = self.take(len)?;
        Ok(String::from_utf8_lossy(raw.split(|b| *b == 0).next().unwrap_or(&[])).trim().to_string())
    }
}

/// Reads a version-0 controller description: its name, its modes (keeping the bytes of the active one so it can
/// be put back), and how many colours it takes.
fn parse_controller(data: &[u8]) -> Result<Device, String> {
    let mut c = Cursor { data, at: 0 };
    let _size = c.u32()?;
    let _kind = c.i32()?;
    let name = c.string()?;
    for _ in 0..4 { c.string()?; } // description, version, serial, location
    let modes = c.u16()?;
    let active_mode = c.i32()?;
    let mut mode_bytes = Vec::new();
    for index in 0..modes as i32 {
        let start = c.at;
        c.string()?; // name
        c.take(4 * 9)?; // value, flags, speed min/max, colours min/max, speed, direction, colour mode
        let colours = c.u16()? as usize;
        c.take(colours * 4)?;
        if index == active_mode { mode_bytes = data[start..c.at].to_vec(); }
    }
    let zones = c.u16()?;
    for _ in 0..zones {
        c.string()?;
        c.take(4 * 4)?; // type, leds min, leds max, leds count
        let matrix = c.u16()? as usize;
        c.take(matrix)?;
    }
    let leds = c.u16()?;
    for _ in 0..leds {
        c.string()?;
        c.take(4)?;
    }
    let colours = c.u16()?;
    c.take(colours as usize * 4)?;
    Ok(Device { name, leds: colours, active_mode, mode_bytes })
}

fn leds_packet(index: u32, count: u16, rgb: (u8, u8, u8)) -> Vec<u8> {
    let mut data = Vec::with_capacity(6 + count as usize * 4);
    data.extend_from_slice(&(6 + count as u32 * 4).to_le_bytes());
    data.extend_from_slice(&count.to_le_bytes());
    for _ in 0..count { data.extend_from_slice(&[rgb.0, rgb.1, rgb.2, 0]); }
    packet(index, UPDATE_LEDS, &data)
}

fn restore_packet(index: u32, device: &Device) -> Option<Vec<u8>> {
    if device.mode_bytes.is_empty() { return None; }
    let mut data = Vec::with_capacity(8 + device.mode_bytes.len());
    data.extend_from_slice(&(8 + device.mode_bytes.len() as u32).to_le_bytes());
    data.extend_from_slice(&device.active_mode.to_le_bytes());
    data.extend_from_slice(&device.mode_bytes);
    Some(packet(index, UPDATE_MODE, &data))
}

fn open(address: SocketAddr) -> Result<Session, String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(800)).map_err(|_| "unreachable")?;
    stream.set_nodelay(true).ok();
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(1))).ok();
    stream.write_all(&packet(0, SET_CLIENT_NAME, b"Deviload\0")).map_err(|_| "unreachable")?;
    stream.write_all(&packet(0, REQUEST_CONTROLLER_COUNT, &[])).map_err(|_| "unreachable")?;
    let count = expect(&mut stream, REQUEST_CONTROLLER_COUNT)?;
    let count = u32::from_le_bytes(count.get(0..4).ok_or("protocol")?.try_into().unwrap()).min(MAX_DEVICES);
    let mut devices = Vec::new();
    for index in 0..count {
        stream.write_all(&packet(index, REQUEST_CONTROLLER_DATA, &[])).map_err(|_| "unreachable")?;
        let data = expect(&mut stream, REQUEST_CONTROLLER_DATA)?;
        devices.push(parse_controller(&data)?);
    }
    for index in 0..devices.len() as u32 {
        stream.write_all(&packet(index, SET_CUSTOM_MODE, &[])).map_err(|_| "unreachable")?;
    }
    Ok(Session { stream, devices })
}

fn stop_session(session: &mut Session) {
    for (index, device) in session.devices.iter().enumerate() {
        if let Some(bytes) = restore_packet(index as u32, device) { let _ = session.stream.write_all(&bytes); }
    }
    let _ = session.stream.flush();
}

#[derive(serde::Serialize)]
pub struct LightingStatus {
    connected: bool,
    devices: Vec<String>,
    error: String,
}

/// Connects to OpenRGB on this computer (port 6742 unless given) and takes over its devices.
#[tauri::command]
pub async fn music_lighting_start(window: tauri::WebviewWindow, port: Option<u16>) -> LightingStatus {
    if window.label() != "main" { return LightingStatus { connected: false, devices: vec![], error: "protocol".into() }; }
    let port = port.unwrap_or(6742);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let address = ("127.0.0.1", port).to_socket_addrs().map_err(|_| "unreachable".to_string())?.next().ok_or("unreachable")?;
        open(address)
    }).await.unwrap_or_else(|_| Err("unreachable".into()));
    let mut slot = SESSION.lock().unwrap();
    if let Some(old) = slot.as_mut() { stop_session(old); }
    match result {
        Ok(session) => {
            let devices = session.devices.iter().filter(|d| d.leds > 0).map(|d| d.name.clone()).collect();
            *slot = Some(session);
            LightingStatus { connected: true, devices, error: String::new() }
        }
        Err(error) => { *slot = None; LightingStatus { connected: false, devices: vec![], error } }
    }
}

/// Paints every device one colour. Called many times a second while music plays; a lost connection ends the session.
#[tauri::command]
pub fn music_lighting_set(r: u8, g: u8, b: u8) -> bool {
    let mut slot = SESSION.lock().unwrap();
    let Some(session) = slot.as_mut() else { return false; };
    let mut bytes = Vec::new();
    for (index, device) in session.devices.iter().enumerate() {
        if device.leds > 0 { bytes.extend(leds_packet(index as u32, device.leds, (r, g, b))); }
    }
    if session.stream.write_all(&bytes).is_err() { *slot = None; return false; }
    true
}

/// Gives each device its own effect back and disconnects.
#[tauri::command]
pub fn music_lighting_stop() {
    if let Some(mut session) = SESSION.lock().unwrap().take() { stop_session(&mut session); }
}

/// On exit the lights go back to what they were.
pub fn stop() { music_lighting_stop(); }

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn string(out: &mut Vec<u8>, text: &str) {
        out.extend_from_slice(&((text.len() + 1) as u16).to_le_bytes());
        out.extend_from_slice(text.as_bytes());
        out.push(0);
    }
    fn mode(name: &str, colours: u16) -> Vec<u8> {
        let mut m = Vec::new();
        string(&mut m, name);
        for v in 0..9u32 { m.extend_from_slice(&v.to_le_bytes()); }
        m.extend_from_slice(&colours.to_le_bytes());
        for _ in 0..colours { m.extend_from_slice(&[1, 2, 3, 0]); }
        m
    }
    // A version-0 description: two modes (the second active), one zone with a matrix, three LEDs.
    fn controller(name: &str) -> (Vec<u8>, Vec<u8>) {
        let mut d = Vec::new();
        d.extend_from_slice(&0u32.to_le_bytes());
        d.extend_from_slice(&3i32.to_le_bytes());
        string(&mut d, name);
        for s in ["desc", "1.0", "SN", "USB"] { string(&mut d, s); }
        d.extend_from_slice(&2u16.to_le_bytes());
        d.extend_from_slice(&1i32.to_le_bytes());
        let active = mode("Rainbow", 2);
        d.extend(mode("Direct", 0));
        d.extend(&active);
        d.extend_from_slice(&1u16.to_le_bytes());
        string(&mut d, "Keys");
        for v in [1u32, 3, 3, 3] { d.extend_from_slice(&v.to_le_bytes()); }
        d.extend_from_slice(&12u16.to_le_bytes());
        d.extend_from_slice(&[0u8; 12]);
        d.extend_from_slice(&3u16.to_le_bytes());
        for l in ["A", "B", "C"] { string(&mut d, l); d.extend_from_slice(&0u32.to_le_bytes()); }
        d.extend_from_slice(&3u16.to_le_bytes());
        d.extend_from_slice(&[0u8; 12]);
        let size = d.len() as u32;
        d[0..4].copy_from_slice(&size.to_le_bytes());
        (d, active)
    }

    #[test]
    fn a_version_zero_description_gives_the_led_count_and_the_active_effect() {
        let (data, active) = controller("Keyboard");
        let device = parse_controller(&data).unwrap();
        assert_eq!(device.name, "Keyboard");
        assert_eq!(device.leds, 3);
        assert_eq!(device.active_mode, 1);
        assert_eq!(device.mode_bytes, active);
        assert!(parse_controller(&data[..data.len() - 5]).is_err(), "a cut description is refused, not read past");
    }

    #[test]
    fn colours_and_the_restored_effect_are_packed_as_openrgb_expects() {
        let p = leds_packet(2, 2, (255, 10, 20));
        assert_eq!(&p[0..4], b"ORGB");
        assert_eq!(u32::from_le_bytes(p[4..8].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(p[8..12].try_into().unwrap()), UPDATE_LEDS);
        assert_eq!(&p[16..20], &14u32.to_le_bytes());
        assert_eq!(&p[22..30], &[255, 10, 20, 0, 255, 10, 20, 0]);
        let device = Device { name: "x".into(), leds: 1, active_mode: 4, mode_bytes: vec![9, 9] };
        let r = restore_packet(0, &device).unwrap();
        assert_eq!(u32::from_le_bytes(r[8..12].try_into().unwrap()), UPDATE_MODE);
        assert_eq!(&r[16..], &[10, 0, 0, 0, 4, 0, 0, 0, 9, 9]);
        assert!(restore_packet(0, &Device { mode_bytes: vec![], ..device }).is_none());
    }

    #[test]
    fn a_session_takes_over_the_devices_and_gives_them_back() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        let (data, active) = controller("Strip");
        let worker = std::thread::spawn(move || {
            let (mut s, _) = server.accept().unwrap();
            let mut seen = Vec::new();
            loop {
                let Ok((device, id, _)) = read_packet(&mut s) else { break };
                seen.push((device, id));
                match id {
                    REQUEST_CONTROLLER_COUNT => s.write_all(&packet(0, id, &1u32.to_le_bytes())).unwrap(),
                    REQUEST_CONTROLLER_DATA => {
                        // A notice arrives first and must be skipped.
                        s.write_all(&packet(0, 100, &[])).unwrap();
                        s.write_all(&packet(0, id, &data)).unwrap();
                    }
                    UPDATE_MODE => break,
                    _ => {}
                }
            }
            seen
        });
        let mut session = open(address).unwrap();
        assert_eq!(session.devices.len(), 1);
        assert_eq!(session.devices[0].mode_bytes, active);
        session.stream.write_all(&leds_packet(0, session.devices[0].leds, (1, 2, 3))).unwrap();
        stop_session(&mut session);
        let seen = worker.join().unwrap();
        let ids: Vec<u32> = seen.iter().map(|(_, id)| *id).collect();
        assert_eq!(ids, vec![SET_CLIENT_NAME, REQUEST_CONTROLLER_COUNT, REQUEST_CONTROLLER_DATA, SET_CUSTOM_MODE, UPDATE_LEDS, UPDATE_MODE]);
    }

    #[test]
    fn nothing_listening_reads_as_unreachable() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        assert_eq!(open(port).err().as_deref(), Some("unreachable"));
    }
}
