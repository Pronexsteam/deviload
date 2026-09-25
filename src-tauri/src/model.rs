use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub folder: String,
    pub quality: String,
    #[serde(default)]
    pub profile: String,
    pub playlist: bool,
    #[serde(default)]
    pub playlist_items: String,
    #[serde(default)]
    pub split_chapters: bool,
    pub subtitles: bool,
    pub sponsorblock: bool,
    pub archive: bool,
    pub cookies: String,
    #[serde(default)]
    pub cookies_browser: String,
    pub rate_mbps: u32,
    #[serde(default)]
    pub clip_start: Option<f64>,
    #[serde(default)]
    pub clip_end: Option<f64>,
    #[serde(default)]
    pub clip_format: String,
    #[serde(default)]
    pub folder_rule: String,
    #[serde(default)]
    pub name_rule: String,
    #[serde(default)]
    pub format_id: String,
    #[serde(default)]
    pub format_has_audio: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            folder: dirs::download_dir().unwrap_or_else(|| PathBuf::from(".")).to_string_lossy().into(),
            quality: "1080".into(), profile: "custom".into(), playlist: false, playlist_items: String::new(),
            split_chapters: false, subtitles: false, sponsorblock: false, archive: true,
            cookies: String::new(), cookies_browser: String::new(), rate_mbps: 0,
            clip_start: None, clip_end: None, clip_format: "source".into(),
            folder_rule: "manual".into(), name_rule: "title".into(),
            format_id: String::new(), format_has_audio: false,
        }
    }
}

impl Options {
    pub fn validate(&self) -> Result<(), String> {
        if !["best", "1080", "720", "480", "mp3", "flac", "wav"].contains(&self.quality.as_str()) {
            return Err("Unknown format".into());
        }
        if !["", "custom", "music", "archive", "mobile", "maximum"].contains(&self.profile.as_str()) { return Err("Unknown download profile".into()); }
        if !PathBuf::from(&self.folder).is_absolute() {
            return Err("Enter the full path to the save folder".into());
        }
        if !self.cookies.is_empty() && !PathBuf::from(&self.cookies).is_file() {
            return Err("The cookies file was not found".into());
        }
        if !self.playlist && !self.playlist_items.trim().is_empty() {
            return Err("Turn on the playlist to pick track numbers".into());
        }
        let spec = self.playlist_items.trim();
        if spec.len() > 80 || (!spec.is_empty() && spec.split(',').any(|item| {
            let parts: Vec<_> = item.split('-').collect();
            parts.is_empty() || parts.len() > 2 || parts.iter().any(|part| part.is_empty() || part.parse::<u32>().is_err() || part.parse::<u32>().unwrap_or(0) == 0)
        })) {
            return Err("Playlist items: a number or a range, for example 2 or 1-10,15".into());
        }
        if !self.cookies_browser.is_empty() && !["chrome", "edge", "firefox", "brave", "safari"].contains(&self.cookies_browser.as_str()) {
            return Err("Unknown browser for cookies".into());
        }
        if !self.cookies_browser.is_empty() && !self.cookies.is_empty() {
            return Err("Choose one cookies source: a browser or a file".into());
        }
        if self.rate_mbps > 1000 { return Err("Speed limit: 0–1000 MB/s".into()); }
        if self.format_id.len() > 80 || !self.format_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
            return Err("Invalid source format ID".into());
        }
        if !["", "source", "gif"].contains(&self.clip_format.as_str()) {
            return Err("Unknown clip format".into());
        }
        if !["", "manual", "media", "source", "server"].contains(&self.folder_rule.as_str()) ||
            !["", "title", "date", "channel"].contains(&self.name_rule.as_str()) {
            return Err("Unknown save rule".into());
        }
        match (self.clip_start, self.clip_end) {
            (None, None) if self.clip_format != "gif" => {},
            (Some(start), Some(end)) if start.is_finite() && end.is_finite() &&
                start >= 0.0 && end > start && end - start >= 0.1 && end - start <= 14400.0 => {
                    if self.playlist { return Err("A time clip works for a single link, not a playlist".into()); }
                    if self.clip_format == "gif" && (end - start > 60.0 ||
                        !["best","1080","720","480"].contains(&self.quality.as_str())) {
                        return Err("GIF: pick a video clip of up to 60 seconds".into());
                    }
                },
            _ => return Err("Enter the clip start and end in seconds (up to 4 hours)".into()),
        }
        Ok(())
    }

    // Every value is a separate argv element. No shell, interpolation or escaping.
    pub fn args(&self, url: &str, archive: &std::path::Path) -> Vec<String> {
        let mut a: Vec<String> = [
            "--ignore-config", "--no-simulate", "--newline", "--no-colors", "--encoding", "utf-8",
            "--progress", "--progress-template", "download:DEVI_PROGRESS:%(progress)j",
            "--progress-delta", "0.2",
            "--print", "after_move:DEVI_FILE:%(filepath)j",
            "--retries", "5", "--fragment-retries", "5", "--socket-timeout", "30",
            "--concurrent-fragments", "8", "--continue", "--no-overwrites",
        ].iter().map(|s| s.to_string()).collect();
        a.push(if self.playlist { "--yes-playlist" } else { "--no-playlist" }.into());
        if self.playlist && !self.playlist_items.trim().is_empty() {
            let spec = self.playlist_items.trim();
            let selection = if spec.chars().all(|c| c.is_ascii_digit()) { format!("1:{spec}") } else { spec.into() };
            a.extend(["--playlist-items".into(), selection]);
        }
        if self.split_chapters {
            a.extend(["--split-chapters".into(), "-o".into(),
                "chapter:%(title)s - %(section_number)02d %(section_title)s.%(ext)s".into()]);
        }
        let format = match self.quality.as_str() {
            "mp3" | "flac" | "wav" => {
                a.extend(["-x".into(), "--audio-format".into(), self.quality.clone(), "--add-metadata".into()]);
                if self.quality == "mp3" { a.extend(["--audio-quality".into(), "320K".into()]); }
                if ["mp3", "flac"].contains(&self.quality.as_str()) { a.push("--embed-thumbnail".into()); }
                "bestaudio/best".to_string()
            }
            "best" => "bv*+ba/b".into(),
            height => format!("bv*[height<={height}]+ba/b[height<={height}]/b"),
        };
        let selected_format = if self.format_id.is_empty() { format } else if
            ["mp3", "flac", "wav"].contains(&self.quality.as_str()) || self.format_has_audio {
            self.format_id.clone()
        } else {
            format!("{}+bestaudio/best", self.format_id)
        };
        a.extend(["-f".into(), selected_format]);
        if !["mp3", "flac", "wav"].contains(&self.quality.as_str()) {
            a.extend(["--merge-output-format".into(), if self.profile == "mobile" { "mp4" } else { "mkv" }.into()]);
            if self.profile == "mobile" { a.extend(["--recode-video".into(), "mp4".into()]); }
            if self.subtitles {
                a.extend(["--write-subs".into(), "--write-auto-subs".into(),
                    "--sub-langs".into(), "ru,en".into(), "--embed-subs".into()]);
            }
        }
        if self.sponsorblock { a.extend(["--sponsorblock-remove".into(), "sponsor,selfpromo".into()]); }
        if self.archive && self.clip_start.is_none() {
            // Separate archives per output preset: an MP3 should not suppress a later video download.
            a.extend(["--download-archive".into(),
                archive.join(format!("archive-{}.txt", self.quality)).to_string_lossy().into()]);
        }
        if !self.cookies.is_empty() { a.extend(["--cookies".into(), self.cookies.clone()]); }
        if !self.cookies_browser.is_empty() { a.extend(["--cookies-from-browser".into(), self.cookies_browser.clone()]); }
        if self.rate_mbps > 0 { a.extend(["--limit-rate".into(), format!("{}M", self.rate_mbps)]); }
        if let (Some(start), Some(end)) = (self.clip_start, self.clip_end) {
            a.extend(["--download-sections".into(), format!("*{start:.3}-{end:.3}")]);
        }
        let clip_suffix = match (self.clip_start, self.clip_end) {
            (Some(start), Some(end)) => format!(" - clip {start:.1}-{end:.1}"),
            _ => String::new(),
        };
        let name = if self.folder_rule == "server" { self.server_name() } else {
            let folder_prefix = match self.folder_rule.as_str() {
                "media" => if self.audio_only() { "Music/" } else { "Video/" },
                "source" => "%(extractor_key)s/",
                _ => "",
            };
            let base = match self.name_rule.as_str() {
                "date" => "%(upload_date)s - %(title)s [%(id)s]",
                "channel" => "%(uploader)s - %(title)s [%(id)s]",
                _ => "%(title)s [%(id)s]",
            };
            let playlist_prefix = if self.playlist { "%(playlist_title)s/%(playlist_index)03d - " } else { "" };
            format!("{folder_prefix}{playlist_prefix}{base}")
        };
        if self.folder_rule == "server" && self.audio_only() {
            // Albums: the playlist is the album, its order the track numbers; the cover becomes square.
            a.extend(["--parse-metadata".into(), "%(artist,uploader)s:%(artist)s".into(),
                "--parse-metadata".into(), r"release_year:(?P<meta_date>\d{4})".into()]);
            if self.playlist {
                a.extend(["--parse-metadata".into(), "%(album,playlist_title)s:%(album)s".into(),
                    "--parse-metadata".into(), "%(playlist_index)s:%(track_number)s".into()]);
            }
            if self.quality != "wav" {
                a.extend(["--convert-thumbnails".into(), "jpg".into(), "--ppa".into(),
                    "ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop=\"'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'\"".into()]);
            }
        }
        if self.folder_rule == "server" && !self.audio_only() {
            // A picture and the video's details next to the file; Deviload turns them into what Jellyfin and Plex read.
            a.extend(["--write-thumbnail".into(), "--convert-thumbnails".into(), "jpg".into(), "--write-info-json".into(),
                "--no-write-playlist-metafiles".into(),
                "-o".into(), format!("thumbnail:{name}{clip_suffix}-thumb.%(ext)s")]);
        }
        a.extend(["-P".into(), self.folder.clone(), "-o".into(), format!("{name}{clip_suffix}.%(ext)s"), "--".into(), url.into()]);
        a
    }

    pub fn audio_only(&self) -> bool { ["mp3", "flac", "wav"].contains(&self.quality.as_str()) }

    // The layout media servers recognise: a video is an episode of its channel, dated
    // and grouped by year; music goes by artist and album.
    fn server_name(&self) -> String {
        if self.audio_only() {
            let number = if self.playlist { "%(playlist_index&{:02d} - |)s" } else { "" };
            return format!("%(artist,creator,uploader|Unknown artist)s/%(album,playlist_title|Singles)s/{number}%(track,title)s");
        }
        let channel = "%(channel,uploader|Unknown channel)s";
        format!("{channel}/Season %(upload_date>%Y|0000)s/{channel} - %(upload_date>%Y-%m-%d|0000-00-00)s - %(title)s [%(id)s]")
    }
}

fn proxy_error<T>() -> Result<T, String> {
    Err("Proxy: an address like socks5://127.0.0.1:1080 or http://host:8080".into())
}

// An empty value turns the proxy off. The login part is allowed for proxies that need one.
pub fn parse_proxy(text: &str) -> Result<String, String> {
    let value = text.trim();
    if value.is_empty() { return Ok(String::new()); }
    if value.len() > 200 || value.chars().any(char::is_whitespace) { return proxy_error(); }
    let parsed = url::Url::parse(value).or_else(|_| proxy_error())?;
    if !["http", "https", "socks4", "socks4a", "socks5", "socks5h"].contains(&parsed.scheme())
        || parsed.host_str().is_none() || parsed.port_or_known_default().is_none()
        || !matches!(parsed.path(), "" | "/") || parsed.query().is_some() || parsed.fragment().is_some() {
        return proxy_error();
    }
    Ok(value.trim_end_matches('/').to_string())
}

pub fn parse_urls(text: &str) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut urls = Vec::new();
    for raw in text.split_whitespace() {
        let value = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
        let parsed = url::Url::parse(&value).map_err(|_| format!("Invalid link: {raw}"))?;
        if !["http", "https"].contains(&parsed.scheme()) || parsed.host_str().is_none()
            || !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(format!("An HTTP/HTTPS link without a login and password is required: {raw}"));
        }
        let value = parsed.to_string();
        if seen.insert(value.clone()) { urls.push(value); }
    }
    if urls.is_empty() { return Err("Add at least one link".into()); }
    if urls.len() > 500 { return Err("No more than 500 links at a time".into()); }
    Ok(urls)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub url: String,
    pub options: Options,
    pub status: String,
    pub percent: f64,
    pub speed: String,
    pub file: String,
    pub log: Vec<String>,
    #[serde(default)]
    pub scheduled_at: Option<u64>,
    #[serde(default)]
    pub auto_retry: bool,
    #[serde(default)]
    pub retry_attempts: u8,
    // Items of the last run that yt-dlp skipped because the download archive lists them.
    #[serde(default)]
    pub archived: u32,
    #[serde(skip)]
    pub pid: Option<u32>,
    // The queue and the library can each drop a finished file; the record goes
    // away only when both did. Files on disk are never touched.
    #[serde(default)]
    pub hidden_in_queue: bool,
    #[serde(default)]
    pub hidden_in_library: bool,
}
impl Job {
    pub fn consume(&mut self, line: &str) {
        if let Some(json) = line.strip_prefix("DEVI_PROGRESS:") {
            if let Ok(p) = serde_json::from_str::<serde_json::Value>(json) {
                let total = p["total_bytes"].as_f64().or_else(|| p["total_bytes_estimate"].as_f64()).unwrap_or(0.0);
                if total > 0.0 {
                    self.percent = (100.0 * p["downloaded_bytes"].as_f64().unwrap_or(0.0) / total).clamp(0.0, 100.0);
                }
                // MiB per second; the UI adds the unit.
                self.speed = p["speed"].as_f64().map(|s| format!("{:.1}", s / 1_048_576.0)).unwrap_or_default();
            }
        } else if let Some(json) = line.strip_prefix("DEVI_FILE:") {
            if let Ok(file) = serde_json::from_str::<String>(json) { self.file = file; }
        } else {
            // The archive skips a video even when its file was deleted since; the UI offers to download it again.
            if line.contains("has already been recorded in the archive") { self.archived += 1; }
            // Keep diagnostic output bounded even for long playlists.
            if self.log.len() >= 100 { self.log.remove(0); }
            self.log.push(line.chars().take(2000).collect());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn archive_skips_are_counted() {
        let mut job = Job { id: 1, url: String::new(), options: Options::default(), status: "running".into(), percent: 0.0, speed: String::new(),
            file: String::new(), log: vec![], scheduled_at: None, auto_retry: false, retry_attempts: 0, archived: 0, pid: None,
            hidden_in_queue: false, hidden_in_library: false };
        job.consume("[download] Song one has already been recorded in the archive");
        job.consume("[download] Downloading item 2 of 2");
        job.consume("[download] Song two has already been recorded in the archive");
        assert_eq!(job.archived, 2);
        assert!(job.file.is_empty());
    }
    #[test] fn proxy_accepts_known_schemes_only() {
        assert_eq!(parse_proxy("  ").unwrap(), "");
        assert_eq!(parse_proxy("socks5://127.0.0.1:1080/").unwrap(), "socks5://127.0.0.1:1080");
        assert_eq!(parse_proxy("http://user:pass@proxy.example:8080").unwrap(), "http://user:pass@proxy.example:8080");
        for bad in ["127.0.0.1:1080", "ftp://proxy:21", "socks5://", "http://proxy:8080/path", "http://proxy:8080?x=1", "socks5://host:1080 --exec x"] {
            assert!(parse_proxy(bad).is_err(), "{bad}");
        }
    }
    #[test] fn urls_deduplicate_without_losing_case() {
        assert_eq!(parse_urls("example.com/A https://example.com/A https://example.com/a").unwrap().len(), 2);
        assert!(parse_urls("file:///tmp/a").is_err());
        assert!(parse_urls("").is_err());
        assert!(parse_urls("https://user:pass@example.com").is_err());
    }
    #[test] fn args_preserve_spaces_and_metacharacters() {
        let o = Options { folder: "/tmp/my media & clips".into(), quality: "wav".into(), ..Default::default() };
        let a = o.args("https://example.com/?a=1&b=2", std::path::Path::new("/tmp"));
        assert!(a.contains(&o.folder));
        assert!(a.contains(&"wav".into()));
        assert_eq!(&a[a.len()-2], "--");
        assert_eq!(&a[a.len()-1], "https://example.com/?a=1&b=2");
    }
    #[test] fn archive_is_per_format() {
        let o = Options::default();
        assert!(o.args("https://example.com", std::path::Path::new("/tmp")).iter().any(|s| s.ends_with("archive-1080.txt")));
    }
    #[test] fn playlist_items_chapters_and_browser_cookies_are_argv_values() {
        let o = Options { playlist: true, playlist_items: "2".into(), split_chapters: true,
            cookies_browser: "firefox".into(), ..Default::default() };
        o.validate().unwrap();
        let a = o.args("https://music.youtube.com/playlist?list=abc", std::path::Path::new("/tmp"));
        assert!(a.windows(2).any(|v| v == ["--playlist-items", "1:2"]));
        assert!(a.contains(&"--split-chapters".into()));
        assert!(a.windows(2).any(|v| v == ["--cookies-from-browser", "firefox"]));
        assert!(!a.contains(&"--cookies".into()));
        let selected = Options { playlist_items: "1-10,15".into(), ..o.clone() };
        assert!(selected.args("https://example.com", std::path::Path::new("/tmp")).contains(&"1-10,15".into()));
    }
    #[test] fn invalid_playlist_and_mixed_cookie_sources_are_rejected() {
        let o = Options { playlist: true, playlist_items: "1-2;--exec".into(), ..Default::default() };
        assert!(o.validate().is_err());
        let o = Options { cookies: "cookies.txt".into(), cookies_browser: "chrome".into(), ..Default::default() };
        assert!(o.validate().is_err());
    }
    #[test] fn old_options_load_with_new_fields_disabled() {
        let json = r#"{"folder":"/tmp","quality":"mp3","playlist":false,"subtitles":false,"sponsorblock":false,"archive":false,"cookies":"","rateMbps":0}"#;
        let o: Options = serde_json::from_str(json).unwrap();
        assert!(o.playlist_items.is_empty());
        assert!(!o.split_chapters);
        assert!(o.cookies_browser.is_empty());
    }
    #[test] fn mobile_profile_reencodes_video_to_mp4() {
        let o = Options { profile: "mobile".into(), quality: "720".into(), ..Default::default() };
        o.validate().unwrap();
        let args = o.args("https://example.com/video", std::path::Path::new("/tmp"));
        assert!(args.windows(2).any(|pair| pair == ["--merge-output-format", "mp4"]));
        assert!(args.windows(2).any(|pair| pair == ["--recode-video", "mp4"]));
    }
    #[test] fn exact_format_uses_selected_video_and_audio() {
        let o = Options { format_id: "137".into(), format_has_audio: false, ..Default::default() };
        o.validate().unwrap();
        let args = o.args("https://example.com/video", std::path::Path::new("/tmp"));
        assert!(args.windows(2).any(|part| part == ["-f", "137+bestaudio/best"]));
        let audio = Options { quality: "mp3".into(), format_id: "251".into(), ..Default::default() };
        assert!(audio.args("https://example.com/video", std::path::Path::new("/tmp"))
            .windows(2).any(|part| part == ["-f", "251"]));
        assert!(Options { format_id: "bad;echo".into(), ..o }.validate().is_err());
    }
    #[test] fn clip_and_organization_arguments_are_validated() {
        let o = Options { clip_start: Some(12.5), clip_end: Some(27.0), clip_format: "gif".into(),
            folder_rule: "source".into(), name_rule: "date".into(), ..Default::default() };
        o.validate().unwrap();
        let args = o.args("https://example.com/video", std::path::Path::new("/tmp"));
        assert!(args.windows(2).any(|pair| pair == ["--download-sections", "*12.500-27.000"]));
        assert!(args.iter().any(|part| part.contains("%(extractor_key)s/") && part.contains("clip 12.5-27.0")));
        assert!(!args.iter().any(|part| part == "--download-archive"));
        assert!(Options { clip_end: Some(80.0), ..o.clone() }.validate().is_err());
        assert!(Options { playlist: true, ..o.clone() }.validate().is_err());
        assert!(Options { quality: "mp3".into(), ..o }.validate().is_err());
    }
    #[test] fn media_server_layout() {
        let video = Options { folder_rule: "server".into(), ..Default::default() };
        video.validate().unwrap();
        let args = video.args("https://example.com/video", std::path::Path::new("/tmp"));
        let output = args.windows(2).filter(|pair| pair[0] == "-o").map(|pair| pair[1].clone()).collect::<Vec<_>>();
        assert!(output[1].starts_with("%(channel,uploader|Unknown channel)s/Season %(upload_date>%Y|0000)s/"), "{output:?}");
        assert!(output[1].ends_with(" - %(title)s [%(id)s].%(ext)s"));
        assert_eq!(output[0], format!("thumbnail:{}-thumb.%(ext)s", output[1].trim_end_matches(".%(ext)s")));
        assert!(args.iter().any(|part| part == "--write-info-json"));
        let music = Options { folder_rule: "server".into(), quality: "mp3".into(), playlist: true, ..Default::default() };
        let args = music.args("https://example.com/album", std::path::Path::new("/tmp"));
        assert!(args.iter().any(|part| part == "%(artist,creator,uploader|Unknown artist)s/%(album,playlist_title|Singles)s/%(playlist_index&{:02d} - |)s%(track,title)s.%(ext)s"));
        assert!(!args.iter().any(|part| part == "--write-info-json"));
        assert!(args.windows(2).any(|pair| pair == ["--parse-metadata", "%(playlist_index)s:%(track_number)s"]));
        assert!(args.iter().any(|part| part.starts_with("ThumbnailsConvertor+FFmpeg_o:") && part.contains("crop=")));
    }
    #[test] fn progress_is_not_completion() {
        let mut j = Job { id: 1, url: String::new(), options: Options::default(), status: "running".into(),
            percent: 0.0, speed: String::new(), file: String::new(), log: vec![], scheduled_at: None, auto_retry: false, retry_attempts: 0, archived: 0, pid: None, hidden_in_queue: false, hidden_in_library: false };
        j.consume(r#"DEVI_PROGRESS:{"downloaded_bytes":100,"total_bytes":100,"speed":1048576}"#);
        assert_eq!(j.percent, 100.0);
        assert_eq!(j.status, "running");
        j.consume(r#"DEVI_FILE:"/tmp/a b.mkv""#);
        assert_eq!(j.file, "/tmp/a b.mkv");
        for _ in 0..150 { j.consume("diagnostic"); }
        assert_eq!(j.log.len(), 100);
    }
}
