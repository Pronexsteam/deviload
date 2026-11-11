// Community-marked non-music parts of music videos (SponsorBlock). Only the first four hex digits of
// the video id's SHA-256 leave the computer, so the service cannot tell which video is playing.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Read, time::Duration};

const CATEGORIES: &str = r#"["music_offtopic","sponsor","selfpromo"]"#;

fn valid_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn prefix(id: &str) -> String {
    Sha256::digest(id.as_bytes()).iter().take(2).map(|b| format!("{b:02x}")).collect()
}

// Keeps only skippable segments of this exact video, sorted and bounded.
fn pick(id: &str, response: &Value) -> Value {
    let Some(video) = response.as_array().and_then(|items| items.iter().find(|item| item["videoID"] == id)) else {
        return json!({ "segments": [], "duration": 0 });
    };
    let mut segments: Vec<(f64, f64, String)> = video["segments"]
        .as_array()
        .map(|list| {
            list.iter()
                .take(100)
                .filter(|s| s["actionType"].as_str().is_none_or(|a| a == "skip"))
                .filter_map(|s| {
                    let start = s["segment"][0].as_f64()?;
                    let end = s["segment"][1].as_f64()?;
                    let category = s["category"].as_str()?;
                    (start.is_finite() && end.is_finite() && start >= 0.0 && end - start >= 1.0 && end <= 86_400.0)
                        .then(|| (start, end, category.chars().take(32).collect()))
                })
                .collect()
        })
        .unwrap_or_default();
    segments.sort_by(|a, b| a.0.total_cmp(&b.0));
    // Older marks often omit the length; any mark that has it describes the same upload.
    let duration = video["segments"]
        .as_array()
        .and_then(|list| list.iter().filter_map(|s| s["videoDuration"].as_f64()).find(|d| d.is_finite() && *d > 0.0))
        .unwrap_or(0.0);
    json!({
        "segments": segments.into_iter().map(|(start, end, category)| json!({ "start": start, "end": end, "category": category })).collect::<Vec<_>>(),
        "duration": duration,
    })
}

pub fn segments(id: &str, proxy: &str) -> Result<Value, String> {
    if !valid_id(id) {
        return Ok(json!({ "segments": [], "duration": 0 }));
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut client = reqwest::blocking::Client::builder()
        .user_agent(concat!("Deviload/", env!("CARGO_PKG_VERSION"), " (https://github.com/Pronexsteam/deviload)"))
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(5));
    if !proxy.is_empty() {
        client = client.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
    }
    let mut address = url::Url::parse("https://sponsor.ajay.app/api/skipSegments/").map_err(|e| e.to_string())?;
    address.path_segments_mut().map_err(|_| "Invalid address")?.pop_if_empty().push(&prefix(id));
    address.query_pairs_mut().append_pair("categories", CATEGORIES);
    let response = client.build().map_err(|e| e.to_string())?.get(address).send().map_err(|_| "Segments are unavailable right now.")?;
    if response.status() == 404 {
        return Ok(json!({ "segments": [], "duration": 0 }));
    }
    let mut bytes = Vec::new();
    response
        .error_for_status()
        .map_err(|_| "Segments are unavailable right now.")?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Segments are unavailable right now.")?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Segments are unavailable right now.".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Segments are unavailable right now.")?;
    Ok(pick(id, &value))
}

#[tauri::command]
pub async fn music_skip_segments(id: String, engine: tauri::State<'_, crate::Engine>) -> Result<Value, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || segments(&id, &proxy)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_a_hash_prefix_identifies_the_video() {
        assert_eq!(prefix("dQw4w9WgXcQ").len(), 4);
        assert!(!valid_id("../../etc"));
        assert!(!valid_id("dQw4w9WgXcQ?x"));
        assert!(valid_id("dQw4w9WgXc-"));
    }
    #[test]
    fn segments_of_other_videos_and_unusable_ranges_are_ignored() {
        let response = json!([
            { "videoID": "otherVideo1", "segments": [{ "segment": [0, 30], "category": "sponsor", "actionType": "skip" }] },
            { "videoID": "dQw4w9WgXcQ", "segments": [
                { "segment": [200, 212.5], "category": "music_offtopic", "actionType": "skip", "videoDuration": 212.9 },
                { "segment": [0, 14], "category": "music_offtopic", "actionType": "skip", "videoDuration": 212.9 },
                { "segment": [50, 50.5], "category": "sponsor", "actionType": "skip" },
                { "segment": [60, 90], "category": "sponsor", "actionType": "mute" },
                { "segment": [-5, 10], "category": "sponsor" }
            ] }
        ]);
        let picked = pick("dQw4w9WgXcQ", &response);
        assert_eq!(picked["duration"], 212.9);
        let list = picked["segments"].as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["start"], 0.0);
        assert_eq!(list[1]["end"], 212.5);
        assert_eq!(pick("missingVide", &response)["segments"].as_array().unwrap().len(), 0);
    }
}
