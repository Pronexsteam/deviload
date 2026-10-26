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

fn word_count(lines: &[Value]) -> usize {
    lines.iter().filter_map(|line| line["words"].as_array()).map(Vec::len).sum()
}

fn normalized(value: &str) -> String {
    value.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn lookup_title(value: &str) -> &str {
    // Soundtrack marketing suffixes are not recording versions. Keep live,
    // slowed, remixed and acoustic suffixes intact.
    let lower=value.to_ascii_lowercase();
    if let Some(index)=lower.find(" (from ") {
        if lower[index..].contains("soundtrack") && lower.ends_with(')') { return &value[..index]; }
    }
    value
}

fn text_lines(record: &Value) -> usize {
    let structured=timed_lines(record["lyricsfile"].as_str());
    if !structured.is_empty() { return structured.iter().filter(|line| !line["text"].as_str().unwrap_or("").trim().is_empty()).count(); }
    record["plainLyrics"].as_str().or_else(||record["syncedLyrics"].as_str()).unwrap_or("").lines().filter(|s|!s.trim().is_empty()).count()
}

// Prefer richer timing only for the same recording. Do not borrow words from
// a cover, remix, slowed version or a recording with a different duration.
fn prefer_word_record(original: &Value, candidates: &Value) -> Option<Value> {
    let title = normalized(lookup_title(original["trackName"].as_str()?));
    let artist = normalized(original["artistName"].as_str()?);
    let duration = original["duration"].as_f64()?;
    if title.is_empty() || artist.is_empty() || !duration.is_finite() { return None; }
    let original_lines = text_lines(original);
    candidates.as_array()?.iter().take(20).filter(|item| {
        item["instrumental"] != true
            && normalized(lookup_title(item["trackName"].as_str().unwrap_or(""))) == title
            && normalized(item["artistName"].as_str().unwrap_or("")) == artist
            && item["duration"].as_f64().is_some_and(|d| (d-duration).abs() <= 2.0)
    }).filter_map(|item| {
        let words = word_count(&timed_lines(item["lyricsfile"].as_str()));
        let lines = text_lines(item);
        // Do not exchange a complete text for a tiny word-synced excerpt.
        ((words > 0 && lines * 5 >= original_lines * 4) || lines > original_lines)
            .then_some(((words > 0, lines, words), item))
    }).max_by_key(|(score, _)| *score).map(|(_, item)| item.clone())
}

fn read_record(response: reqwest::blocking::Response, limit: usize) -> Result<Value, String> {
    let mut bytes = Vec::new();
    response.error_for_status().map_err(|_| "Lyrics are unavailable right now.")?.take(limit as u64 + 1)
        .read_to_end(&mut bytes).map_err(|_| "Lyrics are unavailable right now.")?;
    if bytes.len() > limit { return Err("Lyrics are unavailable right now.".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "Lyrics are unavailable right now.".into())
}

pub fn lyrics(title: &str, artist: &str, duration: f64, proxy: &str) -> Result<Value, String> {
    if title.trim().is_empty() || title.len() > 1000 || artist.trim().is_empty() || artist.len() > 500 || !duration.is_finite() || duration <= 0.0 {
        return Ok(Value::Null);
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut client = reqwest::blocking::Client::builder().user_agent(concat!("Deviload/", env!("CARGO_PKG_VERSION"), " (https://github.com/Pronexsteam/deviload)"))
        .timeout(Duration::from_secs(10)).connect_timeout(Duration::from_secs(5));
    if !proxy.is_empty() { client = client.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?); }
    let mut address = url::Url::parse("https://lrclib.net/api/get").map_err(|e| e.to_string())?;
    address.query_pairs_mut().append_pair("track_name", title).append_pair("artist_name", artist).append_pair("duration", &duration.round().to_string());
    let client = client.build().map_err(|e| e.to_string())?;
    let response = client.get(address)
        .send().map_err(|_| "Lyrics are unavailable right now.")?;
    let mut value = if response.status() == 404 { Value::Null } else { read_record(response, 256 * 1024)? };
    if value["instrumental"] != true && word_count(&timed_lines(value["lyricsfile"].as_str())) == 0 {
        let mut search = url::Url::parse("https://lrclib.net/api/search").map_err(|e| e.to_string())?;
        search.query_pairs_mut().append_pair("track_name", lookup_title(title)).append_pair("artist_name", artist);
        // One bounded enrichment request; failure/429 leaves the working text
        // intact. Never loop or retry the service while the player is running.
        std::thread::sleep(Duration::from_millis(250));
        if let Ok(response) = client.get(search).timeout(Duration::from_secs(3)).send() {
            if let Ok(candidates) = read_record(response, 1024 * 1024) {
                let mut signature=if value.is_object(){value.clone()}else{json!({})};
                signature["trackName"]=json!(title);signature["artistName"]=json!(artist);signature["duration"]=json!(duration);
                if let Some(richer) = prefer_word_record(&signature, &candidates) { value = richer; }
            }
        }
    }
    if value.is_null() { return Ok(Value::Null); }
    Ok(json!({"plain":value["plainLyrics"],"synced":value["syncedLyrics"],"instrumental":value["instrumental"],"lines":timed_lines(value["lyricsfile"].as_str())}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn richer_timing_requires_the_same_recording_and_valid_words() {
        let base = json!({"id":1,"trackName":"Example Song","artistName":"Example Artist","duration":180});
        let good = json!({"id":2,"trackName":"EXAMPLE SONG","artistName":"Example Artist","duration":181,
            "lyricsfile":"version: '1.0'\nlines:\n - {text: Hello, start_ms: 1000, end_ms: 2000, words: [{text: Hello, start_ms: 1000, end_ms: 2000}]}"});
        assert_eq!(prefer_word_record(&base,&json!([good])) .unwrap()["id"],2);
        for (key,value) in [("trackName",json!("Example Song (Slowed)")),("artistName",json!("Cover Artist")),("duration",json!(190)),("instrumental",json!(true)),("lyricsfile",json!("invalid"))] {
            let mut wrong=good.clone();wrong[key]=value;
            assert!(prefer_word_record(&base,&json!([wrong])).is_none());
        }
        assert!(prefer_word_record(&base,&json!([])).is_none());
        assert!(prefer_word_record(&Value::Null,&json!([good])).is_none());
    }
    #[test] fn fuller_duet_lyrics_do_not_match_a_solo_or_a_different_version() {
        let base=json!({"trackName":"City Of Stars (From \"La La Land\" Soundtrack)","artistName":"Ryan Gosling, Emma Stone","duration":149,"plainLyrics":"First verse"});
        let full=json!({"trackName":"City of Stars","artistName":"Ryan Gosling & Emma Stone","duration":149,"plainLyrics":"First verse\nSecond verse"});
        assert!(prefer_word_record(&base,&json!([full])).is_some());
        let mut solo=full.clone();solo["artistName"]=json!("Ryan Gosling");
        assert!(prefer_word_record(&base,&json!([solo])).is_none());
        let mut remix=full.clone();remix["trackName"]=json!("City of Stars (Slowed)");
        assert!(prefer_word_record(&base,&json!([remix])).is_none());
        assert_eq!(lookup_title("İstanbul (From Film Soundtrack)"),"İstanbul");
    }
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
