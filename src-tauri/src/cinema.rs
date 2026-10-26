//! Cinema uses the downloader's extraction transport, but never the music catalog,
//! recommendations, source selection or playback registry.
use serde::Serialize;
use serde_json::Value;
use std::{sync::{Arc, Mutex, OnceLock, Weak, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};

static DISCOVERY: AtomicU64 = AtomicU64::new(0);
static HOME_DISCOVERY: AtomicU64 = AtomicU64::new(0);
static PLAYBACK: AtomicU64 = AtomicU64::new(0);
static SEARCH_HOME: AtomicU64 = AtomicU64::new(0);
static SEARCH_TOPIC: AtomicU64 = AtomicU64::new(0);
const PAGE: usize = 50;
// Automatic caption catalogs can exceed 10 MB for a single video. The player
// needs only the selected progressive format, never the entire extractor dump.
const STREAM_TEMPLATE: &str = "%(.{id,ext,vcodec,acodec,url,filesize,http_headers,height,is_live,has_drm})j";
const FORMAT_TEMPLATE: &str = "%(formats.:.{height,ext,vcodec,acodec,protocol})j";
const STREAM_KEYS: &[&str] = &["id","ext","vcodec","acodec","url","filesize","http_headers","height","is_live","has_drm"];
struct CachedVideo { id:String, quality:Option<u32>, proxy:String, value:Value, created:Instant, source:Weak<crate::music_audio::Source> }
static VERIFIED_STREAMS: OnceLock<Mutex<Vec<CachedVideo>>> = OnceLock::new();
fn compact_stream(value:&Value)->Value {
    let mut result=Value::Object(STREAM_KEYS.iter().filter_map(|key|value.get(*key).map(|v|((*key).to_owned(),v.clone()))).collect());
    result["qualities"]=serde_json::to_value(qualities(value)).unwrap();result
}
fn progressive(format:&Value)->bool {format["ext"]=="mp4"&&format["protocol"]=="https"&&format["vcodec"].as_str().is_some_and(|s|s.starts_with("avc1"))&&format["acodec"].as_str().is_some_and(|s|s.starts_with("mp4a"))}
fn qualities(value:&Value)->Vec<u64>{
    let mut heights:Vec<u64>=value["formats"].as_array().into_iter().flatten().filter(|f|progressive(f)).filter_map(|f|f["height"].as_u64()).collect();
    heights.extend(value["qualities"].as_array().into_iter().flatten().filter_map(Value::as_u64));
    heights.extend(value["height"].as_u64());heights.retain(|h|(144..=4320).contains(h));heights.sort_unstable();heights.dedup();heights
}
fn parse_stream_output(bytes:&[u8])->Result<Value,String>{
    let mut rows=serde_json::Deserializer::from_slice(bytes).into_iter::<Value>();
    let mut selected=rows.next().transpose().map_err(|_|UNSUPPORTED)?.ok_or(UNSUPPORTED)?;
    if !selected.is_object(){return Err(UNSUPPORTED.into());}
    if let Some(formats)=rows.next(){selected["formats"]=formats.map_err(|_|UNSUPPORTED)?;}
    if rows.next().is_some(){return Err(UNSUPPORTED.into());}Ok(compact_stream(&selected))
}
fn cache_fresh(value:&Value, age:Duration, now:u64)->bool {
    if age>=Duration::from_secs(180){return false;}
    let Some(url)=value["url"].as_str().and_then(|raw|url::Url::parse(raw).ok()) else{return false;};
    crate::music_audio::trusted_url(&url)&&url.query_pairs().find(|(key,_)|key=="expire")
        .and_then(|(_,v)|v.parse::<u64>().ok()).is_some_and(|expiry|expiry>now.saturating_add(60))
}
fn cached_stream(id:&str,quality:Option<u32>,proxy:&str)->Option<Value> {
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    let mut entries=VERIFIED_STREAMS.get_or_init(Default::default).lock().unwrap();
    entries.retain(|entry|cache_fresh(&entry.value,entry.created.elapsed(),now)&&!entry.source.upgrade().is_some_and(|source|source.failed()));
    entries.iter().find(|entry|entry.id==id&&entry.quality==quality&&entry.proxy==proxy).map(|entry|entry.value.clone())
}
fn forget_stream(id:&str){VERIFIED_STREAMS.get_or_init(Default::default).lock().unwrap().retain(|entry|entry.id!=id);}
fn remember_stream(id:&str,quality:Option<u32>,proxy:&str,value:&Value,source:&Arc<crate::music_audio::Source>){
    let mut value=compact_stream(value);value["filesize"]=source.size.into();
    // Keep only two tiny descriptors, no video buffers or library/profile data.
    let mut entries=VERIFIED_STREAMS.get_or_init(Default::default).lock().unwrap();
    entries.retain(|entry|entry.id!=id||entry.quality!=quality);if entries.len()>=2 {entries.remove(0);}
    entries.push(CachedVideo{id:id.into(),quality,proxy:proxy.into(),value,created:Instant::now(),source:Arc::downgrade(source)});
}
const UNSUPPORTED: &str = "No compatible video with audio is available. Download the video to watch it.";
pub(crate) fn source_failure(error: crate::music_audio::SourceError) -> &'static str {
    use crate::music_audio::SourceError;
    match error {
        SourceError::Denied => "YouTube refused this video stream (HTTP 403/401). Choose another video or try again later.",
        SourceError::Limited => "YouTube is temporarily limiting playback. Try again later.",
        SourceError::Network => "The video connection timed out or was interrupted. Check your connection and retry.",
        SourceError::Invalid => "The video source returned an invalid response. Choose another video."
    }
}

// Never log extractor JSON, stderr, signed addresses or request headers.
fn stage<T>(name: &'static str, result: Result<T,String>) -> Result<T,String> {
    if result.is_err(){eprintln!("Cinema preparation failed: {name}");}
    result
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Entry { id: String, index: u64, title: String, duration: Option<f64>, unavailable: bool }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Page { title: String, entries: Vec<Entry>, next: Option<u64> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Stream { url: String, height: Option<u64>, qualities: Vec<u64> }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SearchEntry { id: String, title: String, channel: String, duration: Option<f64> }

fn search_lane(lane: &str) -> Result<&'static AtomicU64,String> {
    match lane { "home"=>Ok(&SEARCH_HOME), "topic"=>Ok(&SEARCH_TOPIC), _=>Err("Unknown search source".into()) }
}

#[tauri::command]
pub fn cinema_cancel_search(lane: String) -> Result<(),String> {
    search_lane(&lane)?.fetch_add(1,Ordering::SeqCst); Ok(())
}

fn search_entries(value: &Value) -> Vec<SearchEntry> {
    let mut seen=std::collections::HashSet::new();
    value["entries"].as_array().into_iter().flatten().filter_map(|item|{
        let id=item["id"].as_str().unwrap_or("");
        let title=item["title"].as_str().unwrap_or("").trim();
        if !video_id(id)||title.is_empty()||!seen.insert(id)||item["is_live"]==true
            ||matches!(item["availability"].as_str(),Some("private"|"premium_only"|"subscriber_only"|"needs_auth")) {return None;}
        Some(SearchEntry{id:id.into(),title:title.into(),channel:item["channel"].as_str().or_else(||item["uploader"].as_str()).unwrap_or("").into(),duration:item["duration"].as_f64().filter(|n|n.is_finite()&&*n>=0.0)})
    }).take(20).collect()
}

#[tauri::command]
pub async fn cinema_search(query: String, lane: String, engine: tauri::State<'_,crate::Engine>) -> Result<Vec<SearchEntry>,String> {
    let query=query.trim().to_owned();
    if query.is_empty()||query.chars().count()>120 {return Err("Enter a query of 1 to 120 characters".into());}
    let sequence=search_lane(&lane)?;
    let generation=sequence.fetch_add(1,Ordering::SeqCst)+1;
    let proxy=crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move||{
        let cancelled=||sequence.load(Ordering::SeqCst)!=generation;
        // Public metadata only: no account cookies, plugin, or stream extraction.
        let mut cmd=crate::ytdlp_command_with(&crate::binary("yt-dlp")?,&proxy);
        cmd.args(["--ignore-config","--no-plugin-dirs","--flat-playlist","--skip-download","--dump-single-json","--no-warnings","--no-colors","--socket-timeout","10","--retries","0","--extractor-retries","0","--"])
            .arg(format!("ytsearch20:{query}"));
        let output=crate::engine_update::json_output_cancellable(&mut cmd,Duration::from_secs(30),&cancelled)?;
        if cancelled(){return Err("Cancelled".into());}
        if !output.status.success(){return Err("Could not search videos. Try again.".into());}
        let value:Value=serde_json::from_slice(&output.stdout).map_err(|_|"Could not search videos. Try again.")?;
        Ok(search_entries(&value))
    }).await.map_err(|_|"Could not search videos. Try again.".to_owned())?
}

fn video_id(id: &str) -> bool { id.len()==11 && id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-') }
fn address(raw: &str) -> Result<String,String> {
    let u=url::Url::parse(raw.trim()).map_err(|_|"Enter a YouTube video or playlist link.")?;
    if !matches!(u.scheme(),"https"|"http") || !matches!(u.host_str(),Some("www.youtube.com"|"youtube.com"|"m.youtube.com"|"music.youtube.com"|"youtu.be"))
        || !u.username().is_empty() || u.password().is_some() || u.port().is_some() {return Err("Enter a YouTube video or playlist link.".into());}
    // Canonical URLs keep arbitrary URL paths and parameters out of extraction.
    if let Some((_,list))=u.query_pairs().find(|(key,_)|key=="list") {
        if list.len()>150 || list.is_empty() || !list.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){return Err("Invalid playlist link".into());}
        return Ok(format!("https://www.youtube.com/playlist?list={list}"));
    }
    let id=if u.host_str()==Some("youtu.be") {u.path().trim_matches('/').to_owned()}
        else if let Some((_,id))=u.query_pairs().find(|(key,_)|key=="v"){id.into_owned()}
        else {u.path().strip_prefix("/shorts/").or_else(||u.path().strip_prefix("/embed/")).unwrap_or("").trim_matches('/').to_owned()};
    if !video_id(&id){return Err("Enter a YouTube video or playlist link.".into());}
    Ok(format!("https://www.youtube.com/watch?v={id}"))
}

fn parse_page(value: &Value, start: u64) -> Page {
    let rows=value["entries"].as_array().cloned().unwrap_or_else(||vec![value.clone()]);
    let more=rows.len()>PAGE;
    let entries=rows.iter().take(PAGE).enumerate().map(|(offset,item)| {
        let id=item["id"].as_str().unwrap_or("");
        let availability=item["availability"].as_str().unwrap_or("");
        Entry {id:id.to_owned(),index:item["playlist_index"].as_u64().unwrap_or(start+offset as u64),
            title:item["title"].as_str().filter(|s|!s.is_empty()).unwrap_or("Unavailable video").to_owned(),duration:item["duration"].as_f64(),
            unavailable:!video_id(id)||matches!(availability,"private"|"premium_only"|"subscriber_only"|"needs_auth")||matches!(item["title"].as_str(),Some("[Deleted video]"|"[Private video]"))}
    }).collect();
    Page {title:value["title"].as_str().unwrap_or("Online video").to_owned(),entries,next:more.then_some(start+PAGE as u64)}
}

#[tauri::command]
pub async fn cinema_entries(address: String, start: Option<u64>, lane: Option<String>, engine: tauri::State<'_,crate::Engine>) -> Result<Page,String> {
    let address=self::address(&address)?;
    let start=start.unwrap_or(1);
    if start==0||start>100_000{return Err("Invalid playlist page".into());}
    let sequence=if lane.as_deref()==Some("home"){&HOME_DISCOVERY}else{&DISCOVERY};
    let generation=sequence.fetch_add(1,Ordering::SeqCst)+1;
    let proxy=crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move||{
        let cancelled=||sequence.load(Ordering::SeqCst)!=generation;
        let mut cmd=crate::ytdlp_command_with(&crate::binary("yt-dlp")?,&proxy);
        cmd.args(["--ignore-config","--no-plugin-dirs","--flat-playlist","--skip-download","--ignore-errors","--no-warnings","--no-colors","--socket-timeout","10","--retries","0","--extractor-retries","0"]);
        // A single watch URL is not flat even with --flat-playlist. Project its
        // metadata so caption catalogs cannot exhaust the bounded JSON reader.
        if address.contains("/watch?v=") {cmd.args(["--print","%(.{id,title,duration,availability})j"]);} else {cmd.arg("--dump-single-json");}
        cmd.args(["--playlist-start",&start.to_string(),"--playlist-end",&(start+PAGE as u64).to_string()]).arg("--").arg(address);
        let output=crate::engine_update::json_output_cancellable(&mut cmd,Duration::from_secs(35),&cancelled)?;
        if cancelled(){return Err("Cancelled".into());}
        let value:Value=serde_json::from_slice(&output.stdout).map_err(|_|"Could not open the video or playlist. Check the link and try again.")?;
        // --ignore-errors may legitimately return a partial playlist. An error
        // object or failed single extraction must not become a successful page.
        if !value["entries"].is_array() && (!output.status.success()||!value["id"].as_str().is_some_and(video_id)) {
            return Err("Could not open the video or playlist. Check the link and try again.".into());
        }
        Ok(parse_page(&value,start))
    }).await.map_err(|_|"Could not open the video or playlist. Check the link and try again.".to_owned())?
}

fn video_source(value: &Value, proxy: &str) -> Result<crate::music_audio::Source,String> {
    let video=value["vcodec"].as_str().unwrap_or("");
    let audio=value["acodec"].as_str().unwrap_or("");
    if value["ext"]!="mp4" || !video.starts_with("avc1") || !audio.starts_with("mp4a") || value["is_live"]==true || value["has_drm"]==true {return stage("format-compatibility",Err(UNSUPPORTED.into()));}
    let raw=stage("missing-address",value["url"].as_str().ok_or_else(||UNSUPPORTED.to_owned()))?;
    let url=url::Url::parse(raw).map_err(|_|{eprintln!("Cinema preparation failed: invalid-address");UNSUPPORTED})?;
    let size=value["filesize"].as_u64().or_else(||url.query_pairs().find(|(k,_)|k=="clen").and_then(|(_,v)|v.parse().ok())).unwrap_or(0);
    crate::music_audio::Source::video(url,size,value["http_headers"]["User-Agent"].as_str().unwrap_or("Mozilla/5.0"),proxy)
}

fn selected_source(id: &str, value: &Value, proxy: &str) -> Result<crate::music_audio::Source,String> {
    if value["id"].as_str()!=Some(id){return stage("video-identity",Err("Could not start the video. Try again later.".into()));}
    video_source(value,proxy)
}

#[tauri::command]
pub async fn cinema_stream(id: String, quality: Option<u32>, engine: tauri::State<'_,crate::Engine>) -> Result<Stream,String> {
    if !video_id(&id){return Err("Unavailable video".into());}
    let quality=quality.filter(|height|(144..=4320).contains(height));
    let generation=PLAYBACK.fetch_add(1,Ordering::SeqCst)+1;
    crate::music_audio::clear_video();
    let proxy=crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move||{
        let cancelled=||PLAYBACK.load(Ordering::SeqCst)!=generation;
        if cancelled(){return Err("Cancelled".into());}
        let began=Instant::now();let cached=cached_stream(&id,quality,&proxy);let reused=cached.is_some();
        let value:Value=if let Some(value)=cached {value} else {
        let mut cmd=crate::ytdlp_command_with(&crate::binary("yt-dlp")?,&proxy);
        if let Ok(deno)=crate::binary("deno"){cmd.args(["--js-runtimes",&format!("deno:{}",deno.display())]);}
        let format=format!("best[ext=mp4][vcodec^=avc1][acodec^=mp4a][protocol=https]{}",quality.map(|height|format!("[height<={height}]")).unwrap_or_default());
        cmd.args(["--ignore-config","--no-plugin-dirs","--no-playlist","--skip-download","--print",STREAM_TEMPLATE,"--print",FORMAT_TEMPLATE,"--no-warnings","--no-colors","--socket-timeout","10","--retries","0","--extractor-retries","0","-f",&format])
            .arg("--").arg(format!("https://www.youtube.com/watch?v={id}"));
        let output=stage("extractor-process",crate::engine_update::json_output_cancellable(&mut cmd,Duration::from_secs(40),&cancelled))?;
        if !output.status.success(){return stage("extractor-exit",Err(UNSUPPORTED.into()));}
        stage("extractor-json",parse_stream_output(&output.stdout))?
        };
        eprintln!("Cinema timing: metadata_ms={}, reused={reused}",began.elapsed().as_millis());
        if cancelled(){return Err("Cancelled".into());}
        let source=Arc::new(stage("source-selection",selected_source(&id,&value,&proxy)).inspect_err(|_|forget_stream(&id))?);
        source.verify_cancellable(Instant::now()+Duration::from_secs(12),&cancelled).map_err(|error|{
            forget_stream(&id);
            eprintln!("Cinema preparation failed: first-buffer ({error:?}, cancelled={})",cancelled());
            source_failure(error)
        })?;
        if cancelled(){return Err("Cancelled".into());}
        remember_stream(&id,quality,&proxy,&value,&source);
        eprintln!("Cinema timing: ready_ms={}",began.elapsed().as_millis());
        let url=stage("relay-registration",crate::music_audio::register_video(source))?;
        if cancelled(){crate::music_audio::release_video(&url);return Err("Cancelled".into());}
        Ok(Stream {url,height:value["height"].as_u64(),qualities:qualities(&value)})
    }).await.map_err(|_|"Could not start the video. Try again later.".to_owned())?
}

#[tauri::command]
pub fn cinema_cancel(discovery: Option<bool>, playback: Option<bool>, home_discovery: Option<bool>) {
    if home_discovery.unwrap_or(false){HOME_DISCOVERY.fetch_add(1,Ordering::SeqCst);}
    if discovery.unwrap_or(false){DISCOVERY.fetch_add(1,Ordering::SeqCst);}
    if playback.unwrap_or(true){PLAYBACK.fetch_add(1,Ordering::SeqCst);crate::music_audio::clear_video();}
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn compact_extractor_records_list_only_playable_quality_levels() {
        let selected=json!({"id":"abcdefghijk","height":360});
        let formats=json!([
            {"height":360,"ext":"mp4","protocol":"https","vcodec":"avc1.4d","acodec":"mp4a.40"},
            {"height":720,"ext":"mp4","protocol":"https","vcodec":"avc1.4d","acodec":"mp4a.40"},
            {"height":1080,"ext":"mp4","protocol":"https","vcodec":"avc1.4d","acodec":"none"},
            {"height":720,"ext":"mp4","protocol":"https","vcodec":"avc1.4d","acodec":"mp4a.40"}]);
        let parsed=parse_stream_output(format!("{selected}\n{formats}\n").as_bytes()).unwrap();
        assert_eq!(qualities(&parsed),vec![360,720]);assert!(parsed.get("formats").is_none());
        assert!(parse_stream_output(b"null").is_err());assert!(parse_stream_output(b"{}\n[]\n{}").is_err());
    }
    #[test] fn stream_projection_drops_caption_catalogs_and_other_formats() {
        let input=json!({"id":"abcdefghijk","url":"https://rr1.googlevideo.com/a?expire=9000","ext":"mp4","vcodec":"avc1.4d","acodec":"mp4a.40.2","filesize":12345,"http_headers":{"User-Agent":"test"},"automatic_captions":{"en":{"url":"x".repeat(10*1024*1024)}},"formats":[{"url":"unused"}]});
        let result=compact_stream(&input);assert!(serde_json::to_vec(&result).unwrap().len()<1024);
        assert_eq!(result["id"],input["id"]);assert_eq!(result["url"],input["url"]);assert_eq!(result["http_headers"],input["http_headers"]);
        assert!(result.get("automatic_captions").is_none());assert!(result.get("formats").is_none());
    }
    #[test] fn verified_descriptor_cache_expires_before_signed_address_and_has_a_hard_age_limit() {
        let value=json!({"url":"https://rr1.googlevideo.com/a?expire=1000"});
        assert!(cache_fresh(&value,Duration::from_secs(1),939));
        assert!(!cache_fresh(&value,Duration::from_secs(1),940));
        assert!(!cache_fresh(&value,Duration::from_secs(180),100));
        assert!(!cache_fresh(&json!({"url":"https://rr1.googlevideo.com/a"}),Duration::ZERO,100));
        assert!(!cache_fresh(&json!({"url":"https://example.com/a?expire=1000"}),Duration::ZERO,100));
    }
    #[test] fn verified_descriptors_are_small_bounded_and_separate_by_proxy() {
        let expires=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()+600;
        let make=|id:&str|json!({"id":id,"url":format!("https://rr1.googlevideo.com/a?expire={expires}"),"ext":"mp4","vcodec":"avc1.4d","acodec":"mp4a.40.2","filesize":100});
        let (a,b,c)=(make("cache-test1"),make("cache-test2"),make("cache-test3"));
        let source=Arc::new(video_source(&a,"").unwrap());
        remember_stream("cache-test1",None,"",&a,&source);remember_stream("cache-test2",None,"",&b,&source);remember_stream("cache-test3",None,"",&c,&source);
        assert!(cached_stream("cache-test1",None,"").is_none());assert!(cached_stream("cache-test2",None,"").is_some());assert!(cached_stream("cache-test2",None,"different").is_none());
        forget_stream("cache-test2");assert!(cached_stream("cache-test2",None,"").is_none());forget_stream("cache-test3");
    }
    #[test] fn metadata_search_deduplicates_and_filters_without_stream_fields() {
        let rows=search_entries(&json!({"entries":[null,{"id":"abcdefghijk","title":"A","channel":"Author","duration":90,"url":"must-not-leak"},{"id":"abcdefghijk","title":"Duplicate"},{"id":"bbbbbbbbbbb","title":"Private","availability":"private"},{"id":"ccccccccccc","title":"Live","is_live":true},{"id":"ddddddddddd","title":"D","uploader":"Uploader"}]}));
        assert_eq!(rows.len(),2);assert_eq!(rows[0].channel,"Author");assert_eq!(rows[1].channel,"Uploader");
        let encoded=serde_json::to_string(&rows).unwrap();assert!(!encoded.contains("must-not-leak"));
    }
    #[test] fn metadata_lanes_are_isolated() {
        assert!(!std::ptr::eq(search_lane("home").unwrap(),search_lane("topic").unwrap()));
        assert!(!std::ptr::eq(search_lane("home").unwrap(),&DISCOVERY));
        assert!(!std::ptr::eq(&HOME_DISCOVERY,&DISCOVERY));assert!(search_lane("other").is_err());
    }
    #[test] fn canonical_links_reject_other_hosts_and_keep_playlist() {
        assert_eq!(address("https://youtu.be/abcdefghijk?t=3").unwrap(),"https://www.youtube.com/watch?v=abcdefghijk");
        assert_eq!(address("https://www.youtube.com/watch?v=abcdefghijk&list=PLabc").unwrap(),"https://www.youtube.com/playlist?list=PLabc");
        for url in ["https://youtube.com.evil/watch?v=abcdefghijk","https://user@youtube.com/watch?v=abcdefghijk","file:///etc/passwd","https://youtube.com/redirect?q=x"] {assert!(address(url).is_err());}
    }
    #[test] fn unavailable_positions_and_lookahead_survive() {
        let mut rows=vec![Value::Null;51];rows[1]=json!({"id":"abcdefghijk","title":"A","playlist_index":52});
        let page=parse_page(&json!({"entries":rows}),51);
        assert_eq!(page.entries.len(),50);assert_eq!(page.next,Some(101));assert!(page.entries[0].unavailable);assert_eq!(page.entries[1].index,52);
    }
    #[test] fn rejects_audio_only_adaptive_drm_and_remote_urls() {
        for value in [json!({"ext":"mp4","vcodec":"none","acodec":"mp4a.40.2"}),json!({"ext":"mp4","vcodec":"avc1.4d","acodec":"none"}),json!({"ext":"mp4","vcodec":"avc1.4d","acodec":"mp4a.40.2","has_drm":true}),json!({"ext":"mp4","vcodec":"avc1.4d","acodec":"mp4a.40.2","filesize":100,"url":"https://example.org/a"})] {assert!(video_source(&value,"").is_err());}
    }
    #[test] fn source_must_match_requested_video_and_uses_video_mime() {
        let value=json!({"id":"abcdefghijk","ext":"mp4","vcodec":"avc1.4d401e","acodec":"mp4a.40.2","filesize":3000000000_u64,"url":"https://rr1.googlevideo.com/videoplayback"});
        assert!(selected_source("differentID",&value,"").is_err());
        let source=selected_source("abcdefghijk",&value,"").unwrap();assert_eq!(source.mime,"video/mp4");assert_eq!(source.size,3000000000);
    }
}
