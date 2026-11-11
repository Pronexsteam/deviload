use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, io::Read, sync::{Arc, Mutex, OnceLock}, time::{Duration, Instant}};

const ORIGIN: &str = "https://music.youtube.com";
const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CATALOG_ERROR: &str = "Music is unavailable right now. Check your connection and try again.";
static VERSION: OnceLock<Mutex<Option<(Instant, String)>>> = OnceLock::new();
static CATALOG_CLIENT: OnceLock<Mutex<Option<(String,Client)>>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    kind: String,
    title: String,
    subtitle: String,
    artists: Vec<String>,
    image: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowseTarget { id: String, params: String }
#[derive(Clone, Debug, Serialize)]
pub struct Section { title: String, items: Vec<Item>, #[serde(skip_serializing_if = "Option::is_none")] more: Option<BrowseTarget> }

#[derive(Clone, Debug, Serialize)]
pub struct Catalog {
    sections: Vec<Section>, continuation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artwork: Option<BrowseArtwork>,
}
#[derive(Clone, Debug, Serialize)]
pub struct BrowseArtwork { id: String, image: String }

fn transient_catalog_status(status:u16)->bool{matches!(status,500|502|503|504)}
// Include the body in the attempt: a successful header does not guarantee a complete page.
fn catalog_bytes(request:reqwest::blocking::RequestBuilder,original_id:Option<&str>)->Result<Vec<u8>,String>{
    const LIMIT:u64=6*1024*1024;
    let attempt=|request:reqwest::blocking::RequestBuilder,seconds|{
        let response=request.timeout(Duration::from_secs(seconds)).send().map_err(|e|{
            eprintln!("Music catalog transport failed (timeout: {}, connection: {})",e.is_timeout(),e.is_connect());
            (e.is_timeout()||e.is_connect()||e.is_request(),CATALOG_ERROR)
        })?;
        if !response.status().is_success(){
            eprintln!("Music catalog HTTP {}",response.status().as_u16());
            let status=response.status().as_u16();
            if let Some(id)=original_id{
                if matches!(status,401|403){crate::music_engine::note_reserve_denial(id);}
                if status==429{
                    let seconds=response.headers().get("Retry-After").and_then(|v|v.to_str().ok()).and_then(|v|crate::music_audio::retry_after_seconds(v,std::time::SystemTime::now()));
                    note_playback_limit(seconds);
                }
            }
            let reason=match status {
                401|403=>"YouTube declined this catalog request.",
                429=>"YouTube is temporarily limiting catalog requests.",
                _=>CATALOG_ERROR
            };
            return Err((transient_catalog_status(status),reason));
        }
        if response.content_length().is_some_and(|length|length>LIMIT){return Err((false,CATALOG_ERROR));}
        let mut bytes=Vec::new();
        response.take(LIMIT+1).read_to_end(&mut bytes).map_err(|_|(true,CATALOG_ERROR))?;
        if bytes.len() as u64>LIMIT{return Err((false,CATALOG_ERROR));}
        Ok(bytes)
    };
    if let Some(id)=original_id{allow_catalog_recovery(id)?;}
    let retry=request.try_clone();
    match (attempt(request,8),retry){
        (Ok(bytes),_)=>Ok(bytes),
        (Err((true,_)),Some(retry))=>{
            std::thread::sleep(Duration::from_millis(150));
            if let Some(id)=original_id{allow_catalog_recovery(id)?;}
            attempt(retry,12).map_err(|(_,reason)|reason.to_owned())
        },
        (Err((_,reason)),_)=>Err(reason.to_owned()),
    }
}

fn client(proxy: &str) -> Result<Client, String> {
    let mut cached=CATALOG_CLIENT.get_or_init(||Mutex::new(None)).lock().unwrap();
    if let Some((key,client))=cached.as_ref(){if key==proxy{return Ok(client.clone());}}
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = Client::builder().user_agent(AGENT).timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::limited(3));
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| CATALOG_ERROR)?); }
    let client=builder.build().map_err(|_|CATALOG_ERROR.to_owned())?;
    *cached=Some((proxy.to_owned(),client.clone()));
    Ok(client)
}

fn client_version(client: &Client) -> Result<String, String> {client_version_for_recovery(client,None)}
fn client_version_for_recovery(client:&Client,original_id:Option<&str>)->Result<String,String>{
    let mut cache = VERSION.get_or_init(|| Mutex::new(None)).lock().unwrap();
    if let Some((at, value)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(3600) { return Ok(value.clone()); }
    }
    let bytes = catalog_bytes(client.get(ORIGIN),original_id)?;
    let text = String::from_utf8_lossy(&bytes);
    let version = text.split("\"INNERTUBE_CLIENT_VERSION\":\"").nth(1)
        .and_then(|tail| tail.split('"').next()).filter(|v| v.len() < 60 && !v.is_empty())
        .ok_or(CATALOG_ERROR)?.to_owned();
    *cache = Some((Instant::now(), version.clone()));
    Ok(version)
}

fn text(value: &Value) -> String {
    value["simpleText"].as_str().map(str::to_owned).unwrap_or_else(||
        value["runs"].as_array().map(|runs| runs.iter().filter_map(|r| r["text"].as_str()).collect()).unwrap_or_default())
}

fn find<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map.get(key).or_else(|| map.values().find_map(|v| find(v, key))),
        Value::Array(values) => values.iter().find_map(|v| find(v, key)),
        _ => None,
    }
}

fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 160 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }
fn video_id(id: &str) -> bool { id.len() == 11 && valid_id(id) }

fn image(value: &Value) -> String {
    find(value, "thumbnails").and_then(Value::as_array).and_then(|items| items.iter().rev().filter_map(|v| v["url"].as_str()).find(|raw| {
            raw.len() <= 2048 && url::Url::parse(raw).ok().is_some_and(|u| u.scheme() == "https" && u.username().is_empty() && u.password().is_none() && u.port().is_none() && u.host_str().is_some_and(|h|
                h == "i.ytimg.com" || h == "lh3.googleusercontent.com" || h == "yt3.googleusercontent.com"))
        })).unwrap_or("").to_owned()
}

fn artists(value: &Value) -> Vec<String> {
    let mut names = Vec::new();
    fn visit(value: &Value, names: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                if value["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str().is_some_and(|id| id.starts_with("UC")) {
                    if let Some(name) = value["text"].as_str().filter(|name| !name.is_empty()) {
                        if !names.iter().any(|n| n == name) { names.push(name.to_owned()); }
                    }
                }
                for item in map.values() { visit(item, names); }
            }
            Value::Array(items) => for item in items { visit(item, names); },
            _ => (),
        }
    }
    visit(value, &mut names);
    names.truncate(8);
    names
}

// Only visible clock-shaped labels are duration evidence. Plain years/counts,
// linked artist/album names and arbitrary nested metadata must not become time.
fn clock_seconds(value: &str) -> Option<u32> {
    let value = value.trim();
    if value.len() > 10 { return None; }
    let parts: Vec<&str> = value.split(':').collect();
    if !(2..=3).contains(&parts.len()) || parts.iter().any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit())) { return None; }
    if parts.last()?.len() != 2 || parts.last()?.parse::<u32>().ok()? >= 60 { return None; }
    let seconds = match parts.as_slice() {
        [minutes, seconds] if minutes.len() <= 4 => minutes.parse::<u32>().ok()?.checked_mul(60)?.checked_add(seconds.parse().ok()?)?,
        [hours, minutes, seconds] if hours.len() <= 2 && minutes.len() == 2 && minutes.parse::<u32>().ok()? < 60 =>
            hours.parse::<u32>().ok()?.checked_mul(3600)?.checked_add(minutes.parse::<u32>().ok()?.checked_mul(60)?)?.checked_add(seconds.parse().ok()?)?,
        _ => return None,
    };
    (1..=86400).contains(&seconds).then_some(seconds)
}

fn duration_labels(value: &Value, durations: &mut Vec<u32>) {
    let mut add = |label: &str| {
        for part in label.split(['·', '•']) {
            if let Some(seconds) = clock_seconds(part) {
                if !durations.contains(&seconds) { durations.push(seconds); }
            }
        }
    };
    if let Some(label) = value["simpleText"].as_str() { add(label); }
    if let Some(runs) = value["runs"].as_array() {
        for run in runs {
            if run.get("navigationEndpoint").is_none() {
                if let Some(label) = run["text"].as_str() { add(label); }
            }
        }
    }
}

fn item_duration(value: &Value) -> Option<u32> {
    let mut durations = Vec::new();
    if let Some(columns) = value["fixedColumns"].as_array() {
        for column in columns { duration_labels(&column["musicResponsiveListItemFixedColumnRenderer"]["text"], &mut durations); }
    }
    // A fixed column is the explicit duration field. Conflicting clocks are
    // unknown instead of choosing one arbitrarily or falling back to a label.
    if !durations.is_empty() { return (durations.len() == 1).then(|| durations[0]); }
    if let Some(columns) = value["flexColumns"].as_array() {
        for column in columns.iter().skip(1) { duration_labels(&column["musicResponsiveListItemFlexColumnRenderer"]["text"], &mut durations); }
    } else { duration_labels(&value["subtitle"], &mut durations); }
    (durations.len() == 1).then(|| durations[0])
}

fn item(value: &Value) -> Option<Item> {
    let columns = value["flexColumns"].as_array();
    let title_value = if let Some(columns) = columns { &columns.first()?["musicResponsiveListItemFlexColumnRenderer"]["text"] } else { &value["title"] };
    let title = text(title_value);
    if title.is_empty() { return None; }
    let nav = value.get("navigationEndpoint").or_else(|| find(title_value, "navigationEndpoint"));
    let page_type = nav.and_then(|n| find(n, "pageType")).and_then(Value::as_str).unwrap_or("");
    if matches!(page_type, "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE" | "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE" | "MUSIC_PAGE_TYPE_USER_CHANNEL") { return None; }
    let browse = nav.and_then(|n| n["browseEndpoint"]["browseId"].as_str());
    let video = value["playlistItemData"]["videoId"].as_str()
        .or_else(|| nav.and_then(|n| n["watchEndpoint"]["videoId"].as_str()))
        .or_else(|| find(&value["overlay"], "videoId").and_then(Value::as_str))
        .or_else(|| find(&value["thumbnailOverlay"], "videoId").and_then(Value::as_str));
    let (id, kind) = if let Some(id) = browse.filter(|id| valid_id(id) && ["UC", "MPRE", "VL"].iter().any(|prefix| id.starts_with(prefix))) {
        (id, if id.starts_with("UC") { "artist" } else if id.starts_with("MPRE") { "album" } else { "playlist" })
    } else { (video.filter(|id| video_id(id))?, "song") };
    let subtitle = columns.map(|cols| cols.iter().skip(1).map(|v| text(&v["musicResponsiveListItemFlexColumnRenderer"]["text"]))
        .filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ")).unwrap_or_else(|| text(&value["subtitle"]));
    let byline = if columns.is_some() { &value["flexColumns"] } else { &value["subtitle"] };
    Some(Item { id: id.into(), kind: kind.into(), title, subtitle, artists: artists(byline), image: image(value),
        duration: if kind == "song" { item_duration(value) } else { None } })
}

fn collect_items(value: &Value, items: &mut Vec<Item>) {
    if items.len() >= 100 { return; }
    match value {
        Value::Object(map) => for (key, v) in map {
            if matches!(key.as_str(), "musicCardShelfRenderer" | "musicTwoRowItemRenderer" | "musicResponsiveListItemRenderer" | "playlistPanelVideoRenderer") {
                let parsed = if key == "playlistPanelVideoRenderer" {
                    v["videoId"].as_str().filter(|id| video_id(id)).map(|id| Item { id: id.into(), kind: "song".into(),
                        title: text(&v["title"]), subtitle: text(&v["longBylineText"]), artists: artists(&v["longBylineText"]), image: image(v),
                        duration: clock_seconds(&text(&v["lengthText"])) })
                } else { item(v) };
                if let Some(item) = parsed { items.push(item); }
                if key == "musicCardShelfRenderer" { collect_items(&v["contents"], items); }
            } else if !matches!(key.as_str(), "menu" | "header" | "trackingParams") { collect_items(v, items); }
        },
        Value::Array(values) => for v in values { collect_items(v, items); },
        _ => (),
    }
}

fn unique(items: &mut Vec<Item>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert((item.kind.clone(), item.id.clone())));
}

fn shelves(value: &Value, sections: &mut Vec<Section>) {
    if sections.len() >= 10 { return; }
    match value {
        Value::Object(map) => for (key, v) in map {
            if key == "musicCarouselShelfRenderer" || key == "musicShelfRenderer" {
                let title = text(v.get("title").or_else(|| find(&v["header"], "title")).unwrap_or(&Value::Null));
                let mut items = Vec::new();
                collect_items(&v["contents"], &mut items);
                unique(&mut items);
                let more = find(&v["bottomEndpoint"], "browseEndpoint")
                    .or_else(|| find(&v["header"], "moreContentButton").and_then(|button| find(button, "browseEndpoint")))
                    .and_then(|target| {
                        let id=target["browseId"].as_str()?;
                        let params=target["params"].as_str().unwrap_or("");
                        (valid_id(id) && ["UC","VL","MPRE"].iter().any(|prefix|id.starts_with(prefix)) && params.len()<=8192 && !params.chars().any(char::is_control))
                            .then(|| BrowseTarget{id:id.into(),params:params.into()})
                    });
                if !items.is_empty() { sections.push(Section { title, items, more }); }
            } else if !matches!(key.as_str(), "menu" | "header") { shelves(v, sections); }
        },
        Value::Array(values) => for v in values { shelves(v, sections); },
        _ => (),
    }
}

fn parse(value: &Value, grouped: bool) -> Catalog {
    let mut sections = Vec::new();
    if grouped { shelves(value, &mut sections); }
    if sections.is_empty() {
        let mut items = Vec::new();
        collect_items(value, &mut items);
        unique(&mut items);
        if !items.is_empty() { sections.push(Section { title: String::new(), items, more: None }); }
    }
    let continuation = find(value, "nextContinuationData").and_then(|v| v["continuation"].as_str())
        .or_else(|| find(value, "continuationCommand").and_then(|v| v["token"].as_str()))
        .filter(|v| v.len() <= 8192).map(str::to_owned);
    Catalog { sections, continuation, artwork: None }
}

// Only primary page headers can provide collection artwork. Never pick a
// thumbnail recursively from recommendations, menus or a song's artist link.
fn browse_artwork(value: &Value, id: &str) -> Option<BrowseArtwork> {
    let candidates = [
        &value["header"],
        value.pointer("/contents/twoColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0").unwrap_or(&Value::Null),
        value.pointer("/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0").unwrap_or(&Value::Null),
    ];
    for candidate in candidates {
        for renderer in ["musicDetailHeaderRenderer", "musicResponsiveHeaderRenderer", "musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer"] {
            let header = &candidate[renderer];
            for field in ["thumbnail", "foregroundThumbnail"] {
                let cover = image(&header[field]);
                if !cover.is_empty() { return Some(BrowseArtwork { id: id.into(), image: cover }); }
            }
        }
    }
    None
}

fn mix_body(value: &str) -> Result<Value, String> {
    if value.len() > 256 { return Err("Invalid music request".into()); }
    let data: Value = serde_json::from_str(value).map_err(|_| "Invalid music request")?;
    let playlist = data["playlistId"].as_str().unwrap_or("");
    let video = data["videoId"].as_str().unwrap_or("");
    if !playlist.starts_with("RD") || playlist.len() < 13 || playlist.len() > 150 || !valid_id(playlist) || !video_id(video) { return Err("Invalid music request".into()); }
    Ok(json!({"videoId":video,"playlistId":playlist,"isAudioOnly":true}))
}

pub fn catalog_page(kind: &str, value: &str, language: &str, proxy: &str, filter: &str, continuation: &str) -> Result<Catalog, String> {
    catalog_page_with_params(kind,value,language,proxy,filter,continuation,"")
}
fn catalog_page_with_params(kind: &str, value: &str, language: &str, proxy: &str, filter: &str, continuation: &str, params: &str) -> Result<Catalog, String> {
    catalog_page_for_recovery(kind,value,language,proxy,filter,continuation,params,None)
}
pub fn catalog_page_for_recovery(kind:&str,value:&str,language:&str,proxy:&str,filter:&str,continuation:&str,params:&str,original_id:Option<&str>)->Result<Catalog,String>{
    let (endpoint, mut body) = match kind {
        "home" => ("browse", json!({"browseId":"FEmusic_home"})),
        "search" if !value.trim().is_empty() && value.chars().count() <= 120 => ("search", json!({"query":value.trim()})),
        "browse" if valid_id(value) && ["MPRE", "UC", "VL"].iter().any(|p| value.starts_with(p)) => ("browse", json!({"browseId":value})),
        "radio" if video_id(value) => ("next", json!({"videoId":value,"playlistId":format!("RDAMVM{value}"),"isAudioOnly":true})),
        "mix" => ("next", mix_body(value)?),
        _ => return Err("Invalid music request".into()),
    };
    if continuation.len() > 8192 || continuation.chars().any(char::is_control) { return Err("Invalid music request".into()); }
    if params.len()>8192 || params.chars().any(char::is_control) || (!params.is_empty() && kind!="browse") {return Err("Invalid music request".into());}
    if !params.is_empty(){body["params"]=json!(params);}
    if kind == "search" {
        let code = match filter { "all" => None, "songs" => Some("II"), "albums" => Some("IY"), "artists" => Some("Ig"), "videos" => Some("IQ"), _ => return Err("Invalid music request".into()) };
        if let Some(code) = code { body["params"] = json!(format!("EgWKAQ{code}AWoMEA4QChADEAQQCRAF")); }
    }
    let client = client(proxy)?;
    let version = client_version_for_recovery(&client,original_id)?;
    let language = if ["en", "ru", "es"].contains(&language) { language } else { "en" };
    body["context"] = json!({"client":{"clientName":"WEB_REMIX","clientVersion":version,"hl":language}});
    let mut address = url::Url::parse(&format!("{ORIGIN}/youtubei/v1/{endpoint}?prettyPrint=false")).map_err(|_| CATALOG_ERROR)?;
    if !continuation.is_empty() { address.query_pairs_mut().append_pair("continuation", continuation).append_pair("ctoken", continuation); }
    let request = client.post(address);
    let bytes = catalog_bytes(request.header("Origin", ORIGIN).json(&body),original_id)?;
    let response_value: Value = serde_json::from_slice(&bytes).map_err(|_| CATALOG_ERROR)?;
    if response_value.get("error").is_some() { return Err(CATALOG_ERROR.into()); }
    let mut catalog = parse(&response_value, kind == "home" || kind == "browse");
    if kind == "browse" && continuation.is_empty() { catalog.artwork = browse_artwork(&response_value, value); }
    Ok(catalog)
}

#[tauri::command]
pub async fn music_catalog(kind: String, value: String, language: String, filter: Option<String>, continuation: Option<String>, params: Option<String>, original_id: Option<String>, engine: tauri::State<'_, crate::Engine>) -> Result<Catalog, String> {
    let proxy = crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move || catalog_page_for_recovery(&kind, &value, &language, &proxy, filter.as_deref().unwrap_or("all"), continuation.as_deref().unwrap_or(""), params.as_deref().unwrap_or(""),original_id.as_deref())).await.map_err(|_| CATALOG_ERROR.to_owned())?
}

fn suggestion_texts(value:&Value)->Vec<String>{
    fn visit(value:&Value,out:&mut Vec<String>,depth:usize){
        if depth>16||out.len()>=8{return;}
        match value{
            Value::Object(map)=>{
                if let Some(row)=map.get("searchSuggestionRenderer"){
                    let suggestion=text(&row["suggestion"]);let suggestion=suggestion.trim();
                    if !suggestion.is_empty()&&suggestion.chars().count()<=120&&!suggestion.chars().any(char::is_control)&&!out.iter().any(|s|s.to_lowercase()==suggestion.to_lowercase()){out.push(suggestion.to_owned());}
                }else{for child in map.values(){visit(child,out,depth+1);}}
            },
            Value::Array(values)=>for child in values{visit(child,out,depth+1);},
            _=>{},
        }
    }
    let mut result=Vec::new();visit(value,&mut result,0);result
}

#[tauri::command]
pub async fn music_suggestions(value:String,language:String,engine:tauri::State<'_,crate::Engine>)->Result<Vec<String>,String>{
    if !(2..=120).contains(&value.trim().chars().count())||value.chars().any(char::is_control){return Ok(Vec::new());}
    let proxy=crate::stored_proxy(&engine.dir);
    tauri::async_runtime::spawn_blocking(move||{
        let client=client(&proxy)?;let version=client_version(&client)?;
        let lang=if ["en","ru","es"].contains(&language.as_str()){language.as_str()}else{"en"};
        let body=json!({"input":value.trim(),"context":{"client":{"clientName":"WEB_REMIX","clientVersion":version,"hl":lang}}});
        let response=client.post(format!("{ORIGIN}/youtubei/v1/music/get_search_suggestions?prettyPrint=false")).header("Origin",ORIGIN).timeout(Duration::from_secs(5)).json(&body).send().map_err(|_|CATALOG_ERROR)?.error_for_status().map_err(|_|CATALOG_ERROR)?;
        let mut bytes=Vec::new();response.take(256001).read_to_end(&mut bytes).map_err(|_|CATALOG_ERROR)?;
        if bytes.len()>256000{return Err(CATALOG_ERROR.into());}
        let data:Value=serde_json::from_slice(&bytes).map_err(|_|CATALOG_ERROR)?;
        Ok(suggestion_texts(&data))
    }).await.map_err(|_|CATALOG_ERROR.to_owned())?
}

#[derive(Serialize)]
pub struct Stream { url: String }

fn stream_error(stderr: &[u8]) -> &'static str {
    let error = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if error.contains("429") || error.contains("not a bot") {
        "YouTube is temporarily limiting playback. Try again later."
    } else if error.contains("sign in") || error.contains("private video") || error.contains("members-only") || error.contains("video unavailable") {
        "This track is unavailable for guest playback. Try another track."
    } else if error.contains("http error 403") || error.contains("http error 401") {
        "Playback restricted: YouTube denied access to the audio. Try another track."
    } else if error.contains("requested format is not available"){
        "Unsupported audio format"
    } else if ["http error 500","http error 502","http error 503","http error 504","connection reset","network error"].iter().any(|key|error.contains(key)){
        "Audio network request failed"
    } else {
        "Could not play this track. Try another track or try again later."
    }
}

struct ResolveFailure { message: String, retry: bool }

// The person's own YouTube sign-in (the one Deviload saves for downloads). Music uses it only when YouTube
// limits or refuses guest playback, so the account is not worn out by every song. It is read by the local
// yt-dlp alone: never sent to listening rooms, the phone remote, settings backups or diagnostics.
static ACCOUNT_SESSION: OnceLock<std::path::PathBuf> = OnceLock::new();
pub(crate) fn set_account_session(path: std::path::PathBuf) { let _ = ACCOUNT_SESSION.set(path); }
pub(crate) fn account_session() -> Option<std::path::PathBuf> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    ACCOUNT_SESSION.get().filter(|path| crate::cookies::has_saved_session_file(path, &["youtube.com", "youtu.be", "google.com"], crate::YOUTUBE_SIGNED_IN, now)).cloned()
}
// A limit on guest playback must not stop the account, and the account's own limit is kept apart.
fn account_limit() -> Arc<crate::music_audio::PlaybackLimit> {
    static LIMIT: OnceLock<Arc<crate::music_audio::PlaybackLimit>> = OnceLock::new();
    LIMIT.get_or_init(Arc::default).clone()
}
// Guest failures an account can get past: a rate limit, a refusal, or a video that asks to sign in.
fn account_helps(message: &str) -> bool {
    [stream_error(b"429"), stream_error(b"http error 403"), stream_error(b"sign in")].contains(&message)
}
// Guest first; the account only when the guest was limited or refused and a sign-in is saved.
fn resolve_any(id: &str, proxy: &str, timeout: Duration, limit: Arc<crate::music_audio::PlaybackLimit>, cancelled: &dyn Fn() -> bool) -> Result<crate::music_audio::Source, ResolveFailure> {
    resolve_with(id, proxy, timeout, limit, cancelled, account_session())
}
fn resolve_with(id: &str, proxy: &str, timeout: Duration, limit: Arc<crate::music_audio::PlaybackLimit>, cancelled: &dyn Fn() -> bool, account: Option<std::path::PathBuf>) -> Result<crate::music_audio::Source, ResolveFailure> {
    let started = Instant::now();
    let guest = if limit.active() { Err(ResolveFailure::from(stream_error(b"429"))) } else { resolve(id, proxy, timeout, limit, cancelled, None, account.is_none()) };
    match (guest, account) {
        (Err(failure), Some(path)) if account_helps(&failure.message) && !cancelled() =>
            resolve(id, proxy, timeout.saturating_sub(started.elapsed()), account_limit(), cancelled, Some(&path), true),
        (result, _) => result,
    }
}
impl From<&str> for ResolveFailure {
    fn from(message: &str) -> Self { Self { message: message.into(), retry: false } }
}
impl From<String> for ResolveFailure {
    fn from(message: String) -> Self { Self { message, retry: false } }
}

fn extraction_failure(stderr: &[u8]) -> ResolveFailure {
    let message = stream_error(stderr);
    let detail = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    // YouTube can return a session with no direct formats, then provide them
    // on a fresh resolution. Bound this to one retry; never retry account or
    // rate restrictions, or a video explicitly reported as unavailable.
    let retry = matches!(message,"Unsupported audio format"|"Audio network request failed") &&
        !detail.contains("http error 403") && !detail.contains("http error 401");
    ResolveFailure { message: message.into(), retry }
}

struct CachedStream { at: Instant, source: Arc<crate::music_audio::Source> }
#[derive(Default)]
struct Streams {
    entries: HashMap<(String, String), CachedStream>,
    limit: Arc<crate::music_audio::PlaybackLimit>,
    next_request: Option<Instant>,
}
static STREAMS: OnceLock<Mutex<Streams>> = OnceLock::new();
static RESOLUTION: Mutex<()> = Mutex::new(());

pub fn prepare_engine() {
    // Opening the music page only boots the small worker. The reserve tools
    // are launched on demand; version subprocesses do not warm audio itself.
    crate::music_engine::prepare();
}

#[tauri::command]
pub async fn music_prepare(engine: tauri::State<'_, crate::Engine>) -> Result<(), String> {
    if crate::stored_proxy(&engine.dir).is_empty() { let _ = tauri::async_runtime::spawn_blocking(prepare_engine).await; }
    Ok(())
}
#[derive(Default)]
struct Selection { generation: u64, invalid_before: u64, worker_cancelled_through: Option<u64>, key: Option<(String, String)>, automatic_origin: Option<String>, recovery_exhausted:bool }
impl Selection {
    fn select(&mut self, key: Option<(String, String)>) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.key = key;
        self.automatic_origin = None;
        self.recovery_exhausted=false;
        self.generation
    }
    fn select_play(&mut self,key:(String,String),origin:Option<&str>,refresh:bool,retry_alternate:bool)->u64{
        let generation=self.select(Some(key));
        self.automatic_origin=origin.map(str::to_owned);
        self.recovery_exhausted=retry_alternate;
        if refresh{self.invalid_before=generation;}
        generation
    }
    fn permits_recovery(&self,origin:&str,id:&str,retry_alternate:bool)->bool{
        if self.recovery_exhausted{return false;}
        let selected=self.key.as_ref().map(|key|key.0.as_str());
        if retry_alternate {
            id!=origin && selected==Some(id) && self.automatic_origin.as_deref()==Some(origin)
        }else{
            selected==Some(origin) && self.automatic_origin.as_deref().is_none_or(|owner|owner==origin)
        }
    }
    fn cancelled(&self, generation: u64, key: &(String, String)) -> bool {
        generation < self.invalid_before || (self.generation != generation && self.key.as_ref() != Some(key))
    }
}
static SELECTION: OnceLock<Mutex<Selection>> = OnceLock::new();
fn selection() -> &'static Mutex<Selection> { SELECTION.get_or_init(|| Mutex::new(Selection::default())) }
pub(crate) fn note_playback_limit(seconds:Option<u64>){
    STREAMS.get_or_init(Mutex::default).lock().unwrap().limit.note(seconds);
}
fn automatic_guard(original:&str,id:&str)->Result<(),String>{
    if STREAMS.get().is_some_and(|state|state.lock().unwrap().limit.active()){return Err(stream_error(b"429").into());}
    if let Some(reason)=crate::music_engine::recovery_error(original).or_else(||crate::music_engine::recovery_error(id)){return Err(reason);}
    if !crate::music_engine::recovery_monitor_ready(){return Err("Playback verification unavailable".into());}
    Ok(())
}
fn confirm_automatic_guard(origin:&str,id:&str)->Result<(),String>{
    let confirmed=crate::music_engine::confirm_recovery_monitor(origin) && (origin==id||crate::music_engine::confirm_recovery_monitor(id));
    automatic_guard(origin,id)?;
    if !confirmed{return Err("Playback verification unavailable".into());}
    Ok(())
}
fn recovery_generation(origin:&str,id:&str,retry_alternate:bool)->Result<u64,String>{
    if !video_id(id)||!video_id(origin){return Err("Invalid music request".into());}
    let generation={
        let state=selection().lock().unwrap();
        if !state.permits_recovery(origin,id,retry_alternate){return Err("Cancelled".into());}
        state.generation
    };
    confirm_automatic_guard(origin,id)?;
    if selection().lock().unwrap().generation!=generation{return Err("Cancelled".into());}
    Ok(generation)
}
fn allow_catalog_recovery(id:&str)->Result<(),String>{recovery_generation(id,id,false).map(|_|())}
#[tauri::command(async)]
pub async fn music_recovery_allowed(id:String,original_id:Option<String>)->bool{
    tauri::async_runtime::spawn_blocking(move||{
        let origin=original_id.as_deref().unwrap_or(&id);
        recovery_generation(origin,&id,id!=origin).is_ok()
    }).await.unwrap_or(false)
}

fn reserve(id: &str, proxy: &str, preload: bool, refresh: bool, original:Option<&str>, retry_alternate:bool) -> Result<u64,String> {
    if retry_alternate && (original.is_none()||preload||!refresh){return Err("Invalid music request".into());}
    let checked=original.map(|origin|recovery_generation(origin,id,retry_alternate)).transpose()?;
    let mut state = selection().lock().unwrap();
    if let Some(origin)=original {
        if Some(state.generation)!=checked{return Err("Cancelled".into());}
        automatic_guard(origin,id)?;
    }
    if preload { Ok(state.generation) } else {
        Ok(state.select_play((id.into(),proxy.into()),original,refresh,retry_alternate))
    }
}

#[tauri::command]
pub fn music_cancel_stream(preserve: Option<bool>) {
    let preserve=preserve.unwrap_or(false);
    let generation={let mut state=selection().lock().unwrap();let key=if preserve{state.key.clone()}else{None};
        let origin=if preserve{state.automatic_origin.take()}else{None};
        let generation=state.select(key);state.automatic_origin=origin;state.recovery_exhausted=true;if !preserve{state.invalid_before=generation;}generation};
    crate::music_engine::cancel(generation,preserve);
}

pub fn stream(id: &str, proxy: &str, refresh: bool) -> Result<Stream, String> {
    stream_request(id, proxy, refresh, false)
}

pub fn stream_request(id: &str, proxy: &str, refresh: bool, preload: bool) -> Result<Stream, String> {
    stream_request_with_origin(id,proxy,refresh,preload,false,None,false,false)
}
pub fn stream_request_with_origin(id:&str,proxy:&str,refresh:bool,preload:bool,automatic:bool,original_id:Option<&str>,recover_from_cache:bool,retry_alternate:bool)->Result<Stream,String>{
    if !video_id(id){return Err("Invalid music request".into());}
    let original=automatic.then_some(original_id.unwrap_or(id));
    stream_reserved(id,proxy,refresh,preload,reserve(id,proxy,preload,refresh,original,retry_alternate)?,original,recover_from_cache,retry_alternate)
}

fn completed_recovery_requested(id:&str, original:Option<&str>, refresh:bool, preload:bool, hint:bool,retry_alternate:bool)->bool{
    hint && refresh && !preload && (original==Some(id)||(retry_alternate&&original.is_some()))
}

fn stream_reserved(id: &str, proxy: &str, refresh: bool, preload: bool, generation: u64, original:Option<&str>, recover_from_cache:bool,retry_alternate:bool) -> Result<Stream, String> {
    let key = (id.to_owned(), proxy.to_owned());
    // The newest selection cancels stale foreground work as well as preloads.
    // Selecting the track already being prepared adopts that work instead.
    let guard=||if let Some(origin)=original{automatic_guard(origin,id)}else{Ok(())};
    guard()?;
    let superseded=||{let state=selection().lock().unwrap();state.cancelled(generation,&key)||(original.is_some()&&state.generation!=generation)};
    let cancelled = || superseded() || guard().is_err();
    // A protected continuation must not become a yt-dlp retry through frontend recovery.
    if refresh {if let Some(error)=crate::music_engine::recovery_error(id){return Err(error);}}
    // A complete verified reserve recording already in memory can replay without
    // reopening a remote prefix. A partial/expired recording cannot take this path.
    let try_completed=completed_recovery_requested(id,original,refresh,preload,recover_from_cache,retry_alternate);
    if (!refresh||try_completed) && !cancelled() && crate::music_engine::recovery_error(id).is_none() {
        let buffered=STREAMS.get().and_then(|streams|{
            let streams=streams.lock().unwrap();
            let entry=streams.entries.get(&key)?;
            (!streams.limit.active() && entry.source.reusable(entry.at.elapsed()) && entry.source.fully_buffered())
                .then(||entry.source.clone())
        });
        if let Some(source)=buffered {
            if cancelled(){return Err("Cancelled".into());}
            if !preload {crate::music_engine::cancel(generation,false);}
            let url=crate::music_audio::register(source)?;
            if try_completed{
                guard()?;
                if cancelled(){return Err("Cancelled".into());}
                diagnostics::record(Stage::CachedAudio,Code::Success,None);
            }
            return Ok(Stream{url});
        }
    }
    if try_completed {
        let completed=crate::music_engine::completed_playback(id,generation,&cancelled);
        guard()?;
        if cancelled(){return Err("Cancelled".into());}
        match completed {
            Ok(Some(url))=>return Ok(Stream{url}),
            Err(error) if crate::music_engine::restricted_error(&error)||error=="Cancelled"=>return Err(error),
            _=>{}, // An absent/unreadable local copy falls through to normal recovery.
        }
    }
    // Without a completed local source, recovery uses the independent verified-range relay.
    // Reopening the same fast prefix/SABR route can fail at the same position
    // repeatedly even though the reserve can serve the full recording.
    if proxy.is_empty() && !refresh && !cancelled() {
        match crate::music_engine::play(id, refresh, preload, original, generation, &cancelled) {
            Ok(url) if !cancelled() => return Ok(Stream { url }),
            Ok(_) => return Err("Cancelled".into()),
            Err(error) if cancelled() || preload || crate::music_engine::restricted_error(&error) || error.contains("Cancelled") => return Err(error),
            Err(_) => {}, // Bounded legacy path if the bundled worker is unavailable.
        }
    }
    // The worker may have reported protection before a generic timeout/abort reply.
    guard()?;
    if let Some(error)=crate::music_engine::recovery_error(id){return Err(error);}
    // Hand off to the independent relay instead of leaving the old producer
    // downloading the same track during refresh or a worker timeout.
    if !preload && !cancelled() {
        {let mut state=selection().lock().unwrap();state.worker_cancelled_through=Some(state.worker_cancelled_through.unwrap_or(0).max(generation));}
        crate::music_engine::cancel(generation,false);
    }
    use crate::music_engine::diagnostics::{self,Stage,Code};
    diagnostics::record(Stage::ReserveStream,Code::Requested,None);
    let route_started=Instant::now();
    let result=(|| {
    let streams = STREAMS.get_or_init(|| Mutex::new(Streams::default()));
    // Cache hits must not wait behind a speculative network request. Only new
    // extraction is serialized; the cache mutex is never held across I/O.
    let cached = || {
        let mut cache=streams.lock().unwrap();
        cache.entries.retain(|_, item| item.source.reusable(item.at.elapsed()));
        if refresh { None } else { cache.entries.get(&key).map(|item|item.source.clone()) }
    };
    if cancelled() { return Err("Could not open this track".into()); }
    if let Some(source)=cached(){return Ok(Stream{url:crate::music_audio::register(source)?});}
    let deadline = Instant::now() + Duration::from_secs(35);
    let _resolution=loop {
        if let Ok(lock)=RESOLUTION.try_lock(){break lock;}
        if preload||cancelled()||Instant::now()>=deadline{return Err("Could not open this track".into());}
        std::thread::sleep(Duration::from_millis(20));
    };
    if cancelled() { return Err("Could not open this track".into()); }
    if let Some(source)=cached(){return Ok(Stream{url:crate::music_audio::register(source)?});}
    let limit=streams.lock().unwrap().limit.clone();
    if limit.active() && account_session().is_none() {
        return Err(stream_error(b"429").into());
    }
    for attempt in 0..2 {
        let next_request=streams.lock().unwrap().next_request;
        if let Some(next) = next_request {
            // Background work remains conservative. A deliberate click waits
            // at most the one-second foreground spacing, not five seconds.
            let next=if preload{next}else{next-Duration::from_secs(4)};
            while Instant::now() < next {
                if cancelled() { return Err("Could not open this track".into()); }
                std::thread::sleep(next.saturating_duration_since(Instant::now()).min(Duration::from_millis(50)));
            }
        }
        if cancelled() { return Err("Could not open this track".into()); }
        if limit.active() && account_session().is_none() { return Err(stream_error(b"429").into()); }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining < Duration::from_secs(5) { break; }
        streams.lock().unwrap().next_request = Some(Instant::now() + Duration::from_secs(5));
        #[cfg(debug_assertions)] let timing=Instant::now();
        let source = match resolve_any(id, proxy, remaining.min(Duration::from_secs(25)), limit.clone(), &cancelled) {
            Ok(source) => Arc::new(source),
            Err(error) => {
                if error.message == stream_error(b"429") { limit.note(None); }
                if error.retry && attempt == 0 && !cancelled() { continue; }
                return Err(error.message);
            }
        };
        #[cfg(debug_assertions)] eprintln!("Music source resolved in {} ms (attempt {})",timing.elapsed().as_millis(),attempt+1);
        // Report a verified denial from this source; acquiring another URL
        // does not establish permission to play the same recording.
        if cancelled() { return Err("Could not open this track".into()); }
        #[cfg(debug_assertions)] let verified=Instant::now();
        verify_reserve_source(&source,deadline.min(Instant::now()+Duration::from_secs(12)),&cancelled)?;
        if cancelled() { return Err("Could not open this track".into()); }
        #[cfg(debug_assertions)] eprintln!("Music first audio bytes verified in {} ms",verified.elapsed().as_millis());
        let address = crate::music_audio::register(source.clone())?;
        let mut cache=streams.lock().unwrap();
        if cache.entries.len() >= 12 {
            if let Some(oldest) = cache.entries.iter().max_by_key(|(_,item)| item.at.elapsed()).map(|(key,_)| key.clone()) { cache.entries.remove(&oldest); }
        }
        cache.entries.insert(key.clone(), CachedStream { at: Instant::now(), source });
        return Ok(Stream { url: address });
    }
    Err("Could not open this track".into())
    })();
    let result=if superseded(){
        Err("Cancelled".into())
    }else{
        guard().and(result)
    };
    diagnostics::record(Stage::ReserveStream,result.as_ref().map(|_|Code::Ready).unwrap_or_else(|error:&String|diagnostics::classify(error)),Some(route_started.elapsed().as_millis() as u64));
    result
}

pub(super) fn verify_reserve_source(source:&crate::music_audio::Source,deadline:Instant,cancelled:&dyn Fn()->bool)->Result<(),String>{
    use crate::music_audio::SourceError;
    match source.verify_cancellable(deadline,cancelled) {
        // The relay records denial before returning. Its own guard must not turn it into a user cancellation.
        Err(error @ (SourceError::Denied|SourceError::Limited))=>Err(error.to_string()),
        Err(_) if cancelled()=>Err("Cancelled".into()),
        result=>result.map_err(|error|error.to_string()),
    }
}

fn resolve(id: &str, proxy: &str, timeout: Duration, limit: Arc<crate::music_audio::PlaybackLimit>, cancelled: &dyn Fn() -> bool, account: Option<&std::path::Path>, note_denial: bool) -> Result<crate::music_audio::Source, ResolveFailure> {
    let exe = crate::binary("yt-dlp")?;
    let deno = crate::binary("deno")?;
    let mut command = crate::ytdlp_command_with(&exe, proxy);
    if let Some(path) = account { command.arg("--cookies").arg(path); }
    command
        .args(["--js-runtimes", &format!("deno:{}", deno.display())])
        // visionos serves full audio without a token, label uploads included; web_embedded covers what it lacks.
        // visionos needs the watch page's visitor data, so the page is not skipped. Signed in, yt-dlp picks
        // the clients that accept an account itself.
        .args(["--extractor-args", if account.is_some() { "youtube:skip=hls,dash" } else { "youtube:player_client=visionos,web_embedded;skip=hls,dash" }])
        // The relay verifies actual audio bytes. yt-dlp's separate format probe
        // duplicates that request and can discard a briefly unavailable URL.
        .args(["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--skip-download", "--dump-single-json", "--no-warnings", "--no-colors",
            "--socket-timeout", "10", "--retries", "0", "--extractor-retries", "0", "-f", "bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]"]);
    let output = crate::engine_update::json_output_cancellable(command.arg("--")
        .arg(format!("https://www.youtube.com/watch?v={id}")), timeout, cancelled)?;
    if !output.status.success() {
        let error=extraction_failure(&output.stderr);
        if error.message==stream_error(b"429"){limit.note(None);}
        if note_denial&&(error.message==stream_error(b"http error 403")||error.message==stream_error(b"private video")){crate::music_engine::note_reserve_denial(id);}
        return Err(error);
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|_| "Could not open this track")?;
    let raw = value["url"].as_str().ok_or("Could not open this track")?;
    let url = url::Url::parse(raw).map_err(|_| "Could not open this track")?;
    let size = value["filesize"].as_u64().or_else(|| url.query_pairs().find(|(key,_)| key == "clen").and_then(|(_,v)| v.parse().ok())).ok_or("Could not open this track")?;
    let mime = match value["ext"].as_str() { Some("m4a") => "audio/mp4", Some("webm") => "audio/webm", _ => return Err("Could not open this track".into()) };
    let agent = value["http_headers"]["User-Agent"].as_str().unwrap_or(AGENT);
    crate::music_audio::Source::new(url, size, mime, agent, proxy, limit)
        .map(|source|source.with_music_id(id).with_availability(value["available_at"].as_u64())).map_err(Into::into)
}

fn reserve_slot(deadline:Instant,cancelled:&dyn Fn()->bool)->Result<std::sync::MutexGuard<'static,()>,String>{
    loop{
        if cancelled(){return Err("Cancelled".into());}
        // Waiting too long for another lookup is a passing condition, not a cancellation: the engine retries it.
        if Instant::now()>=deadline{return Err("Reserve audio is busy".into());}
        if let Ok(lock)=RESOLUTION.try_lock(){
            if cancelled(){return Err("Cancelled".into());}
            return Ok(lock);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
pub(crate) fn reserve_audio(id: &str, generation: Option<u64>) -> Result<String, String> {
    if !video_id(id) { return Err("Invalid music request".into()); }
    if let Some(error)=crate::music_engine::recovery_error(id){return Err(error);}
    let limit=STREAMS.get_or_init(||Mutex::new(Streams::default())).lock().unwrap().limit.clone();
    if limit.active()&&account_session().is_none(){return Err(stream_error(b"429").into());}
    // Pausing may finish the current buffer, but choosing another song cancels
    // an obsolete reserve extraction as well as the main worker request.
    let generation=generation.unwrap_or_else(||selection().lock().unwrap().generation);
    let key=(id.to_owned(),String::new());
    let cancelled=||{
        let state=selection().lock().unwrap();
        state.key.as_ref()!=Some(&key) || state.cancelled(generation,&key) || state.worker_cancelled_through.is_some_and(|last|generation<=last)
            || crate::music_engine::recovery_error(id).is_some() || state.automatic_origin.as_deref().is_some_and(|origin|automatic_guard(origin,id).is_err())
    };
    if cancelled(){return Err("Cancelled".into());}
    let deadline=Instant::now()+Duration::from_secs(25);
    let _resolution=reserve_slot(deadline,&cancelled)?;
    let attempt=||resolve_any(id,"",deadline.saturating_duration_since(Instant::now()),limit.clone(),&cancelled);
    // YouTube sometimes answers once without direct formats; one more look usually finds them.
    let source=match attempt(){
        Err(failure) if failure.retry && !cancelled() && deadline.saturating_duration_since(Instant::now())>Duration::from_secs(8)=>attempt(),
        result=>result,
    }.map_err(|e|e.message)?;
    if cancelled(){return Err("Cancelled".into());}
    crate::music_audio::register(Arc::new(source))
}

#[tauri::command]
pub async fn music_stream(id: String, refresh: Option<bool>, preload: Option<bool>, automatic:Option<bool>, original_id:Option<String>, recover_from_cache:Option<bool>, retry_alternate:Option<bool>, engine: tauri::State<'_, crate::Engine>) -> Result<Stream, String> {
    if !video_id(&id) { return Err("Invalid music request".into()); }
    let proxy = crate::stored_proxy(&engine.dir);
    let preload = preload.unwrap_or(false);
    // Reserve priority before dispatching to the worker pool, whose start order
    // is not necessarily the order of commands from the player.
    let original=automatic.unwrap_or(false).then(||original_id.unwrap_or_else(||id.clone()));
    let retry_alternate=retry_alternate.unwrap_or(false);
    let generation = reserve(&id, &proxy, preload, refresh.unwrap_or(false),original.as_deref(),retry_alternate)?;
    tauri::async_runtime::spawn_blocking(move || stream_reserved(&id, &proxy, refresh.unwrap_or(false), preload, generation,original.as_deref(),recover_from_cache.unwrap_or(false),retry_alternate)).await.map_err(|_| "Could not open this track".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn artwork_comes_only_from_primary_header_and_valid_thumbnail() {
        let image_url = "https://lh3.googleusercontent.com/album=w600-h600";
        let header = json!({"musicResponsiveHeaderRenderer":{"thumbnail":{"thumbnails":[{"url":image_url},{"url":"https://evil.test/image"}]}}});
        let response = json!({"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[header]}}}}]}}});
        let art = browse_artwork(&response,"MPREalbum").unwrap();
        assert_eq!(art.id,"MPREalbum");assert_eq!(art.image,image_url);
        assert!(browse_artwork(&json!({"recommendations":{"header":{"musicResponsiveHeaderRenderer":{"thumbnail":{"thumbnails":[{"url":image_url}]}}}}}),"MPREalbum").is_none());
        assert!(browse_artwork(&json!({"header":{"musicDetailHeaderRenderer":{"menu":{"thumbnails":[{"url":image_url}]}}}}),"MPREalbum").is_none());
    }

    fn catalog(kind: &str, value: &str, language: &str, proxy: &str) -> Result<Catalog, String> {
        catalog_page(kind, value, language, proxy, "all", "")
    }
    #[test]
    fn music_catalog_continuations_are_bounded_and_filters_are_validated() {
        let parsed=parse(&json!({"continuationContents":{"musicShelfContinuation":{"contents":[],"continuations":[{"nextContinuationData":{"continuation":"next-page"}}]}}}),false);
        assert_eq!(parsed.continuation.as_deref(),Some("next-page"));
        assert!(catalog_page("search","artist","en","","uploads","").is_err());
        assert!(catalog_page("search","artist","en","","songs",&"x".repeat(8193)).is_err());
    }

    #[test]
    fn latest_selection_cancels_old_work_but_adopts_the_same_prepared_source() {
        let mut state = Selection::default();
        let a = ("abcdefghijk".into(), String::new());
        let b = ("lmnopqrstuv".into(), String::new());
        let prepared = state.generation;
        state.select(Some(a.clone()));
        assert!(!state.cancelled(prepared, &a));
        assert!(state.cancelled(prepared, &b));
        let playing = state.generation;
        state.select(Some(b.clone()));
        assert!(state.cancelled(playing, &a));
        state.select(None);
        assert!(state.cancelled(prepared, &a));
        assert!(state.cancelled(playing, &b));
    }
    #[test]
    fn alternate_retry_belongs_to_one_selected_pair_and_excludes_chaining(){
        let (a,b,c)=("aaaaaaaaaaa","bbbbbbbbbbb","ccccccccccc");
        let mut s=Selection::default();
        s.select_play((a.into(),String::new()),None,false,false);
        assert!(s.permits_recovery(a,a,false));
        assert!(s.permits_recovery(a,b,false));
        assert!(!s.permits_recovery(a,b,true));
        let handoff=s.select_play((b.into(),String::new()),Some(a),false,false);
        assert!(s.permits_recovery(a,b,true));
        assert!(!s.permits_recovery(a,b,false));
        assert!(!s.permits_recovery(a,c,false));
        assert!(!s.permits_recovery(a,c,true));
        assert!(!s.permits_recovery(b,c,false));
        s.select_play((b.into(),String::new()),Some(a),true,true);
        assert!(s.cancelled(handoff,&(b.into(),String::new())));
        assert!(!s.permits_recovery(a,b,true));
        s.select(None);assert!(!s.permits_recovery(a,b,true));
        s.select_play((b.into(),String::new()),None,false,false);
        assert!(!s.permits_recovery(a,b,true));
    }
    #[test]
    fn alternate_retry_preserves_each_tracks_terminal_guard(){
        let a="origGuard01";let b="destGuard01";
        crate::music_engine::note_reserve_denial(b);
        assert_eq!(automatic_guard(a,b).unwrap_err(),crate::music_engine::recovery_error(b).unwrap());
        crate::music_engine::note_reserve_denial(a);
        assert_eq!(automatic_guard(a,"otherTrack1").unwrap_err(),crate::music_engine::recovery_error(a).unwrap());
    }
    #[test]
    fn completed_recovery_is_scoped_to_the_same_foreground_item_and_explicit_hint() {
        let id="abcdefghijk";
        assert!(completed_recovery_requested(id,Some(id),true,false,true,false));
        assert!(completed_recovery_requested(id,Some("lmnopqrstuv"),true,false,true,true)); // admitted retry of B
        assert!(!completed_recovery_requested(id,None,true,false,true,false)); // manual
        assert!(!completed_recovery_requested(id,Some("lmnopqrstuv"),true,false,true,false)); // alternate
        assert!(!completed_recovery_requested(id,Some(id),true,true,true,false)); // preload
        assert!(!completed_recovery_requested(id,Some(id),false,false,true,false));
        assert!(!completed_recovery_requested(id,Some(id),true,false,false,false)); // unsupported/decode
    }
    #[test]
    fn late_denial_cancels_reserve_before_extraction_starts() {
        let id="raceTest001";
        assert!(crate::music_engine::recovery_error(id).is_none());
        let checks=std::cell::Cell::new(0);
        let result=reserve_slot(Instant::now()+Duration::from_secs(1),&||{
            checks.set(checks.get()+1);
            if checks.get()==2{crate::music_engine::note_reserve_denial(id);}
            crate::music_engine::recovery_error(id).is_some()
        });
        assert_eq!(result.err().as_deref(),Some("Cancelled"));
        assert!(checks.get()>=2);
        // A lookup that only waited too long is not reported as a cancellation, so the engine may retry it.
        let _held=RESOLUTION.lock().unwrap_or_else(|e|e.into_inner());
        assert_eq!(reserve_slot(Instant::now()+Duration::from_millis(50),&||false).err().as_deref(),Some("Reserve audio is busy"));
    }
    #[test]
    fn recovery_invalidates_the_old_producer_even_for_the_same_track() {
        let mut state=Selection::default();let key=("abcdefghijk".into(),String::new());
        let old=state.select(Some(key.clone()));
        let adopted=state.select(Some(key.clone()));
        assert!(!state.cancelled(old,&key));
        let refresh=state.select(Some(key.clone()));state.invalid_before=refresh;
        assert!(state.cancelled(old,&key));assert!(state.cancelled(adopted,&key));
        assert!(!state.cancelled(refresh,&key));
        let paused=state.select(Some(key.clone()));assert!(!state.cancelled(refresh,&key));
        let stopped=state.select(None);state.invalid_before=stopped;
        assert!(state.cancelled(paused,&key));
    }

    #[test]
    fn catalog_keeps_album_navigation_and_deduplicates_tracks() {
        let album = json!({"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Album"}]},
            "navigationEndpoint":{"browseEndpoint":{"browseId":"MPREtest"}},
            "thumbnailOverlay":{"watchEndpoint":{"videoId":"abcdefghijk"}}}});
        let song = json!({"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"abcdefghijk"},
            "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Song"}]}}}],
            "thumbnail":{"thumbnails":[{"url":"https://untrusted.example/a.jpg"}]}}});
        let parsed = parse(&json!({"contents":[album,song.clone(),song]}), false);
        assert_eq!(parsed.sections[0].items.len(), 2);
        assert_eq!(parsed.sections[0].items[0].kind, "album");
        assert_eq!(parsed.sections[0].items[1].image, "");
    }

    #[test]
    fn catalog_duration_clocks_are_strict_and_bounded() {
        for (label, seconds) in [("0:01", 1), (" 3:45 ", 225), ("62:03", 3723), ("1:02:03", 3723), ("24:00:00", 86400), ("1440:00", 86400)] {
            assert_eq!(clock_seconds(label), Some(seconds), "{label}");
        }
        for label in ["", "0:00", "00:00:00", "3:5", "1:60", "1:2:03", "1:60:00", "24:00:01", "1440:01", "99999:00", "2024", "1,234", "3.45", "3:45 views", "-3:45", "NaN", "Infinity", "３:４５"] {
            assert_eq!(clock_seconds(label), None, "{label}");
        }
    }

    #[test]
    fn catalog_responsive_items_read_explicit_clock_columns() {
        let fixed = json!({"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"abcdefghijk"},
            "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Song"}]}}},
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Artist","navigationEndpoint":{"browseEndpoint":{"browseId":"UCartist"}}}]}}}],
            "fixedColumns":[{"musicResponsiveListItemFixedColumnRenderer":{"text":{"simpleText":"3:45"}}}]}});
        let parsed = parse(&fixed, false);
        let track = &parsed.sections[0].items[0];
        assert_eq!(track.duration, Some(225));
        assert_eq!(track.artists, ["Artist"]);
        assert_eq!(track.subtitle, "Artist");
        assert_eq!(serde_json::to_value(track).unwrap()["duration"], 225);

        let flexible = json!({"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"lmnopqrstuv"},
            "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Other song"}]}}},
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Artist","navigationEndpoint":{"browseEndpoint":{"browseId":"UCartist"}}},{"text":" • "},{"text":"1:02:03"}]}}}]}});
        assert_eq!(parse(&flexible, false).sections[0].items[0].duration, Some(3723));
    }

    #[test]
    fn catalog_two_row_and_radio_duration_preserve_legacy_shape() {
        let song = json!({"musicTwoRowItemRenderer":{"title":{"simpleText":"Song"},"subtitle":{"simpleText":"Artist • 2024 • 2:09"},
            "navigationEndpoint":{"watchEndpoint":{"videoId":"abcdefghijk"}}}});
        assert_eq!(parse(&song, false).sections[0].items[0].duration, Some(129));
        let panel = json!({"playlistPanelVideoRenderer":{"videoId":"lmnopqrstuv","title":{"simpleText":"Radio song"},"longBylineText":{"simpleText":"Artist"},"lengthText":{"runs":[{"text":"6:20"}]}}});
        assert_eq!(parse(&panel, false).sections[0].items[0].duration, Some(380));

        let legacy = json!({"musicTwoRowItemRenderer":{"title":{"simpleText":"Song"},"subtitle":{"simpleText":"Artist • 2024 • 1.2M views"},
            "navigationEndpoint":{"watchEndpoint":{"videoId":"abcdefghijk"}}}});
        let serialized = serde_json::to_value(&parse(&legacy, false).sections[0].items[0]).unwrap();
        assert_eq!(serialized, json!({"id":"abcdefghijk","kind":"song","title":"Song","subtitle":"Artist • 2024 • 1.2M views","artists":[],"image":""}));
        let album = json!({"musicTwoRowItemRenderer":{"title":{"simpleText":"Album"},"subtitle":{"simpleText":"2024 • 42:00"},
            "navigationEndpoint":{"browseEndpoint":{"browseId":"MPREalbum"}}}});
        assert!(serde_json::to_value(&parse(&album, false).sections[0].items[0]).unwrap().get("duration").is_none());
    }

    #[test]
    fn catalog_durations_do_not_guess_from_metadata_or_conflicting_clocks() {
        let base = json!({"playlistItemData":{"videoId":"abcdefghijk"},"duration":900,"lengthSeconds":"800",
            "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"simpleText":"3:45"}}},
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"4:20","navigationEndpoint":{"browseEndpoint":{"browseId":"UCartist"}}},{"text":" • 2024 • 1,234 views"}]}}}]});
        assert_eq!(item(&base).unwrap().duration, None);
        let mut conflicting = base.clone();
        conflicting["fixedColumns"] = json!([
            {"musicResponsiveListItemFixedColumnRenderer":{"text":{"simpleText":"3:45"}}},
            {"musicResponsiveListItemFixedColumnRenderer":{"text":{"simpleText":"4:20"}}}]);
        assert_eq!(item(&conflicting).unwrap().duration, None);
        conflicting["fixedColumns"][1]["musicResponsiveListItemFixedColumnRenderer"]["text"]["simpleText"] = json!("3:45");
        assert_eq!(item(&conflicting).unwrap().duration, Some(225));
        let mut flexible = base;
        flexible["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]["text"] = json!({"simpleText":"Artist • 3:45 • 4:20"});
        assert_eq!(item(&flexible).unwrap().duration, None);
    }

    #[test]
    fn invalid_music_requests_do_not_reach_the_network() {
        assert!(catalog("browse", "https://localhost", "en", "").is_err());
        assert!(catalog("search", "", "en", "").is_err());
        assert!(stream("--exec=bad", "", false).is_err());
    }

    #[test]
    fn playback_errors_distinguish_rate_limits_from_unavailable_tracks() {
        assert!(stream_error(b"HTTP Error 429").contains("temporarily limiting"));
        assert!(stream_error(b"Sign in to confirm you're not a bot").contains("temporarily limiting"));
        assert!(stream_error(b"Private video").contains("guest playback"));
        assert!(stream_error(b"Video unavailable").contains("guest playback"));
        assert!(stream_error(b"Network error").contains("network"));
    }

    #[test]
    fn extraction_retries_transient_formats_without_retrying_access_restrictions() {
        for error in ["Requested format is not available", "Unable to download API page: HTTP Error 503"] {
            assert!(extraction_failure(error.as_bytes()).retry);
        }
        for error in ["HTTP Error 429", "HTTP Error 403: Requested format is not available", "HTTP Error 401", "Sign in to confirm you're not a bot", "Private video", "Video unavailable", "Sign in to confirm your age", "members-only"] {
            assert!(!extraction_failure(error.as_bytes()).retry);
        }
    }

    #[test]
    fn search_keeps_the_featured_artist_and_skips_non_music_pages() {
        let artist = json!({"musicCardShelfRenderer":{"title":{"runs":[{"text":"Artist", "navigationEndpoint":{"browseEndpoint":{"browseId":"UCartist"}}}]}}});
        let podcast = json!({"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Podcast"}]}, "navigationEndpoint":{"browseEndpoint":{"browseId":"MPEDtest", "pageType":"MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE"}},"overlay":{"videoId":"abcdefghijk"}}});
        let parsed = parse(&json!([artist,podcast]), false);
        assert_eq!(parsed.sections[0].items.len(), 1);
        assert_eq!(parsed.sections[0].items[0].kind, "artist");
    }

    #[test]
    fn artist_shelves_keep_the_full_catalog_endpoint() {
        let song=json!({"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"abcdefghijk"},"flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"A song"}]}}}]}});
        let value=json!({"musicShelfRenderer":{"title":{"runs":[{"text":"Top songs"}]},"contents":[song],"bottomEndpoint":{"browseEndpoint":{"browseId":"VLallSongs","params":"wAEB"}}}});
        let page=parse(&value,true);let target=page.sections[0].more.as_ref().unwrap();assert_eq!(target.id,"VLallSongs");assert_eq!(target.params,"wAEB");
        let mut bad=value.clone();bad["musicShelfRenderer"]["bottomEndpoint"]["browseEndpoint"]["browseId"]=json!("https://localhost");assert!(parse(&bad,true).sections[0].more.is_none());
        assert!(catalog_page_with_params("browse","VLallSongs","en","","all","",&"x".repeat(8193)).is_err());
    }
    #[test]
    fn live_artist_catalog_when_explicitly_requested() {
        if std::env::var_os("DEVILOAD_ARTIST_NETWORK_TEST").is_none(){return;}
        let search=catalog("search","Massive Attack","en","").unwrap();
        let artist=search.sections.iter().flat_map(|s|&s.items).find(|i|i.kind=="artist"&&i.title=="Massive Attack").unwrap();
        let artist=catalog("browse",&artist.id,"en","").unwrap();
        let shelf=artist.sections.iter().find(|s|s.items.iter().all(|i|i.kind=="song")&&s.more.is_some()).expect("artist songs endpoint");let target=shelf.more.as_ref().unwrap();
        let songs=catalog_page_with_params("browse",&target.id,"en","","all","",&target.params).unwrap();
        assert!(songs.sections.iter().map(|s|s.items.len()).sum::<usize>()>shelf.items.len());
        if let Some(next)=songs.continuation{let next=catalog_page_with_params("browse",&target.id,"en","","all",&next,&target.params).unwrap();assert!(!next.sections.is_empty());}
    }
    #[test]
    #[ignore = "live guest YouTube Music check"]
    fn live_guest_catalog() {
        if std::env::var_os("DEVILOAD_LIVE_MUSIC_TEST").is_none() { return; }
        let home = catalog("home", "", "en", "").unwrap();
        assert!(!home.sections.is_empty());
        let search = catalog("search", "Massive Attack", "en", "").unwrap();
        assert!(search.sections.iter().flat_map(|s| &s.items).any(|i| i.kind == "song"));
        assert!(search.sections.iter().flat_map(|s| &s.items).any(|i| i.title == "Massive Attack" && i.kind == "artist"));
        let album = home.sections.iter().flat_map(|s| &s.items).find(|i| i.kind == "album").unwrap();
        let album = catalog("browse", &album.id, "en", "").unwrap();
        assert!(album.sections.iter().flat_map(|s| &s.items).any(|i| i.kind == "song"));
        if let Ok(folder) = std::env::var("DEVILOAD_MUSIC_PROBE_DIR") {
            std::fs::create_dir_all(&folder).unwrap();
            for (name, data) in [("home", &home), ("search", &search), ("album", &album)] {
                std::fs::write(std::path::Path::new(&folder).join(format!("{name}.json")), serde_json::to_vec(data).unwrap()).unwrap();
            }
        }
    }

    #[test]
    fn mixes_validate_the_playlist_and_seed_before_network() {
        let value = json!({"playlistId":"RDajBoh2XK6kU","videoId":"kpafW1g-Arg"}).to_string();
        assert_eq!(mix_body(&value).unwrap()["playlistId"], "RDajBoh2XK6kU");
        for value in ["{}", "https://localhost", "{\"playlistId\":\"LL\",\"videoId\":\"kpafW1g-Arg\"}"] { assert!(mix_body(value).is_err()); }
    }

    #[test]
    #[ignore = "live YouTube Mix import"]
    fn live_youtube_mix_import() {
        if std::env::var_os("DEVILOAD_LIVE_IMPORT_TEST").is_none() { return; }
        let value = json!({"playlistId":"RDajBoh2XK6kU","videoId":"kpafW1g-Arg"}).to_string();
        let page = catalog_page("mix", &value, "en", "", "all", "").unwrap();
        assert!(!page.sections.iter().flat_map(|s| &s.items).collect::<Vec<_>>().is_empty());
    }

    #[test]
    #[ignore = "live anonymous playback check"]
    fn live_guest_playback() {
        if std::env::var_os("DEVILOAD_LIVE_MUSIC_TEST").is_none() { return; }
        let search = catalog("search", "Massive Attack Teardrop", "en", "").unwrap();
        let tracks: Vec<_> = search.sections.iter().flat_map(|s| &s.items).filter(|i| i.kind == "song").take(2).collect();
        assert_eq!(tracks.len(),2);
        let client = Client::builder().no_proxy().build().unwrap();
        for track in tracks {
            let stream = stream(&track.id, "", false).unwrap();
            for range in ["bytes=0-1023","bytes=-1024"] {
                let response = client.get(&stream.url).header("Range", range).send().unwrap();
                assert_eq!(response.status(),206,"audio server rejected the stream");
                assert_eq!(response.bytes().unwrap().len(),1024);
            }
        }
    }
}

#[cfg(test)] mod suggestion_tests{
    use super::*;
    #[test] fn catalog_retries_a_truncated_body_once(){
        // A client needs a TLS provider even for loopback; never rely on another test installing it first.
        let _=rustls::crypto::ring::default_provider().install_default();
        use std::io::Write;
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move||{
            for payload in ["a","abc"]{
                let(mut socket,_)=listener.accept().unwrap();
                let mut request=[0;2048];socket.read(&mut request).unwrap();
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\n{payload}").unwrap();
            }
        });
        let client=Client::builder().no_proxy().build().unwrap();
        assert_eq!(catalog_bytes(client.get(format!("http://{address}/")),None).unwrap(),b"abc");
        server.join().unwrap();
    }
    #[test] fn catalog_retries_a_temporary_response_but_preserves_access_denial(){
        let _=rustls::crypto::ring::default_provider().install_default();
        use std::io::Write;
        for statuses in [vec![503,200],vec![403]]{
            let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
            let expected=*statuses.last().unwrap();
            let server=std::thread::spawn(move||{
                for status in statuses{let(mut socket,_)=listener.accept().unwrap();socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();let mut request=[0u8;2048];let _=socket.read(&mut request);write!(socket,"HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();}
            });
            let client=Client::builder().no_proxy().build().unwrap();
            assert_eq!(catalog_bytes(client.get(format!("http://{address}/")),None).is_ok(),expected==200);server.join().unwrap();
        }
    }
    #[test] fn suggestions_are_text_only_bounded_and_deduplicated(){
        let mut rows=vec![json!({"searchSuggestionRenderer":{"suggestion":{"runs":[{"text":"Miley "},{"text":"Cyrus"}]}}}),json!({"searchSuggestionRenderer":{"suggestion":{"simpleText":"miley cyrus"}}})];
        rows.push(json!({"unrelated":{"title":"do not suggest"}}));
        assert_eq!(suggestion_texts(&json!({"contents":rows})),vec!["Miley Cyrus"]);
        let many:Vec<Value>=(0..50).map(|i|json!({"searchSuggestionRenderer":{"suggestion":{"simpleText":format!("Song {i}")}}})).collect();
        assert_eq!(suggestion_texts(&json!(many)).len(),8);
        for status in [401,403,404,429]{assert!(!transient_catalog_status(status));}
        for status in [500,502,503,504]{assert!(transient_catalog_status(status));}
    }
}

#[cfg(test)]
mod account_tests {
    use super::*;
    #[test]
    fn the_account_is_used_only_when_youtube_limits_or_refuses_the_guest() {
        for message in [stream_error(b"429"), stream_error(b"http error 403"), stream_error(b"sign in")] { assert!(account_helps(message), "{message}"); }
        for message in [stream_error(b"http error 503"), stream_error(b"requested format is not available"), "Cancelled", "Could not open this track"] { assert!(!account_helps(message), "{message}"); }
    }
    #[test]
    fn without_a_sign_in_a_guest_limit_ends_at_once_and_runs_nothing() {
        let limit = Arc::new(crate::music_audio::PlaybackLimit::default());
        limit.note(Some(60));
        let started = Instant::now();
        let result = resolve_with("dQw4w9WgXcQ", "", Duration::from_secs(5), limit, &|| false, None);
        assert_eq!(result.err().map(|e| e.message), Some(stream_error(b"429").to_string()));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    #[test]
    fn the_account_has_its_own_limit_so_a_guest_limit_never_blocks_it() {
        let guest = Arc::new(crate::music_audio::PlaybackLimit::default());
        guest.note(Some(60));
        assert!(guest.active() && !account_limit().active());
        assert!(!Arc::ptr_eq(&guest, &account_limit()));
    }
}
