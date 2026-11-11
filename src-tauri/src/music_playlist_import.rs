use serde_json::{json, Value};
use std::{collections::HashSet, io::Read, time::Duration};

const INVALID: &str = "Enter a public Spotify playlist or album link.";
const UNAVAILABLE: &str = "Could not read this public Spotify playlist or album. Try a music export instead.";
const PARTIAL: &str = "Spotify's public preview may omit songs. Use a music export for a complete transfer.";
const MAX_HTML: usize = 4 * 1024 * 1024;

fn collection_id(link: &str) -> Result<(String, String), String> {
    let url = url::Url::parse(link.trim()).map_err(|_| INVALID)?;
    if url.scheme() != "https" || url.host_str() != Some("open.spotify.com") || !url.username().is_empty() || url.password().is_some() || url.port().is_some() || url.fragment().is_some() { return Err(INVALID.into()); }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let (kind, id) = match parts.as_slice() {
        [kind @ ("playlist" | "album"), id] => (*kind, *id),
        [locale, kind @ ("playlist" | "album"), id] if locale.starts_with("intl-") && locale.len() <= 12 => (*kind, *id),
        _ => return Err(INVALID.into()),
    };
    if id.len() != 22 || !id.bytes().all(|c| c.is_ascii_alphanumeric()) { return Err(INVALID.into()); }
    Ok((kind.into(), id.into()))
}

fn clean(value: &Value) -> String {
    value.as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(300).collect::<String>().trim().to_owned()
}

fn parse_page(html: &str, kind: &str, id: &str) -> Result<Value, String> {
    if html.len() > MAX_HTML { return Err(UNAVAILABLE.into()); }
    // Read JSON only. Never execute the public embed or consume its credentials/audio URLs.
    let marker = "<script id=\"__NEXT_DATA__\"";
    let rest = html.split_once(marker).ok_or(UNAVAILABLE)?.1;
    let body = rest.split_once('>').ok_or(UNAVAILABLE)?.1.split_once("</script>").ok_or(UNAVAILABLE)?.0;
    let data: Value = serde_json::from_str(body).map_err(|_| UNAVAILABLE)?;
    let entity = &data["props"]["pageProps"]["state"]["data"]["entity"];
    if entity["type"] != kind || entity["id"] != id { return Err(UNAVAILABLE.into()); }
    let name = clean(&entity["name"]);
    let tracks = entity["trackList"].as_array().ok_or(UNAVAILABLE)?;
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for track in tracks {
        let uri = track["uri"].as_str().unwrap_or("");
        let Some(track_id) = uri.strip_prefix("spotify:track:") else { continue; };
        if track_id.len() != 22 || !track_id.bytes().all(|c| c.is_ascii_alphanumeric()) { continue; }
        let title = clean(&track["title"]);
        let artist = clean(&track["subtitle"]);
        if title.is_empty() || artist.is_empty() || !seen.insert(uri) { continue; }
        entries.push(json!({"key":uri,"title":title,"artists":[artist],"liked":false,"plays":0}));
    }
    if entries.is_empty() { return Err(UNAVAILABLE.into()); }
    let keys: Vec<_> = entries.iter().map(|row| row["key"].clone()).collect();
    let name = if name.is_empty() { if kind == "album" { "Imported Spotify album" } else { "Imported Spotify playlist" } } else { &name };
    Ok(json!({"source":"spotify","name":name,"entries":entries,"playlists":[{"name":name,"keys":keys}],"warnings":[PARTIAL],"completeness":"unknown","origin":"link"}))
}

pub fn read_public_playlist(link: &str) -> Result<Value, String> {
    let (kind, id) = collection_id(link)?;
    if kind == "playlist" { return read_full_playlist(&format!("https://open.spotify.com/playlist/{id}")); }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder().user_agent("Deviload/2.6 public playlist import").connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| UNAVAILABLE)?;
    let response = client.get(format!("https://open.spotify.com/embed/{kind}/{id}")).send().map_err(|_| UNAVAILABLE)?;
    if response.status().as_u16() == 429 { return Err("Music catalog is temporarily rate-limited. Try again later.".into()); }
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > MAX_HTML as u64) { return Err(UNAVAILABLE.into()); }
    let mut bytes = Vec::new();
    response.take(MAX_HTML as u64 + 1).read_to_end(&mut bytes).map_err(|_| UNAVAILABLE)?;
    if bytes.len() > MAX_HTML { return Err(UNAVAILABLE.into()); }
    parse_page(std::str::from_utf8(&bytes).map_err(|_| UNAVAILABLE)?, &kind, &id)
}

// The web player's shared TOTP secrets, fetched here rather than in the script: Deno can take half a minute to
// reach that host on networks with broken IPv6, while this client falls back to IPv4 at once. Kept for an hour.
fn spotify_secrets() -> Option<String> {
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, String)>> = std::sync::Mutex::new(None);
    if let Some((at, text)) = CACHE.lock().ok()?.as_ref() { if at.elapsed() < Duration::from_secs(3600) { return Some(text.clone()); } }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder().user_agent("Deviload Spotify import").connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().ok()?;
    let response = client.get("https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json").send().ok()?;
    if !response.status().is_success() { return None; }
    let mut text = String::new();
    response.take(1024 * 1024).read_to_string(&mut text).ok()?;
    serde_json::from_str::<Value>(&text).ok()?.as_object()?;
    *CACHE.lock().ok()? = Some((std::time::Instant::now(), text.clone()));
    Some(text)
}

/// Runs the Spotify metadata script in its own bounded Deno process: network to Spotify's web-player hosts only,
/// no files, and only the environment named here.
pub(crate) fn run_spotify_script(args: &[&str], env: &[(&str, &str)], timeout: Duration, fallback: &str) -> Result<Value, String> {
    let root = dirs::cache_dir().ok_or(fallback)?.join("com.deviload.desktop").join("spotify-import");
    std::fs::create_dir_all(&root).map_err(|_| fallback)?;
    let mut script = tempfile::Builder::new().prefix("spotify-").suffix(".mjs").tempfile_in(&root).map_err(|_| fallback)?;
    use std::io::Write;
    script.write_all(include_bytes!("../spotify-import.mjs")).map_err(|_| fallback)?;
    script.flush().map_err(|_| fallback)?;
    let mut command = crate::command(&crate::binary("deno")?);
    command.env_clear();
    for name in ["SystemRoot", "TEMP", "TMP"] { if let Some(v) = std::env::var_os(name) { command.env(name, v); } }
    let secrets = spotify_secrets().unwrap_or_default();
    let mut allowed = vec!["DEVILOAD_SPOTIFY_SECRETS"];
    command.env("DEVILOAD_SPOTIFY_SECRETS", &secrets);
    for (name, value) in env { command.env(name, value); allowed.push(name); }
    command.current_dir(&root).args(["run", "--no-config", "--no-npm", "--no-remote", "--no-prompt", "--allow-net=open.spotify.com,open.spotifycdn.com,clienttoken.spotify.com,api-partner.spotify.com,code.thetadev.de"])
        .arg(format!("--allow-env={}", allowed.join(","))).arg(script.path()).args(args);
    let output = crate::engine_update::json_output_large(&mut command, timeout).map_err(|_| fallback)?;
    let data: Value = serde_json::from_slice(&output.stdout).map_err(|_| fallback)?;
    if !output.status.success() { return Err(data["error"].as_str().unwrap_or(fallback).to_owned()); }
    Ok(data)
}

fn read_full_playlist(link: &str) -> Result<Value, String> {
    // A separate bounded metadata process cannot occupy the audio worker.
    static ACTIVE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = ACTIVE.try_lock().map_err(|_| "A Spotify import is already running. Please wait.")?;
    let data = run_spotify_script(&[link], &[], Duration::from_secs(155), UNAVAILABLE)?;
    if data["source"] != "spotify" || data["completeness"] != "complete" || data["receivedCount"] != data["reportedTotal"] || !data["entries"].is_array() { return Err(UNAVAILABLE.into()); }
    Ok(data)
}

#[tauri::command]
pub async fn music_import_spotify_playlist(window: tauri::WebviewWindow, link: String) -> Result<Value, String> {
    if window.label() != "main" { return Err("Music import is only available in the main window.".into()); }
    tauri::async_runtime::spawn_blocking(move || read_public_playlist(&link)).await.map_err(|_| UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "37i9dQZF1DZ06evO3eIivx";
    #[test]
    fn album_metadata_preserves_order_and_rejects_wrong_entity() {
        let entity = json!({"type":"album","id":ID,"name":"Album","trackList":[
            {"uri":"spotify:track:4Mcivvdi3voJG7aYosxtnT","title":"First","subtitle":"Artist"},
            {"uri":"spotify:track:7lBwQzYymGLZz9ybb4isD0","title":"Second","subtitle":"Artist"}
        ]});
        let data = json!({"props":{"pageProps":{"state":{"data":{"entity":entity}}}}});
        let html = format!("<script id=\"__NEXT_DATA__\" type=\"application/json\">{data}</script>");
        let result = parse_page(&html, "album", ID).unwrap();
        assert_eq!(result["entries"][0]["title"], "First");
        assert_eq!(result["entries"][1]["title"], "Second");
        assert_eq!(result["playlists"][0]["name"], "Album");
        assert!(parse_page(&html, "playlist", ID).is_err());
    }
    #[test]
    #[ignore = "live Spotify album import"]
    fn live_spotify_album_import() {
        if std::env::var_os("DEVILOAD_LIVE_IMPORT_TEST").is_none() { return; }
        let result = read_public_playlist("https://open.spotify.com/album/7sFZGbkCitoqQz7Rt3LoKg").unwrap();
        assert_eq!(result["name"], "MUSIC - SORRY 4 DA WAIT");
        assert!(!result["entries"].as_array().unwrap().is_empty());
    }
    #[test]
    #[ignore = "live full public Spotify playlist import"]
    fn live_spotify_full_playlist_import() {
        if std::env::var_os("DEVILOAD_LIVE_IMPORT_TEST").is_none() { return; }
        let result = read_public_playlist("https://open.spotify.com/playlist/2WkXJXAOqb1MQWhPrlGdlL").unwrap();
        assert_eq!(result["completeness"], "complete");
        assert_eq!(result["receivedCount"], result["reportedTotal"]);
        assert!(result["entries"].as_array().unwrap().len() > 1400);
        assert!(result["entries"][0]["spotifyId"].as_str().is_some());
        println!("Spotify full import: received={}, usable={}, unavailable={}", result["receivedCount"], result["entries"].as_array().unwrap().len(), result["unavailableCount"]);
    }
    #[test]
    fn public_metadata_keeps_more_than_500_tracks() {
        let tracks: Vec<Value> = (0..601).map(|n| json!({"uri":format!("spotify:track:{n:022}"),"title":format!("Song {n}"),"subtitle":"Artist"})).collect();
        let entity = json!({"type":"playlist","id":ID,"name":"Large","trackList":tracks});
        let data = json!({"props":{"pageProps":{"state":{"data":{"entity":entity}}}}});
        let html = format!("<script id=\"__NEXT_DATA__\">{data}</script>");
        assert_eq!(parse_page(&html,"playlist",ID).unwrap()["entries"].as_array().unwrap().len(),601);
    }
    #[test]
    fn validates_links_before_network() {
        assert_eq!(collection_id(&format!("https://open.spotify.com/intl-de/playlist/{ID}?si=tracking")).unwrap(), ("playlist".into(), ID.into()));
        assert_eq!(collection_id(&format!("https://open.spotify.com/album/{ID}?si=tracking")).unwrap(), ("album".into(), ID.into()));
        for url in ["http://open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx", "https://open.spotify.com.evil.test/playlist/37i9dQZF1DZ06evO3eIivx", "https://user@open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx", "https://open.spotify.com/collection/tracks", "https://open.spotify.com/playlist/short", "file:///secret"] { assert!(collection_id(url).is_err()); }
    }
    #[test]
    fn parses_only_music_metadata_and_reports_unknown_completeness() {
        let track = json!({"uri":"spotify:track:4Mcivvdi3voJG7aYosxtnT","title":"Song","subtitle":"Artist","audioPreview":{"url":"private-unused"}});
        let entity = json!({"type":"playlist","id":ID,"name":"My list","trackList":[track.clone(),track,{"uri":"spotify:episode:4Mcivvdi3voJG7aYosxtnT"}]});
        let data = json!({"props":{"pageProps":{"state":{"data":{"entity":entity}}}}});
        let html = format!("<script id=\"__NEXT_DATA__\" type=\"application/json\">{data}</script>");
        let result = parse_page(&html, "playlist", ID).unwrap();
        assert_eq!(result["entries"].as_array().unwrap().len(), 1);
        assert_eq!(result["entries"][0]["liked"], false);
        assert_eq!(result["name"], "My list");
        assert!(!result.to_string().contains("private-unused"));
        assert_eq!(result["warnings"][0], PARTIAL);
        assert!(parse_page(&html, "playlist", "wrong-playlist").is_err());
        assert!(parse_page(&html, "album", ID).is_err());
        assert!(parse_page("<html>Sign in</html>", "playlist", ID).is_err());
    }
}
