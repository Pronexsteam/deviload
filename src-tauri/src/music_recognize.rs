//! Song recognition: the page records a few seconds from the microphone and turns them into a fingerprint of
//! spectral peaks; only that fingerprint is sent to Shazam's recognition service, never the audio. The request
//! carries no location, account or device details of the person.
use base64::Engine as _;
use rand::RngCore;
use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// The data URI prefix of the fingerprint format, not a message.
const PREFIX: &'static str = "data:audio/vnd.shazam.sig;base64,";
const FAILED: &str = "Could not recognize the song. Try again closer to the music.";
const LIMITED: &str = "Song recognition is busy. Try again in a minute.";

fn uuid() -> String {
    let mut b = [0u8; 16];
    rand::rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02X}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// Only a fingerprint built by the page: the right prefix, valid base64 of a plausible size, the format's magic.
fn checked(uri: &str, samplems: u32) -> Result<(), String> {
    let data = uri.strip_prefix(PREFIX).ok_or(FAILED)?;
    if data.len() > 64 * 1024 || !(1000..=20000).contains(&samplems) { return Err(FAILED.into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| FAILED)?;
    if bytes.len() < 56 || bytes[0..4] != 0xcafe2580u32.to_le_bytes() { return Err(FAILED.into()); }
    Ok(())
}

fn https_image(value: &Value) -> Option<String> {
    let url = url::Url::parse(value.as_str()?).ok()?;
    (url.scheme() == "https" && url.host_str().is_some_and(|h| h.ends_with(".mzstatic.com") || h.ends_with(".shazam.com"))).then(|| url.to_string())
}

/// The song from the service's answer, or none when it heard nothing it knows.
fn song(answer: &Value) -> Option<Value> {
    let track = &answer["track"];
    let clean = |v: &Value| v.as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(240).collect::<String>().trim().to_owned();
    let (title, artist) = (clean(&track["title"]), clean(&track["subtitle"]));
    if title.is_empty() || artist.is_empty() || answer["matches"].as_array().is_none_or(|m| m.is_empty()) { return None; }
    let album = track["sections"].as_array().into_iter().flatten()
        .filter_map(|s| s["metadata"].as_array()).flatten()
        .find(|m| m["title"] == "Album").map(|m| clean(&m["text"])).unwrap_or_default();
    Some(json!({"title": title, "artist": artist, "album": album, "image": https_image(&track["images"]["coverart"])}))
}

fn recognize(uri: &str, samplems: u32) -> Result<Option<Value>, String> {
    checked(uri, samplems)?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let proxy = crate::PROXY.lock().map(|p| p.clone()).unwrap_or_default();
    let mut builder = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none());
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(&proxy).map_err(|_| FAILED)?); }
    let client = builder.build().map_err(|_| FAILED)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    // Fixed, generic values where the service expects a phone's location and time zone.
    let body = json!({"geolocation": {"altitude": 300, "latitude": 45, "longitude": 2}, "signature": {"samplems": samplems, "timestamp": now, "uri": uri}, "timestamp": now, "timezone": "Europe/Paris"});
    let url = format!("https://amp.shazam.com/discovery/v5/en/US/android/-/tag/{}/{}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3", uuid(), uuid());
    let response = client.post(url).header("User-Agent", "Dalvik/2.1.0 (Linux; U; Android 12; Pixel 6 Build/SD1A.210817.023)").header("Content-Language", "en_US").json(&body).send().map_err(|_| FAILED)?;
    if response.status().as_u16() == 429 { return Err(LIMITED.into()); }
    if !response.status().is_success() { return Err(FAILED.into()); }
    let answer: Value = response.json().map_err(|_| FAILED)?;
    Ok(song(&answer))
}

#[tauri::command]
pub async fn music_recognize(window: tauri::WebviewWindow, uri: String, samplems: u32) -> Result<Option<Value>, String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    tauri::async_runtime::spawn_blocking(move || recognize(&uri, samplems)).await.map_err(|_| FAILED.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_fingerprint_is_sent() {
        let mut bytes = 0xcafe2580u32.to_le_bytes().to_vec();
        bytes.resize(64, 0);
        let good = format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
        assert!(checked(&good, 10000).is_ok());
        assert!(checked(&good, 10).is_err());
        assert!(checked(&good.replace("vnd.shazam.sig", "wav"), 10000).is_err());
        assert!(checked(&format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode([1u8; 64])), 10000).is_err());
        assert!(checked(&format!("{PREFIX}not base64!"), 10000).is_err());
        assert!(checked(&format!("{PREFIX}{}", "A".repeat(70 * 1024)), 10000).is_err());
    }

    #[test]
    fn the_answer_becomes_a_song_or_nothing() {
        let answer = json!({"matches": [{"id": "1"}], "track": {"title": "Thunderstruck", "subtitle": "AC/DC",
            "images": {"coverart": "https://is1-ssl.mzstatic.com/image/cover.jpg"},
            "sections": [{"metadata": [{"title": "Album", "text": "The Razors Edge"}, {"title": "Released", "text": "1990"}]}]}});
        assert_eq!(song(&answer).unwrap(), json!({"title": "Thunderstruck", "artist": "AC/DC", "album": "The Razors Edge", "image": "https://is1-ssl.mzstatic.com/image/cover.jpg"}));
        let tracked = json!({"matches": [{"id": "1"}], "track": {"title": "X", "subtitle": "Y", "images": {"coverart": "http://evil.example/a.jpg"}}});
        assert!(song(&tracked).unwrap()["image"].is_null());
        assert!(song(&json!({"matches": [], "tagid": "x"})).is_none());
    }

    #[test]
    fn request_ids_look_like_uuids() {
        let id = uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert_ne!(uuid(), id);
    }
}
