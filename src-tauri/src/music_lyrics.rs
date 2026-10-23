use serde_json::{json, Value};
use std::{io::Read, time::Duration};

#[derive(serde::Deserialize)]
struct LyricsFile { version: String, #[serde(default)] lines: Vec<TimedLine> }
#[derive(serde::Deserialize)]
struct TimedLine { text: String, start_ms: u64, end_ms: Option<u64>, #[serde(default)] words: Vec<TimedWord> }
#[derive(serde::Deserialize)]
struct TimedWord { text: String, start_ms: u64, end_ms: Option<u64> }

// Optional richer data: any unsupported/malformed file falls back to ordinary LRC.
// Deserialize into a fixed-depth schema, never a general recursive YAML tree.
fn timed_lines(raw: Option<&str>) -> Vec<Value> {
    let Some(raw) = raw.filter(|s| s.len() <= 250_000) else { return vec![] };
    let Ok(file) = serde_yaml_ng::from_str::<LyricsFile>(raw) else { return vec![] };
    if file.version != "1.0" || file.lines.len() > 3000 { return vec![]; }
    let mut lines = Vec::new();
    for line in file.lines {
        if line.start_ms > 86_400_000 || line.text.len() > 8000 || line.end_ms.is_some_and(|end| end < line.start_ms || end > 86_400_000) { continue; }
        let valid_words = !line.words.is_empty() && line.words.len() <= 500
            && line.words.windows(2).all(|pair| pair[0].start_ms <= pair[1].start_ms)
            && line.words.iter().all(|word| word.start_ms >= line.start_ms && word.start_ms <= 86_400_000
                && line.end_ms.is_none_or(|end| word.start_ms <= end)
                && word.end_ms.is_none_or(|end| end >= word.start_ms && end <= line.end_ms.unwrap_or(86_400_000)))
            && line.words.iter().map(|word| word.text.as_str()).collect::<String>() == line.text;
        let words: Vec<Value> = if valid_words { line.words.into_iter().map(|word| json!({"text":word.text,"at":word.start_ms as f64 / 1000.0,"end":word.end_ms.map(|v| v as f64 / 1000.0)})).collect() } else { vec![] };
        lines.push(json!({"text":line.text,"at":line.start_ms as f64 / 1000.0,"end":line.end_ms.map(|v| v as f64 / 1000.0),"words":words}));
    }
    lines.sort_by(|a,b| a["at"].as_f64().partial_cmp(&b["at"].as_f64()).unwrap());
    lines
}

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
    Ok(json!({"plain":value["plainLyrics"],"synced":value["syncedLyrics"],"instrumental":value["instrumental"],"lines":timed_lines(value["lyricsfile"].as_str())}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn preserves_word_timing_spaces_and_overlapping_lines() {
        let raw = "version: '1.0'\nlines:\n - {text: 'Hello world', start_ms: 1000, end_ms: 4000, words: [{text: 'Hello ', start_ms: 1000, end_ms: 2000}, {text: world, start_ms: 2500, end_ms: 4000}]}\n - {text: Harmony, start_ms: 1500, end_ms: 5000}";
        let lines = timed_lines(Some(raw));assert_eq!(lines.len(),2);
        assert_eq!(lines[0]["words"][0]["text"],"Hello ");assert_eq!(lines[0]["words"][1]["at"],2.5);
        assert_eq!(lines[0]["end"],4.0);assert_eq!(lines[1]["end"],5.0);
    }
    #[test] fn malformed_words_fall_back_to_the_complete_line() {
        let raw = "version: '1.0'\nlines:\n - {text: Hello, start_ms: 1000, words: [{text: Wrong, start_ms: 500}]}";
        let lines=timed_lines(Some(raw));assert_eq!(lines[0]["text"],"Hello");assert_eq!(lines[0]["words"],json!([]));
        for raw in ["not: [valid", "version: '2.0'\nlines: []", "version: '1.0'\nlines: [{text: bad, start_ms: -1}]"] { assert!(timed_lines(Some(raw)).is_empty()); }
    }
}

#[tauri::command]
pub async fn music_lyrics(title: String, artist: String, duration: f64, engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || lyrics(&title, &artist, duration, &proxy)).await.map_err(|e| e.to_string())?
}
