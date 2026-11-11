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
    // Where in the studio recording the sound was heard, and how much faster or slower it ran: lyrics are timed
    // on the studio recording, so this tells how far another upload of the song is shifted from it.
    let found = &answer["matches"][0];
    let number = |v: &Value| v.as_f64().filter(|n| n.is_finite());
    Some(json!({"title": title, "artist": artist, "album": album, "image": https_image(&track["images"]["coverart"]),
        "offset": number(&found["offset"]), "skew": number(&found["timeskew"])}))
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

// ---------- Sound to recognise besides the microphone: what this computer plays, or a file ----------

const SAMPLE_RATE: u32 = 16_000;
const NO_SOUND: &str = "Nothing is playing on this computer. Start the song, then try again.";
const NO_FILE_SOUND: &str = "Could not read sound from this file.";
const NO_LISTENING: &str = "Could not listen to this computer's sound.";

/// Mono floats at any rate become signed 16-bit samples at 16 kHz, as little-endian bytes in base64.
fn to_payload(mono: &[f32], rate: u32) -> String {
    let out_len = (mono.len() as u64 * SAMPLE_RATE as u64 / rate.max(1) as u64) as usize;
    let mut bytes = Vec::with_capacity(out_len * 2);
    for i in 0..out_len {
        let at = i as f64 * rate as f64 / SAMPLE_RATE as f64;
        let low = at.floor() as usize;
        let high = (low + 1).min(mono.len().saturating_sub(1));
        let value = mono.get(low).copied().unwrap_or(0.0) as f64 + (mono.get(high).copied().unwrap_or(0.0) as f64 - mono.get(low).copied().unwrap_or(0.0) as f64) * (at - low as f64);
        let sample = (value.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Records what the default output device plays (WASAPI loopback), mixed to mono.
#[cfg(windows)]
fn capture_output(seconds: u32) -> Result<(Vec<f32>, u32), String> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};
    let failed = |_| NO_LISTENING.to_string();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(failed)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(failed)?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(failed)?;
        let format = client.GetMixFormat().map_err(failed)?;
        let (channels, rate, bits) = ((*format).nChannels.max(1) as usize, (*format).nSamplesPerSec, (*format).wBitsPerSample);
        let started = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10_000_000, 0, format, None);
        CoTaskMemFree(Some(format as *const _));
        started.map_err(failed)?;
        let capture: IAudioCaptureClient = client.GetService().map_err(failed)?;
        client.Start().map_err(failed)?;
        let wanted = rate as usize * seconds as usize;
        let deadline = std::time::Instant::now() + Duration::from_secs(seconds as u64 + 2);
        let mut mono: Vec<f32> = Vec::with_capacity(wanted);
        let mut heard = false;
        while mono.len() < wanted && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
            let mut packet = capture.GetNextPacketSize().unwrap_or(0);
            while packet > 0 {
                let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
                if capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() { break; }
                let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                for frame in 0..frames as usize {
                    let mut sum = 0f32;
                    if !silent && !data.is_null() {
                        for channel in 0..channels {
                            let index = frame * channels + channel;
                            sum += if bits == 32 { *(data as *const f32).add(index) } else { *(data as *const i16).add(index) as f32 / 32768.0 };
                        }
                    }
                    mono.push(sum / channels as f32);
                }
                heard |= !silent && frames > 0;
                let _ = capture.ReleaseBuffer(frames);
                packet = capture.GetNextPacketSize().unwrap_or(0);
            }
        }
        let _ = client.Stop();
        // Windows sends no packets at all while nothing plays.
        if !heard { return Err(NO_SOUND.into()); }
        Ok((mono, rate))
    }
}
#[cfg(not(windows))]
fn capture_output(_seconds: u32) -> Result<(Vec<f32>, u32), String> {
    Err("Recognising this computer's sound is available on Windows.".into())
}

#[tauri::command]
pub async fn music_capture_output(window: tauri::WebviewWindow, seconds: Option<u32>) -> Result<String, String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let seconds = seconds.unwrap_or(10).clamp(4, 15);
    tauri::async_runtime::spawn_blocking(move || capture_output(seconds).map(|(mono, rate)| to_payload(&mono, rate)))
        .await.map_err(|_| FAILED.to_owned())?
}

/// A dozen seconds from a file the person picks, decoded by FFmpeg: from 30 s in when the song is that long.
fn decode_file(path: &std::path::Path) -> Result<String, String> {
    let ffmpeg = crate::binary("ffmpeg")?;
    let read = |start: &str| -> Result<Vec<u8>, String> {
        let mut command = crate::command(&ffmpeg);
        command.args(["-v", "error", "-ss", start, "-t", "12", "-i"]).arg(path).args(["-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]);
        let output = crate::engine_update::json_output_large(&mut command, Duration::from_secs(60)).map_err(|_| NO_FILE_SOUND)?;
        Ok(output.stdout)
    };
    let mut bytes = read("30")?;
    if bytes.len() < SAMPLE_RATE as usize * 2 * 4 { bytes = read("0")?; }
    if bytes.len() < SAMPLE_RATE as usize * 2 * 3 { return Err(NO_FILE_SOUND.into()); }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn music_recognize_file(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if window.label() != "main" { return Err("Unavailable window".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file()
            .add_filter("Audio or video", &["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "webm", "mp4", "mkv", "mov", "avi", "wma", "aiff"])
            .blocking_pick_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
        decode_file(&path).map(Some)
    }).await.map_err(|_| FAILED.to_owned())?
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
        assert_eq!(song(&answer).unwrap(), json!({"title": "Thunderstruck", "artist": "AC/DC", "album": "The Razors Edge", "image": "https://is1-ssl.mzstatic.com/image/cover.jpg", "offset": null, "skew": null}));
        let timed = json!({"matches": [{"id": "1", "offset": 61.25, "timeskew": 0.001}], "track": {"title": "X", "subtitle": "Y"}});
        assert_eq!(song(&timed).unwrap()["offset"], 61.25);
        let tracked = json!({"matches": [{"id": "1"}], "track": {"title": "X", "subtitle": "Y", "images": {"coverart": "http://evil.example/a.jpg"}}});
        assert!(song(&tracked).unwrap()["image"].is_null());
        assert!(song(&json!({"matches": [], "tagid": "x"})).is_none());
    }

    #[test]
    fn computer_sound_becomes_16_khz_samples() {
        // One second of a 48 kHz tone at full scale: 16 000 samples, still at full scale.
        let tone: Vec<f32> = (0..48_000).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let bytes = base64::engine::general_purpose::STANDARD.decode(to_payload(&tone, 48_000)).unwrap();
        assert_eq!(bytes.len(), 32_000);
        let samples: Vec<i16> = bytes.chunks(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
        assert!(samples.iter().all(|s| s.unsigned_abs() >= 32_000));
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(to_payload(&[0.25; 16_000], 16_000)).unwrap().len(), 32_000);
        assert_eq!(to_payload(&[], 48_000), "");
    }

    #[test]
    fn request_ids_look_like_uuids() {
        let id = uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert_ne!(uuid(), id);
    }
}
