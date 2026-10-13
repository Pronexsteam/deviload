use serde_json::{json, Value};
use std::{io::Read, time::Duration};

pub fn lyrics(title: &str, artist: &str, duration: f64, proxy: &str) -> Result<Value, String> {
    if title.trim().is_empty() || title.len() > 1000 || artist.trim().is_empty() || artist.len() > 500 || !duration.is_finite() || duration <= 0.0 {
        return Ok(Value::Null);
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut client = reqwest::blocking::Client::builder().user_agent("Deviload/2.6.7 (https://github.com/Pronexsteam/deviload)")
        .timeout(Duration::from_secs(10)).connect_timeout(Duration::from_secs(5));
    if !proxy.is_empty() { client = client.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?); }
    let mut address = url::Url::parse("https://lrclib.net/api/get").map_err(|e| e.to_string())?;
    address.query_pairs_mut().append_pair("track_name", title).append_pair("artist_name", artist).append_pair("duration", &duration.round().to_string());
    let response = client.build().map_err(|e| e.to_string())?.get(address)
        .send().map_err(|_| "Lyrics are unavailable right now.")?;
    if response.status() == 404 { return Ok(Value::Null); }
    let mut bytes = Vec::new();
    response.error_for_status().map_err(|_| "Lyrics are unavailable right now.")?.take(256 * 1024 + 1)
        .read_to_end(&mut bytes).map_err(|_| "Lyrics are unavailable right now.")?;
    if bytes.len() > 256 * 1024 { return Err("Lyrics are unavailable right now.".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Lyrics are unavailable right now.")?;
    Ok(json!({"plain":value["plainLyrics"],"synced":value["syncedLyrics"],"instrumental":value["instrumental"]}))
}

#[tauri::command]
pub async fn music_lyrics(title: String, artist: String, duration: f64, engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || lyrics(&title, &artist, duration, &proxy)).await.map_err(|e| e.to_string())?
}
