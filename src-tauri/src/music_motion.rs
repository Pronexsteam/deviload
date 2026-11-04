use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{fs,io::Read,path::{Path,PathBuf},sync::{Mutex,OnceLock},time::{Duration,Instant}};
use tauri::Manager;

const HOST:&str="vivimusicanvas.mkmdevilmi.workers.dev";
const CLIP_LIMIT:u64=24*1024*1024;
const CACHE_LIMIT:u64=128*1024*1024;
static LOOKUP:Mutex<()>=Mutex::new(());
static INDEX:OnceLock<Mutex<Option<(Instant,Value)>>>=OnceLock::new();
fn normalized(s:&str)->String{s.chars().filter(|c|c.is_alphanumeric()).flat_map(char::to_lowercase).collect()}
fn clip_url(s:&str)->bool{
    url::Url::parse(s).is_ok_and(|u|u.scheme()=="https"&&u.host_str()==Some(HOST)&&u.port_or_known_default()==Some(443)
        &&u.username().is_empty()&&u.password().is_none()&&u.path().starts_with("/Song/")&&u.path().ends_with(".mp4")&&u.query().is_none())
}
fn choose(index:&Value,title:&str,artist:&str,album:&str)->Option<String>{
    let title=normalized(title);let artist=normalized(artist);
    if title.is_empty()||artist.is_empty(){return None;}
    index["items"].as_array()?.iter().take(5000).find_map(|i|{
        let url=i["url"].as_str()?;
        (normalized(i["song"].as_str()?)==title&&normalized(i["artist"].as_str()?)==artist
            &&(album.is_empty()||i["album"].as_str().is_none_or(|a|a.is_empty()||normalized(a)==normalized(album)))&&clip_url(url)).then(||url.to_owned())
    })
}
fn bounded(response:reqwest::blocking::Response,limit:u64)->Option<Vec<u8>>{
    let response=response.error_for_status().ok()?;
    if response.content_length().is_some_and(|n|n>limit){return None;}
    let mut bytes=Vec::new();response.take(limit+1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64<=limit).then_some(bytes)
}
fn cache_files(dir:&Path)->Vec<(PathBuf,u64,std::time::SystemTime)>{
    let Ok(entries)=fs::read_dir(dir)else{return vec![]};
    entries.flatten().filter_map(|e|{
        let name=e.file_name();let name=name.to_str()?;
        if name.len()!=68||!name.ends_with(".mp4")||!name[..64].bytes().all(|b|b.is_ascii_hexdigit()){return None;}
        let m=fs::symlink_metadata(e.path()).ok()?;if !m.is_file()||m.file_type().is_symlink(){return None;}
        Some((e.path(),m.len(),m.modified().ok()?))
    }).collect()
}
pub fn fetch(dir:&Path,title:&str,artist:&str,album:&str,proxy:&str)->Option<PathBuf>{
    if title.len()>1000||artist.len()>500||album.len()>1000||title.trim().is_empty()||artist.trim().is_empty(){return None;}
    // Keep artwork work bounded and separate from audio/download workers.
    let _lock=LOOKUP.try_lock().ok()?;
    let _=rustls::crypto::ring::default_provider().install_default();
    let mut builder=reqwest::blocking::Client::builder().timeout(Duration::from_secs(12)).connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none()).user_agent(concat!("Deviload/",env!("CARGO_PKG_VERSION")));
    if !proxy.is_empty(){builder=builder.proxy(reqwest::Proxy::all(proxy).ok()?);}
    let client=builder.build().ok()?;
    let mut index=INDEX.get_or_init(||Mutex::new(None)).lock().ok()?;
    if index.as_ref().is_none_or(|(at,_)|at.elapsed()>Duration::from_secs(1800)){
        // Cache failures too; repeated opens must not hammer an unavailable host.
        let value=client.get(format!("https://{HOST}/canvas.json")).timeout(Duration::from_secs(5)).send().ok()
            .and_then(|r|bounded(r,2*1024*1024)).and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        *index=Some((Instant::now(),value));
    }
    let url=choose(&index.as_ref()?.1,title,artist,album)?;drop(index);
    let cache=dir.join("music-motion-v1");fs::create_dir_all(&cache).ok()?;
    if fs::symlink_metadata(&cache).ok()?.file_type().is_symlink(){return None;}
    let hash=format!("{:x}",Sha256::digest(url.as_bytes()));let file=cache.join(format!("{hash}.mp4"));
    if let Ok(m)=fs::symlink_metadata(&file){if m.is_file()&&!m.file_type().is_symlink()&&m.len()>12&&m.len()<=CLIP_LIMIT{return Some(file);}else{return None;}}
    let bytes=bounded(client.get(&url).send().ok()?,CLIP_LIMIT)?;
    if bytes.len()<12||&bytes[4..8]!=b"ftyp"{return None;}
    let mut files=cache_files(&cache);files.sort_by_key(|f|f.2);let mut total:u64=files.iter().map(|f|f.1).sum();
    for (path,len,_) in files {if total+bytes.len() as u64<=CACHE_LIMIT{break;}if fs::remove_file(path).is_ok(){total=total.saturating_sub(len);}}
    if total+bytes.len() as u64>CACHE_LIMIT{return None;}
    let temp=cache.join(format!("{hash}.part"));
    // create_new never follows a stale/symlink temporary file.
    use std::io::Write;
    let mut out=fs::OpenOptions::new().write(true).create_new(true).open(&temp).ok()?;
    let written=out.write_all(&bytes).and_then(|_|out.sync_all());drop(out);
    if written.is_err(){let _=fs::remove_file(&temp);return None;}
    if fs::rename(&temp,&file).is_err(){let _=fs::remove_file(&temp);return None;}
    Some(file)
}

#[tauri::command]
pub async fn music_motion(title:String,artist:String,album:Option<String>,engine:tauri::State<'_,crate::Engine>,app:tauri::AppHandle)->Result<Option<String>,String>{
    let dir=engine.dir.clone();let proxy=crate::stored_proxy(&dir);
    let Some(file)=tauri::async_runtime::spawn_blocking(move||fetch(&dir,&title,&artist,&album.unwrap_or_default(),&proxy)).await.ok().flatten() else{return Ok(None);};
    app.asset_protocol_scope().allow_file(&file).map_err(|e|e.to_string())?;Ok(Some(file.to_string_lossy().into_owned()))
}

#[cfg(test)] mod tests{
    use super::*;use serde_json::json;
    #[test] fn only_exact_recording_and_known_mp4_host(){
        let index=json!({"items":[{"song":"Flowers","artist":"Miley Cyrus","album":"Endless Summer Vacation","url":format!("https://{HOST}/Song/2.mp4")}]});
        assert!(choose(&index,"FLOWERS","Miley Cyrus","").is_some());
        for (title,artist,album) in [("Flowers (Live)","Miley Cyrus",""),("Flowers","Other",""),("Flowers","Miley Cyrus","Other"),("","","")] {assert!(choose(&index,title,artist,album).is_none());}
        for url in ["http://127.0.0.1/Song/a.mp4","https://example.com/Song/a.mp4","https://vivimusicanvas.mkmdevilmi.workers.dev/Song/a.m3u8","https://vivimusicanvas.mkmdevilmi.workers.dev:444/Song/a.mp4"]{assert!(!clip_url(url));}
    }
    #[test] fn pruning_only_counts_our_hashed_clips(){
        let dir=tempfile::tempdir().unwrap();fs::write(dir.path().join("user.mp4"),b"keep").unwrap();
        fs::write(dir.path().join(format!("{}.mp4","a".repeat(64))),b"cached").unwrap();
        let files=cache_files(dir.path());assert_eq!(files.len(),1);assert_eq!(files[0].1,6);
    }
}
