// The names of artists known to publish AI-generated music, from the community list at
// github.com/CennoxX/spotify-ai-blocker (MIT). Downloaded only when the listener turns the filter on; Devil
// Music then keeps those artists out of recommendations and radio, never out of search or the library.
use crate::Engine;
use std::time::Duration;

const LIST: &str = "https://raw.githubusercontent.com/CennoxX/spotify-ai-blocker/main/SpotifyAiArtists.csv";
const LIMIT: usize = 4 * 1024 * 1024;

// "artist,id" rows; a name with a comma is quoted.
fn names(csv: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in csv.lines().skip(1).take(100_000) {
        let line = line.trim_end_matches('\r');
        let name = if let Some(rest) = line.strip_prefix('"') {
            let mut value = String::new();
            let mut chars = rest.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '"' {
                    if chars.peek() == Some(&'"') { chars.next(); value.push('"'); } else { break; }
                } else { value.push(c); }
            }
            value
        } else {
            line.rsplit_once(',').map(|(name, _)| name).unwrap_or(line).to_string()
        };
        let name = name.trim();
        if !name.is_empty() && name.len() <= 200 { out.push(name.to_string()); }
    }
    out
}

fn download(proxy: &str) -> Result<Vec<String>, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::blocking::Client::builder().timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(6))
        .user_agent(concat!("Deviload/", env!("CARGO_PKG_VERSION")));
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "The AI artist list could not be downloaded")?); }
    let client = builder.build().map_err(|_| "The AI artist list could not be downloaded")?;
    let response = client.get(LIST).send().map_err(|_| "The AI artist list could not be downloaded")?;
    if !response.status().is_success() { return Err("The AI artist list could not be downloaded".into()); }
    let bytes = response.bytes().map_err(|_| "The AI artist list could not be downloaded")?;
    if bytes.len() > LIMIT { return Err("The AI artist list could not be downloaded".into()); }
    let found = names(&String::from_utf8_lossy(&bytes));
    if found.len() < 100 { return Err("The AI artist list could not be downloaded".into()); }
    Ok(found)
}

#[tauri::command]
pub async fn music_ai_artists(engine: tauri::State<'_, Engine>) -> Result<Vec<String>, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || download(&proxy)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_read_from_the_list_with_quoted_commas() {
        let csv = "artist,id\r\nAtomship,4PbKVheWA7ToOxOrqqzjol\r\n\"Smoke, Mirrors\",abc\r\n\"Say \"\"Hi\"\"\",x\r\n,empty\r\n";
        assert_eq!(names(csv), vec!["Atomship", "Smoke, Mirrors", "Say \"Hi\""]);
    }
}
