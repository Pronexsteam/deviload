use serde_json::{json, Value};
use std::{io::Read, time::Duration};

fn unison_result(value:&Value, video_id:&str, duration:f64)->Option<Value>{
    let data=&value["data"];
    if value["success"]!=true || data["videoId"].as_str()!=Some(video_id) || data["format"]!="ttml" || data["syncType"]!="richsync" {return None;}
    let measured=data["duration"].as_f64()?;
    if !measured.is_finite() || (measured-duration).abs()>3.0 {return None;}
    let ttml=data["lyrics"].as_str().filter(|s|!s.is_empty()&&s.len()<=500000)?;
    Some(json!({"ttml":ttml,"source":"Unison","duration":measured}))
}

fn fetch_unison(video_id:&str,duration:f64,proxy:&str)->Option<Value>{
    if video_id.len()!=11 || !video_id.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'_'||c==b'-') || !duration.is_finite() || !(1.0..=86400.0).contains(&duration){return None;}
    let _=rustls::crypto::ring::default_provider().install_default();
    let mut builder=reqwest::blocking::Client::builder().timeout(Duration::from_secs(5)).connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none()).user_agent(concat!("Deviload/",env!("CARGO_PKG_VERSION")));
    if !proxy.is_empty(){builder=builder.proxy(reqwest::Proxy::all(proxy).ok()?);}
    let client=builder.build().ok()?;
    let mut address=url::Url::parse("https://unison.boidu.dev/lyrics").ok()?;
    address.query_pairs_mut().append_pair("v",video_id);
    let response=client.get(address).send().ok()?.error_for_status().ok()?;
    let mut bytes=Vec::new();response.take(600001).read_to_end(&mut bytes).ok()?;
    if bytes.len()>600000{return None;}
    unison_result(&serde_json::from_slice(&bytes).ok()?,video_id,duration)
}

pub fn fetch(title: &str, artist: &str, album: &str, duration: f64, proxy: &str) -> Option<Value> {
    if title.trim().is_empty() || artist.trim().is_empty() || title.len()>1000 || artist.len()>500 || album.len()>1000 || !duration.is_finite() || !(1.0..=86400.0).contains(&duration) { return None; }
    // The provider does not return recording IDs. Do not attach album timing to
    // edits whose speed or arrangement differs, even if its fuzzy matcher does.
    let lower=title.to_lowercase();
    if ["slowed","sped up","speed up","remix","live","acoustic","instrumental","nightcore"].iter().any(|v| lower.split(|c:char| !c.is_alphanumeric()).collect::<Vec<_>>().join(" ").contains(v)) { return None; }
    let _=rustls::crypto::ring::default_provider().install_default();
    let mut builder=reqwest::blocking::Client::builder().timeout(Duration::from_secs(6)).connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none()).user_agent(concat!("Deviload/",env!("CARGO_PKG_VERSION")));
    if !proxy.is_empty(){builder=builder.proxy(reqwest::Proxy::all(proxy).ok()?);}
    let client=builder.build().ok()?;
    let mut address=url::Url::parse("https://api.betterlyrics.org/getLyrics").ok()?;
    address.query_pairs_mut().append_pair("s",title).append_pair("a",artist).append_pair("al",album).append_pair("d",&duration.round().to_string());
    let response=client.get(address).send().ok()?.error_for_status().ok()?;
    let mut bytes=Vec::new();response.take(600001).read_to_end(&mut bytes).ok()?;
    if bytes.len()>600000{return None;}
    let value:Value=serde_json::from_slice(&bytes).ok()?;
    if value["score"].as_f64().is_some_and(|s|s<0.9){return None;}
    let ttml=value["ttml"].as_str().filter(|s|s.len()<=500000)?;
    Some(json!({"ttml":ttml,"source":"Better Lyrics"}))
}

#[tauri::command]
pub async fn music_word_lyrics(title:String,artist:String,album:Option<String>,duration:f64,provider:Option<String>,video_id:Option<String>,engine:tauri::State<'_,crate::Engine>) -> Result<Option<Value>,String> {
    let proxy=crate::stored_proxy(&engine.dir);
    Ok(tauri::async_runtime::spawn_blocking(move||match provider.as_deref(){
        Some("unison")=>fetch_unison(&video_id.unwrap_or_default(),duration,&proxy),
        None|Some("better")=>fetch(&title,&artist,&album.unwrap_or_default(),duration,&proxy),
        _=>None,
    }).await.ok().flatten())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn invalid_requests_do_not_contact_provider(){
        assert!(fetch("","Artist","",200.0,"").is_none());
        assert!(fetch("Song (Slowed)","Artist","",200.0,"").is_none());
        assert!(fetch("Song","Artist","",f64::NAN,"").is_none());
    }
    #[test] fn community_lyrics_require_the_same_recording_and_duration(){
        let mut value=json!({"success":true,"data":{"videoId":"abcdefghijk","duration":200,"format":"ttml","syncType":"richsync","lyrics":"<tt/>"}});
        assert!(unison_result(&value,"abcdefghijk",200.0).is_some());
        assert!(unison_result(&value,"abcdefghijk",210.0).is_none());
        assert!(unison_result(&value,"01234567890",200.0).is_none());
        value["data"]["syncType"]=json!("linesync");
        assert!(unison_result(&value,"abcdefghijk",200.0).is_none());
        assert!(fetch_unison("../wrong",200.0,"").is_none());
    }
}
