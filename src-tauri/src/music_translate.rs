use serde_json::Value;
use std::{io::Read, time::Duration};

const LANGUAGES: [&str; 16] = ["en", "ru", "uk", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "el", "tr", "pl", "ar", "he"];
const CHUNK_BYTES: usize = 480;
const MAX_REQUESTS: usize = 40;

fn valid_language(code: &str) -> bool { LANGUAGES.contains(&code) }

// Each request carries whole lines, joined by newlines, under the provider's byte limit.
fn chunks(lines: &[String]) -> Vec<Vec<usize>> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut size = 0;
    for (index, line) in lines.iter().enumerate() {
        let cost = line.len() + 1;
        if groups.last().is_none_or(|group| !group.is_empty() && size + cost > CHUNK_BYTES) { groups.push(Vec::new()); size = 0; }
        groups.last_mut().unwrap().push(index);
        size += cost;
    }
    groups
}

fn reply(value: &Value) -> Result<String, &'static str> {
    let status = value["responseStatus"].as_u64().or_else(|| value["responseStatus"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0);
    let text = value["responseData"]["translatedText"].as_str().unwrap_or_default();
    if status == 429 || text.contains("MYMEMORY WARNING") { return Err("limit"); }
    if status != 200 || text.is_empty() { return Err("unavailable"); }
    Ok(text.to_string())
}

fn request(client: &reqwest::blocking::Client, text: &str, source: &str, target: &str) -> Result<String, &'static str> {
    let mut address = url::Url::parse("https://api.mymemory.translated.net/get").map_err(|_| "unavailable")?;
    address.query_pairs_mut().append_pair("q", text).append_pair("langpair", &format!("{source}|{target}"));
    let response = client.get(address).send().map_err(|_| "unavailable")?;
    if response.status().as_u16() == 429 { return Err("limit"); }
    let mut bytes = Vec::new();
    response.take(200_001).read_to_end(&mut bytes).map_err(|_| "unavailable")?;
    if bytes.len() > 200_000 { return Err("unavailable"); }
    reply(&serde_json::from_slice(&bytes).map_err(|_| "unavailable")?)
}

pub fn translate(lines: &[String], source: &str, target: &str, proxy: &str) -> Result<Vec<String>, &'static str> {
    if !valid_language(source) || !valid_language(target) || source == target { return Err("unsupported"); }
    if lines.is_empty() || lines.len() > 400 || lines.iter().any(|line| line.len() > 400 || line.contains('\n')) { return Err("unsupported"); }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::blocking::Client::builder().timeout(Duration::from_secs(8)).connect_timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none()).user_agent(concat!("Deviload/", env!("CARGO_PKG_VERSION")));
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "unavailable")?); }
    let client = builder.build().map_err(|_| "unavailable")?;
    let mut out = vec![String::new(); lines.len()];
    let mut requests = 0;
    for group in chunks(lines) {
        let joined = group.iter().map(|&i| lines[i].as_str()).collect::<Vec<_>>().join("\n");
        requests += 1;
        if requests > MAX_REQUESTS { return Err("unsupported"); }
        let translated = request(&client, &joined, source, target)?;
        let parts: Vec<&str> = translated.split('\n').collect();
        if parts.len() == group.len() {
            for (&i, part) in group.iter().zip(parts) { out[i] = part.trim().to_string(); }
            continue;
        }
        // The provider occasionally merges lines; fall back to one request per line.
        for &i in &group {
            requests += 1;
            if requests > MAX_REQUESTS { return Err("unsupported"); }
            out[i] = request(&client, &lines[i], source, target)?.trim().to_string();
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn music_translate_lyrics(lines: Vec<String>, source: String, target: String, engine: tauri::State<'_, crate::Engine>) -> Result<Vec<String>, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || translate(&lines, &source, &target, &proxy).map_err(str::to_string))
        .await.map_err(|_| "unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn whole_lines_fit_the_provider_limit() {
        let lines: Vec<String> = (0..30).map(|i| format!("line number {i} with some words in it")).collect();
        let groups = chunks(&lines);
        assert!(groups.len() > 1);
        assert_eq!(groups.iter().flatten().count(), 30);
        for group in &groups { assert!(group.iter().map(|&i| lines[i].len() + 1).sum::<usize>() <= CHUNK_BYTES); }
        assert_eq!(chunks(&["x".repeat(600)]).len(), 1);
    }
    #[test] fn invalid_requests_never_reach_the_provider() {
        assert_eq!(translate(&["hi".into()], "en", "en", ""), Err("unsupported"));
        assert_eq!(translate(&["hi".into()], "xx", "ru", ""), Err("unsupported"));
        assert_eq!(translate(&[], "en", "ru", ""), Err("unsupported"));
        assert_eq!(translate(&["a\nb".into()], "en", "ru", ""), Err("unsupported"));
    }
    #[test] fn quota_and_failures_are_reported() {
        assert_eq!(reply(&json!({"responseStatus":200,"responseData":{"translatedText":"Hola"}})), Ok("Hola".into()));
        assert_eq!(reply(&json!({"responseStatus":200,"responseData":{"translatedText":"MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"}})), Err("limit"));
        assert_eq!(reply(&json!({"responseStatus":"403","responseData":{"translatedText":"INVALID LANGUAGE PAIR"}})), Err("unavailable"));
    }
}
