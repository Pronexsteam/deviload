// Metadata only: no media URLs, cookies or executable arguments cross this boundary.
use crate::model::{self, Options};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::{BTreeMap, HashSet}, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSize { pub url: String, pub bytes: u64, pub approximate: bool, pub complete: bool }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatChoice {
    pub id: String, pub extension: String, pub width: Option<u64>, pub height: Option<u64>, pub fps: Option<f64>,
    pub video_codec: String, pub audio_codec: String, pub bytes: Option<u64>, pub approximate: bool,
    pub has_audio: bool, pub has_video: bool, pub language: String, pub audio_note: String, pub bitrate: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLanguage { pub code: String, pub manual: bool, pub automatic: bool }

fn short(value: &Value, limit: usize) -> String { value.as_str().unwrap_or("").chars().take(limit).collect() }
pub fn formats(info: &Value) -> Vec<FormatChoice> {
    let mut seen = HashSet::new();
    let mut formats: Vec<_> = info["formats"].as_array().into_iter().flatten().take(1500).filter_map(|entry| {
        let id = entry["format_id"].as_str()?;
        if id.is_empty() || !model::valid_format_id(id) || !seen.insert(id.to_owned()) { return None; }
        let video_codec = entry["vcodec"].as_str().unwrap_or("none").to_owned();
        let audio_codec = entry["acodec"].as_str().unwrap_or("none").to_owned();
        let has_audio = audio_codec != "none"; let has_video = video_codec != "none";
        if !has_audio && !has_video { return None; }
        let exact = entry["filesize"].as_u64().filter(|n| *n > 0 && *n <= 1_000_000_000_000);
        let bytes = exact.or_else(|| entry["filesize_approx"].as_u64().filter(|n| *n > 0 && *n <= 1_000_000_000_000));
        let language = entry["language"].as_str().filter(|s| model::valid_language(s)).unwrap_or("").to_owned();
        Some(FormatChoice { id:id.into(),extension:short(&entry["ext"],16),width:entry["width"].as_u64(),height:entry["height"].as_u64(),
            fps:entry["fps"].as_f64().filter(|n| n.is_finite() && *n > 0.),video_codec,audio_codec,bytes,approximate:exact.is_none(),
            has_audio,has_video,language,audio_note:short(&entry["format_note"],100),bitrate:entry["abr"].as_f64().filter(|n| n.is_finite() && *n > 0.) })
    }).collect();
    formats.sort_by(|a,b| b.has_video.cmp(&a.has_video).then_with(|| b.height.cmp(&a.height))
        .then_with(|| b.fps.partial_cmp(&a.fps).unwrap_or(std::cmp::Ordering::Equal)).then_with(|| b.bytes.cmp(&a.bytes)));
    // Retain audio choices across languages, rather than truncating all but one language's codecs.
    let mut chosen: Vec<_> = formats.iter().filter(|f| f.has_video).take(48).cloned().collect();
    chosen.extend(formats.into_iter().filter(|f| !f.has_video).take(80)); chosen
}

pub fn subtitles(info: &Value) -> Vec<SubtitleLanguage> {
    let mut languages: BTreeMap<String,(bool,bool)> = BTreeMap::new();
    for (key, automatic) in [("subtitles",false),("automatic_captions",true)] {
        for (code, items) in info[key].as_object().into_iter().flatten().take(150) {
            if !model::valid_language(code) || code == "live_chat" || !items.as_array().is_some_and(|v| !v.is_empty()) { continue; }
            let entry = languages.entry(code.clone()).or_default();
            if automatic { entry.1 = true; } else { entry.0 = true; }
        }
    }
    languages.into_iter().map(|(code,(manual,automatic))| SubtitleLanguage{code,manual,automatic}).collect()
}

pub fn selected_ids(info: &Value) -> Vec<String> {
    let selected = info["requested_formats"].as_array().or_else(|| info["requested_downloads"][0]["requested_formats"].as_array());
    let parts = selected.map(|a| a.iter().collect::<Vec<_>>()).unwrap_or_else(|| vec![info]);
    parts.into_iter().take(8).filter_map(|v| v["format_id"].as_str())
        .filter(|id| !id.is_empty() && model::valid_format_id(id)).map(str::to_owned).collect()
}

pub fn source_size(info: &Value, url: &str, formats: &[FormatChoice], ids: &[String]) -> Option<SourceSize> {
    if info["_type"] == "playlist" || info["is_live"] == true { return None; }
    let parts = ids.iter().filter_map(|id| formats.iter().find(|f| &f.id == id)).collect::<Vec<_>>();
    let bytes = parts.iter().filter_map(|f| f.bytes).fold(0u64,u64::saturating_add);
    if bytes == 0 { return None; }
    Some(SourceSize {url:url.into(),bytes,approximate:parts.iter().any(|f| f.approximate),
        complete:!ids.is_empty() && parts.len() == ids.len() && parts.iter().all(|f| f.bytes.is_some())})
}

pub fn matching_size<'a>(options: &'a Options, url: &str) -> Option<&'a SourceSize> {
    options.source_size.as_ref().filter(|s| !options.playlist && s.bytes <= 1_000_000_000_000 &&
        model::parse_urls(&s.url).ok().is_some_and(|links| links.len() == 1 && links[0] == url))
}

pub fn same_volume(left: &Path, right: &Path) -> bool {
    #[cfg(unix)] { use std::os::unix::fs::MetadataExt; match (std::fs::metadata(left),std::fs::metadata(right)) { (Ok(a),Ok(b)) => a.dev() == b.dev(), _ => left == right } }
    #[cfg(windows)] {
        let left = std::fs::canonicalize(left).unwrap_or_else(|_| left.into());
        let right = std::fs::canonicalize(right).unwrap_or_else(|_| right.into());
        match (left.components().next(),right.components().next()) {
            (Some(std::path::Component::Prefix(a)),Some(std::path::Component::Prefix(b))) => a.as_os_str().to_string_lossy().eq_ignore_ascii_case(&b.as_os_str().to_string_lossy()),
            _ => left == right,
        }
    }
    #[cfg(not(any(windows,unix)))] { left == right }
}

#[cfg(test)]
mod tests {
    use super::*; use serde_json::json;
    #[test]
    fn inspect_keeps_audio_languages_manual_and_auto_subtitles_and_pair_sizes() {
        let info=json!({"formats":[{"format_id":"v1","vcodec":"avc1","acodec":"none","filesize":1000},
            {"format_id":"a1","vcodec":"none","acodec":"opus","language":"ja","format_note":"Japanese original","abr":128,"filesize_approx":200}],
            "requested_formats":[{"format_id":"v1"},{"format_id":"a1"}],"subtitles":{"ja":[{}],"live_chat":[{}]},"automatic_captions":{"ja":[{}],"en":[{}],"--exec":[{}]}});
        let formats=formats(&info); let ids=selected_ids(&info); let size=source_size(&info,"https://example.com/v",&formats,&ids).unwrap();
        assert_eq!((size.bytes,size.approximate,size.complete),(1200,true,true));
        assert_eq!(formats[1].language,"ja"); assert_eq!(subtitles(&info).len(),2);
        let ja=subtitles(&info).into_iter().find(|v| v.code=="ja").unwrap(); assert!(ja.manual && ja.automatic);
    }
    #[test]
    fn missing_audio_size_is_partial_and_lists_and_live_streams_stay_unknown() {
        let mut info=json!({"formats":[{"format_id":"v","vcodec":"h264","acodec":"none","filesize":1000},
            {"format_id":"a","vcodec":"none","acodec":"aac"}],"requested_formats":[{"format_id":"v"},{"format_id":"a"}]});
        let size=source_size(&info,"https://example.com/v",&formats(&info),&selected_ids(&info)).unwrap(); assert!(!size.complete);
        info["is_live"]=json!(true); assert!(source_size(&info,"x",&formats(&info),&selected_ids(&info)).is_none());
        info["is_live"]=json!(false);info["_type"]=json!("playlist");assert!(source_size(&info,"x",&formats(&info),&selected_ids(&info)).is_none());
    }
    #[test]
    fn estimates_never_follow_a_different_link_or_a_playlist() {
        let mut options=Options{source_size:Some(SourceSize{url:"https://example.com/a".into(),bytes:500,approximate:false,complete:true}),..Options::default()};
        assert!(matching_size(&options,"https://example.com/a").is_some()); assert!(matching_size(&options,"https://example.com/b").is_none());
        options.playlist=true;assert!(matching_size(&options,"https://example.com/a").is_none());
    }
    #[test]
    fn disk_budget_counts_known_queue_sources_and_explicitly_counts_unknown_items() {
        let dir=tempfile::tempdir().unwrap();
        let options=Options{folder:dir.path().to_string_lossy().into(),source_size:Some(SourceSize{url:"https://example.com/new".into(),bytes:1000,approximate:true,complete:true}),..Options::default()};
        let mut queued=crate::model::Job{url:"https://example.com/queued".into(),status:"queued".into(),options:options.clone(),..Default::default()};
        queued.options.source_size=Some(SourceSize{url:queued.url.clone(),bytes:2000,approximate:false,complete:true});
        let unknown=crate::model::Job{url:"https://example.com/unknown".into(),status:"running".into(),options:Options{folder:options.folder.clone(),..Options::default()},..Default::default()};
        let report=crate::check_preflight("https://example.com/new",&options,None,&[queued,unknown]).unwrap();
        assert_eq!(report.estimated_bytes,Some(1000));assert_eq!(report.queue_bytes,2000);assert_eq!(report.unknown_items,1);
        assert_eq!(report.required_bytes,6000+256*1024*1024);assert!(report.approximate);
        let report=crate::check_preflight("https://example.com/a https://example.com/b",&Options{source_size:None,..options},None,&[]).unwrap();
        assert_eq!(report.estimated_bytes,None);assert_eq!(report.unknown_items,2);
    }
    #[test]
    #[ignore = "requires yt-dlp; generated metadata only, no network"]
    fn ytdlp_resolves_the_requested_audio_language_and_retains_alternatives_when_missing() {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("source.info.json");
        std::fs::write(&path,json!({"id":"fixture","title":"Fixture","extractor":"generic","webpage_url":"https://example.invalid/fixture",
            "formats":[{"format_id":"v137","url":"https://example.invalid/video.mp4","vcodec":"avc1","acodec":"none","ext":"mp4","height":720,"filesize":1000},
                {"format_id":"a140","url":"https://example.invalid/audio.m4a","vcodec":"none","acodec":"aac","ext":"m4a","language":"ja","filesize":200}]}).to_string()).unwrap();
        let exe=crate::binary("yt-dlp").unwrap();
        for (language,expected) in [("ja",2),("fr",0)] {
            let options=Options{format_id:"v137".into(),audio_language:language.into(),..Options::default()};
            let output=std::process::Command::new(&exe).args(["--ignore-config","--skip-download","--dump-single-json","--ignore-no-formats-error","-f",&options.format_selector(),"--load-info-json"])
                .arg(&path).output().unwrap();assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
            let info:Value=serde_json::from_slice(&output.stdout).unwrap();assert_eq!(formats(&info).len(),2);assert_eq!(selected_ids(&info).len(),expected);
        }
    }
}
