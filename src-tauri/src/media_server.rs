// Downloads laid out for Jellyfin, Emby and Plex. Videos become dated episodes of
// their channel's show; next to each one Deviload writes the Kodi-style .nfo that
// Jellyfin reads, and gives the channel folder a tvshow.nfo and a poster. After a
// batch it can ask the server to scan its libraries.
use super::command;
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaServer {
    // "", "jellyfin" (also Emby) or "plex".
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub token: String,
}

impl MediaServer {
    pub fn validate(&self) -> Result<(), String> {
        if self.kind.is_empty() { return Ok(()); }
        if !["jellyfin", "plex"].contains(&self.kind.as_str()) { return Err("Unknown media server".into()); }
        let url = url::Url::parse(self.url.trim()).map_err(|_| "Enter the server address, for example http://192.168.1.10:8096".to_string())?;
        if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || url.query().is_some() {
            return Err("Enter the server address, for example http://192.168.1.10:8096".into());
        }
        let token = self.token.trim();
        if token.is_empty() || token.len() > 200 || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("Enter the API key from the server settings".into());
        }
        Ok(())
    }
}

fn escape(text: &str) -> String {
    text.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').map(|c| match c {
        '&' => "&amp;".into(), '<' => "&lt;".into(), '>' => "&gt;".into(), '"' => "&quot;".into(), '\'' => "&apos;".into(),
        other => other.to_string(),
    }).collect()
}

fn text<'a>(info: &'a serde_json::Value, keys: &[&str]) -> &'a str {
    keys.iter().find_map(|key| info[*key].as_str().filter(|value| !value.trim().is_empty())).unwrap_or("")
}

// "20050424" becomes ("2005", "2005-04-24", 424).
fn date(upload: &str) -> Option<(String, String, u32)> {
    if upload.len() != 8 || !upload.chars().all(|c| c.is_ascii_digit()) { return None; }
    let (year, month, day) = (&upload[..4], &upload[4..6], &upload[6..]);
    Some((year.into(), format!("{year}-{month}-{day}"), month.parse::<u32>().ok()? * 100 + day.parse::<u32>().ok()?))
}

fn episode_nfo(info: &serde_json::Value) -> String {
    let title = text(info, &["title"]);
    let show = text(info, &["channel", "uploader"]);
    let mut lines = vec![
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#.to_owned(),
        "<episodedetails>".into(),
        format!("  <title>{}</title>", escape(title)),
        format!("  <showtitle>{}</showtitle>", escape(show)),
        format!("  <plot>{}</plot>", escape(text(info, &["description"]))),
        format!("  <studio>{}</studio>", escape(show)),
        format!("  <uniqueid type=\"{}\" default=\"true\">{}</uniqueid>", escape(&text(info, &["extractor_key"]).to_ascii_lowercase()), escape(text(info, &["id"]))),
    ];
    if let Some((year, aired, month_day)) = date(text(info, &["upload_date"])) {
        // Episodes of a year are numbered by date, with room for several videos on one day.
        let slot = info["timestamp"].as_u64().map_or(0, |time| time % 86400 / 900);
        lines.extend([format!("  <aired>{aired}</aired>"), format!("  <premiered>{aired}</premiered>"),
            format!("  <season>{year}</season>"), format!("  <episode>{}</episode>", month_day as u64 * 100 + slot)]);
    }
    if let Some(seconds) = info["duration"].as_f64() { lines.push(format!("  <runtime>{}</runtime>", (seconds / 60.0).ceil() as u64)); }
    lines.push("</episodedetails>".into());
    lines.join("\n") + "\n"
}

fn show_nfo(info: &serde_json::Value) -> String {
    let show = text(info, &["channel", "uploader"]);
    [r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#.to_owned(), "<tvshow>".into(),
        format!("  <title>{}</title>", escape(show)),
        format!("  <studio>{}</studio>", escape(show)),
        format!("  <uniqueid type=\"{}\" default=\"true\">{}</uniqueid>", escape(&text(info, &["extractor_key"]).to_ascii_lowercase()), escape(text(info, &["channel_id", "uploader_id"]))),
        "</tvshow>".into()].join("\n") + "\n"
}

// Turns the details yt-dlp wrote next to a video into the files media servers read.
pub fn describe(video: &Path) -> Result<(), String> {
    let stem = video.file_stem().ok_or("The file has no name")?.to_string_lossy().into_owned();
    let folder = video.parent().ok_or("The file has no folder")?;
    let details = folder.join(format!("{stem}.info.json"));
    let info: serde_json::Value = serde_json::from_slice(&fs::read(&details).map_err(|_| "yt-dlp did not write the video details".to_string())?)
        .map_err(|e| e.to_string())?;
    fs::write(folder.join(format!("{stem}.nfo")), episode_nfo(&info)).map_err(|e| e.to_string())?;
    // The folder above "Season …" is the show.
    if let Some(show) = folder.parent().filter(|_| folder.file_name().is_some_and(|name| name.to_string_lossy().starts_with("Season "))) {
        let show_file = show.join("tvshow.nfo");
        if !show_file.exists() { fs::write(&show_file, show_nfo(&info)).map_err(|e| e.to_string())?; }
        let thumb = folder.join(format!("{stem}-thumb.jpg"));
        let poster = show.join("poster.jpg");
        if thumb.is_file() && !poster.exists() { fs::copy(&thumb, &poster).map_err(|e| e.to_string())?; }
    }
    let _ = fs::remove_file(details);
    Ok(())
}

// Every video under `folder` (channel / season / file) whose details are still waiting.
// Files still downloading keep their details until their own task finishes.
pub fn describe_all(folder: &Path) -> Vec<String> {
    let mut errors = vec![];
    let mut pending = vec![(folder.to_path_buf(), 0)];
    while let Some((dir, depth)) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() { if depth < 3 { pending.push((path, depth + 1)); } continue; }
            let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
            let Some(stem) = name.strip_suffix(".info.json") else { continue };
            let video = ["mkv", "mp4", "webm", "mov", "m4v"].iter().map(|ext| dir.join(format!("{stem}.{ext}"))).find(|video| video.is_file());
            if let Some(video) = video {
                if let Err(error) = describe(&video) { errors.push(format!("{stem}: {error}")); }
            }
        }
    }
    errors
}

fn null_device() -> PathBuf { PathBuf::from(if cfg!(windows) { "NUL" } else { "/dev/null" }) }

// Asks the server to scan its libraries, so new files show up without waiting.
pub fn refresh(server: &MediaServer) -> Result<(), String> {
    server.validate()?;
    let base = server.url.trim().trim_end_matches('/');
    let (method, target, header) = match server.kind.as_str() {
        "jellyfin" => ("POST", format!("{base}/Library/Refresh"), format!("X-Emby-Token: {}", server.token.trim())),
        "plex" => ("GET", format!("{base}/library/sections/all/refresh"), format!("X-Plex-Token: {}", server.token.trim())),
        _ => return Ok(()),
    };
    let curl = PathBuf::from(if cfg!(windows) { "curl.exe" } else { "curl" });
    let output = command(&curl).args(["-s", "-m", "15", "-X", method, "-H", &header, "-w", "%{http_code}", "-o"])
        .arg(null_device()).arg(&target).output().map_err(|e| format!("Could not reach the media server: {e}"))?;
    match String::from_utf8_lossy(&output.stdout).trim() {
        code if code.starts_with('2') => Ok(()),
        "401" | "403" => Err("The media server did not accept the API key".into()),
        "000" | "" => Err(format!("The media server did not answer at {base}")),
        code => Err(format!("The media server answered with code {code}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_episode_show_and_poster() {
        let dir = tempfile::tempdir().unwrap();
        let season = dir.path().join("jawed").join("Season 2005");
        fs::create_dir_all(&season).unwrap();
        let video = season.join("jawed - 2005-04-24 - Me at the zoo [jNQXAC9IVRw].mkv");
        fs::write(&video, b"video").unwrap();
        fs::write(season.join("jawed - 2005-04-24 - Me at the zoo [jNQXAC9IVRw]-thumb.jpg"), b"jpg").unwrap();
        fs::write(season.join("jawed - 2005-04-24 - Me at the zoo [jNQXAC9IVRw].info.json"), serde_json::json!({
            "id": "jNQXAC9IVRw", "title": "Me at the zoo <3 & more", "description": "Elephants", "channel": "jawed",
            "channel_id": "UC4QobU6STFB0P71PMvOGN5A", "upload_date": "20050424", "timestamp": 1114380000u64,
            "duration": 19.0, "extractor_key": "Youtube"}).to_string()).unwrap();
        describe(&video).unwrap();
        let episode = fs::read_to_string(season.join("jawed - 2005-04-24 - Me at the zoo [jNQXAC9IVRw].nfo")).unwrap();
        assert!(episode.contains("<title>Me at the zoo &lt;3 &amp; more</title>"), "{episode}");
        assert!(episode.contains("<aired>2005-04-24</aired>") && episode.contains("<season>2005</season>"));
        // April 24th, the 88th quarter hour of the day.
        assert!(episode.contains("<episode>42488</episode>") && episode.contains("<runtime>1</runtime>"));
        assert!(episode.contains("<uniqueid type=\"youtube\" default=\"true\">jNQXAC9IVRw</uniqueid>"));
        assert!(fs::read_to_string(dir.path().join("jawed").join("tvshow.nfo")).unwrap().contains("<title>jawed</title>"));
        assert_eq!(fs::read(dir.path().join("jawed").join("poster.jpg")).unwrap(), b"jpg");
        assert!(!season.join("jawed - 2005-04-24 - Me at the zoo [jNQXAC9IVRw].info.json").exists());
    }

    #[test]
    fn describes_every_finished_video_of_a_playlist() {
        let dir = tempfile::tempdir().unwrap();
        let season = dir.path().join("Channel").join("Season 2024");
        fs::create_dir_all(&season).unwrap();
        for (name, finished) in [("one", true), ("two", true), ("three", false)] {
            fs::write(season.join(format!("{name}.info.json")), serde_json::json!({"title": name, "channel": "Channel", "upload_date": "20240501"}).to_string()).unwrap();
            if finished { fs::write(season.join(format!("{name}.mp4")), b"video").unwrap(); }
        }
        assert!(describe_all(dir.path()).is_empty());
        assert!(season.join("one.nfo").is_file() && season.join("two.nfo").is_file());
        // Still downloading: its details wait for the video.
        assert!(!season.join("three.nfo").exists() && season.join("three.info.json").exists());
    }

    #[test]
    fn server_settings_are_checked() {
        let server = |kind: &str, url: &str, token: &str| MediaServer { kind: kind.into(), url: url.into(), token: token.into() };
        assert!(server("", "", "").validate().is_ok());
        assert!(server("jellyfin", "http://192.168.1.10:8096", "abc123").validate().is_ok());
        assert!(server("plex", "https://plex.example:32400/", "token").validate().is_ok());
        assert!(server("jellyfin", "192.168.1.10:8096", "abc").validate().is_err());
        assert!(server("jellyfin", "ftp://host", "abc").validate().is_err());
        assert!(server("plex", "http://host:32400", "a b").validate().is_err());
        assert!(server("kodi", "http://host", "abc").validate().is_err());
        // Nothing listens on port 9 of the loopback address.
        assert!(refresh(&server("jellyfin", "http://127.0.0.1:9", "abc")).is_err());
    }
}
