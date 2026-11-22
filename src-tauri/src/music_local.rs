//! Device-local index. Media stays in place; only metadata and small JPEGs are cached.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashMap, HashSet}, fs, io::{Read, Write}, path::{Path, PathBuf}, process::Stdio,
    sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
pub mod exact;
pub mod equivalent;

#[derive(Clone, Default, Deserialize, Serialize)]
struct Entry { id: String, path: PathBuf, size: u64, modified: u128, hash: String, title: String, artist: String, album: String, duration: f64, image: bool, #[serde(default)] needs_scan:bool, #[serde(default)] lossless: Option<bool> }
// Lossless audio: FLAC, ALAC, plain PCM (WAV/AIFF) and the other bit-exact codecs. MP3, AAC, Ogg and Opus are not.
fn lossless_codec(codec:&str)->bool { matches!(codec,"flac"|"alac"|"wavpack"|"ape"|"tta"|"mlp"|"truehd") || codec.starts_with("pcm_") }
// Files scanned before the codec was recorded: only extensions that are always lossless count; an .m4a may be AAC.
fn lossless_by_name(path:&Path)->bool { path.extension().and_then(|v|v.to_str()).is_some_and(|s| ["flac","wav","aiff","aif","alac"].contains(&s.to_ascii_lowercase().as_str())) }
#[derive(Default, Deserialize, Serialize)]
struct Index { roots: Vec<PathBuf>, entries: BTreeMap<String, Entry> }
#[derive(Default)]
struct State { dir: PathBuf, index: Index, scanned: usize, changed: usize, failed: usize, error: String, snapshot: Vec<Entry>, generation: u64 }
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static SCANNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
fn state() -> &'static Mutex<State> { STATE.get_or_init(|| Mutex::new(State::default())) }
pub fn local_id(id: &str) -> bool { id.strip_prefix("local:").is_some_and(|s| s.len()==64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())) }
fn supported(path: &Path) -> bool { path.extension().and_then(|v|v.to_str()).is_some_and(|s| ["mp3","flac","wav","m4a","ogg","opus","aac","aiff","aif","alac","wma"].contains(&s.to_ascii_lowercase().as_str())) }
fn stamp(path: &Path) -> Result<(u64,u128),String> { let m=path.metadata().map_err(|e|e.to_string())?;Ok((m.len(),m.modified().map_err(|e|e.to_string())?.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())) }
fn load(dir: &Path) -> Result<(),String> {
    let mut s=state().lock().map_err(|e|e.to_string())?;
    if s.dir==dir {return Ok(());}
    let path=dir.join("music-local-index.json");
    let index=if path.exists(){serde_json::from_reader(fs::File::open(path).map_err(|e|e.to_string())?).map_err(|_|"Local music index could not be read. The existing file was preserved.")?}else{Index::default()};
    *s=State{dir:dir.into(),index,..Default::default()};Ok(())
}
fn save(s: &State) -> Result<(),String> {
    fs::create_dir_all(&s.dir).map_err(|e|e.to_string())?;
    let mut temp=tempfile::NamedTempFile::new_in(&s.dir).map_err(|e|e.to_string())?;
    serde_json::to_writer(temp.as_file_mut(),&s.index).map_err(|e|e.to_string())?;
    temp.flush().map_err(|e|e.to_string())?;temp.as_file().sync_all().map_err(|e|e.to_string())?;
    temp.persist(s.dir.join("music-local-index.json")).map_err(|e|e.to_string())?;Ok(())
}
fn fingerprint(path: &Path) -> Result<String,String> {
    let mut file=fs::File::open(path).map_err(|e|e.to_string())?;let mut hash=Sha256::new();let mut buffer=[0u8;65536];
    loop{if CANCEL.load(Ordering::Relaxed){return Err("Local music scan cancelled.".into());}let n=file.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}hash.update(&buffer[..n]);}Ok(format!("{:x}",hash.finalize()))
}
// Spool bounded output to a temporary file so a damaged file cannot fill a pipe or memory.
fn capture(cmd: &mut std::process::Command, limit: u64) -> Result<Vec<u8>,String> { capture_until(cmd,limit,&CANCEL) }
// Reading one file for the player must not stop because a library scan was cancelled earlier.
fn capture_until(cmd: &mut std::process::Command, limit: u64, stop: &AtomicBool) -> Result<Vec<u8>,String> {
    let mut temp=tempfile::tempfile().map_err(|e|e.to_string())?;
    let mut child=cmd.stdin(Stdio::null()).stdout(Stdio::from(temp.try_clone().map_err(|e|e.to_string())?)).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;crate::child_job::bind(&child);
    let start=Instant::now();let status=loop{
        if stop.load(Ordering::Relaxed)||start.elapsed()>Duration::from_secs(15)||temp.metadata().map_err(|e|e.to_string())?.len()>limit {let _=child.kill();let _=child.wait();return Err("Local music metadata could not be read.".into());}
        if let Some(status)=child.try_wait().map_err(|e|e.to_string())?{break status;}
        std::thread::sleep(Duration::from_millis(30));
    };
    if !status.success(){return Err("Local music metadata could not be read.".into());}
    use std::io::{Seek, SeekFrom};temp.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;let mut data=Vec::new();temp.take(limit+1).read_to_end(&mut data).map_err(|e|e.to_string())?;if data.len() as u64>limit{return Err("Local music metadata could not be read.".into());}Ok(data)
}
fn inspect(path: &Path, dir: &Path, hash: &str) -> Result<(String,String,String,f64,bool,bool),String> {
    let probe=crate::binary("ffprobe")?;let bytes=capture(crate::command(&probe).args(["-v","error","-protocol_whitelist","file,pipe","-max_alloc","33554432","-show_entries","format=duration:format_tags=title,artist,album:stream=codec_type,codec_name:stream_disposition=attached_pic","-of","json"]).arg(path),262144)?;
    let info:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    if !info["streams"].as_array().is_some_and(|a|a.iter().any(|s|s["codec_type"]=="audio")){return Err("The selected file has no audio.".into());}
    let tag=|key:&str|info["format"]["tags"].as_object().and_then(|tags|tags.iter().find(|(k,_)|k.eq_ignore_ascii_case(key))).and_then(|(_,v)|v.as_str()).unwrap_or("").chars().filter(|c|!c.is_control()).take(240).collect::<String>();
    let title=tag("title");let title=if title.is_empty(){path.file_stem().unwrap_or_default().to_string_lossy().chars().take(240).collect()}else{title};
    let duration=info["format"]["duration"].as_str().and_then(|v|v.parse::<f64>().ok()).filter(|v|v.is_finite()&&*v>0.).unwrap_or(0.);
    let art=dir.join("music-local-art");fs::create_dir_all(&art).map_err(|e|e.to_string())?;
    let art_path=art.join(format!("{hash}.jpg"));let mut image=art_path.is_file();
    if !image && info["streams"].as_array().is_some_and(|a|a.iter().any(|s|s["disposition"]["attached_pic"]==1)){
        if let Ok(ffmpeg)=crate::binary("ffmpeg") {if let Ok(data)=capture(crate::command(&ffmpeg).args(["-hide_banner","-loglevel","error","-nostdin","-protocol_whitelist","file,pipe","-max_alloc","33554432","-i"]).arg(path).args(["-map","0:v:0","-frames:v","1","-vf","scale=512:512:force_original_aspect_ratio=decrease","-c:v","mjpeg","-f","image2pipe","-"]),1_048_576){if data.starts_with(&[255,216]){fs::write(&art_path,data).map_err(|e|e.to_string())?;image=true;}}}
    }
    let lossless=info["streams"].as_array().is_some_and(|a|a.iter().any(|s|s["codec_type"]=="audio"&&s["codec_name"].as_str().is_some_and(lossless_codec)));
    Ok((title,tag("artist"),tag("album"),duration,image,lossless))
}
fn scan(roots: Vec<PathBuf>) -> Result<(),String> {
    let (dir,previous)={let s=state().lock().map_err(|e|e.to_string())?;(s.dir.clone(),s.index.entries.clone())};
    let by_path:HashMap<_,_>=previous.values().map(|e|(e.path.clone(),e.clone())).collect();
    let by_hash:HashMap<_,_>=previous.values().map(|e|(e.hash.clone(),e.id.clone())).collect();
    let mut pending=roots;let mut visited=HashSet::new();let mut seen_hash=HashMap::<String,String>::new();
    while let Some(path)=pending.pop(){
        if CANCEL.load(Ordering::Relaxed){break;}
        let meta=match fs::symlink_metadata(&path){Ok(m)=>m,Err(_)=>{state().lock().unwrap().failed+=1;continue;}};
        if meta.file_type().is_symlink(){continue;}
        #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if meta.file_attributes() & 0x400!=0 {continue;}}
        let path=match path.canonicalize(){Ok(p)=>p,Err(_)=>continue};if !visited.insert(path.clone()){continue;}
        if meta.is_dir(){match fs::read_dir(&path){Ok(entries)=>pending.extend(entries.filter_map(Result::ok).map(|e|e.path())),Err(_)=>state().lock().unwrap().failed+=1}continue;}
        if !meta.is_file()||!supported(&path){continue;}
        state().lock().unwrap().scanned+=1;
        let result=(||{
            let (size,modified)=stamp(&path)?;
            if by_path.get(&path).is_some_and(|e|!e.needs_scan&&e.size==size&&e.modified==modified){return Ok(());}
            let hash=fingerprint(&path)?;
            let id=by_path.get(&path).map(|e|e.id.clone()).or_else(||by_hash.get(&hash).cloned()).or_else(||seen_hash.get(&hash).cloned()).unwrap_or_else(||format!("local:{hash}"));
            let (title,artist,album,duration,image,lossless)=inspect(&path,&dir,&hash)?;
            let entry=Entry{id:id.clone(),path,size,modified,hash:hash.clone(),title,artist,album,duration,image,needs_scan:false,lossless:Some(lossless)};seen_hash.insert(hash,id.clone());
            let mut s=state().lock().map_err(|e|e.to_string())?;s.index.entries.insert(id,entry);s.changed+=1;
            if s.changed%100==0 {save(&s)?;}Ok::<(),String>(())
        })();
        if result.is_err(){state().lock().unwrap().failed+=1;}
    }
    let s=state().lock().map_err(|e|e.to_string())?;save(&s)
}
fn begin() -> Result<bool,String> {
    if SCANNING.swap(true,Ordering::AcqRel){return Ok(false);}CANCEL.store(false,Ordering::Relaxed);
    let roots={let mut s=state().lock().map_err(|e|e.to_string())?;s.scanned=0;s.changed=0;s.failed=0;s.error.clear();s.index.roots.clone()};
    std::thread::spawn(move||{if let Err(e)=scan(roots){state().lock().unwrap().error=e;}SCANNING.store(false,Ordering::Release);});Ok(true)
}
#[tauri::command]
pub async fn music_local_choose(app: tauri::AppHandle,window:tauri::WebviewWindow,engine:tauri::State<'_,crate::Engine>,folders:bool) -> Result<bool,String> {
    if window.label()!="main" {return Err("Unavailable window".into());}load(&engine.dir)?;
    if SCANNING.load(Ordering::Acquire){return Ok(false);}
    tauri::async_runtime::spawn_blocking(move||{
        let chosen=if folders{app.dialog().file().blocking_pick_folders()}else{app.dialog().file().add_filter("Audio", &["mp3","flac","wav","m4a","ogg","opus","aac","aiff","aif","alac","wma"]).blocking_pick_files()};
        let Some(chosen)=chosen else{return Ok(false)};
        {let mut s=state().lock().map_err(|e|e.to_string())?;for file in chosen{if let Ok(path)=file.into_path(){if let Ok(path)=path.canonicalize(){if !s.index.roots.contains(&path){s.index.roots.push(path);}}}}save(&s)?;}begin()
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn music_local_scan(window:tauri::WebviewWindow,engine:tauri::State<'_,crate::Engine>,cancel:bool)->Result<bool,String>{
    if window.label()!="main" {return Err("Unavailable window".into());}load(&engine.dir)?;if cancel{CANCEL.store(true,Ordering::Relaxed);Ok(true)}else{begin()}
}
#[tauri::command]
pub async fn music_local_list(window:tauri::WebviewWindow,engine:tauri::State<'_,crate::Engine>,offset:usize,generation:Option<u64>)->Result<Value,String>{
    if window.label()!="main" {return Err("Unavailable window".into());}let dir=engine.dir.clone();
    tauri::async_runtime::spawn_blocking(move||{load(&dir)?;let mut s=state().lock().map_err(|e|e.to_string())?;page(&mut s,offset,generation)
    }).await.map_err(|e|e.to_string())?
}
// Freeze metadata for the entire pagination pass. Inserts during a scan cannot
// shift page boundaries; the next refresh gets a new complete snapshot.
fn page(s:&mut State,offset:usize,generation:Option<u64>)->Result<Value,String>{
    if offset==0{s.snapshot=s.index.entries.values().cloned().collect();s.generation=s.generation.wrapping_add(1);}
    else if generation!=Some(s.generation){return Err("The local music list changed. Refresh it and try again.".into());}
    let items:Vec<_>=s.snapshot.iter().skip(offset).take(400).map(|e|json!({"id":e.id,"kind":"song","title":e.title,"subtitle":e.artist,"artists":if e.artist.is_empty(){vec![]}else{vec![e.artist.clone()]},"album":e.album,"duration":e.duration,"contentHash":e.hash,"lossless":e.lossless.unwrap_or_else(||lossless_by_name(&e.path)),"image":if e.image{format!("music-art://localhost/{}.jpg",e.hash)}else{String::new()}})).collect();
    Ok(json!({"items":items,"total":s.snapshot.len(),"generation":s.generation,"scanning":SCANNING.load(Ordering::Acquire),"scanned":s.scanned,"changed":s.changed,"failed":s.failed,"error":s.error}))
}
pub fn source(id:&str,dir:&Path)->Result<PathBuf,String>{
    if !local_id(id){return Err("Invalid local music track.".into());}load(dir)?;
    let path=state().lock().map_err(|e|e.to_string())?.index.entries.get(id).map(|e|e.path.clone()).ok_or("Local music file is missing. Add its new folder and scan again.")?;
    let path=path.canonicalize().map_err(|_|"Local music file is missing. Add its new folder and scan again.")?;
    if !path.is_file(){return Err("Local music file is missing. Add its new folder and scan again.".into());}Ok(path)
}
// Lyrics kept with a local file. A .lrc beside the audio wins, because it is the copy people edit; otherwise the
// file's own tag as ffprobe names it: ID3 USLT ("lyrics-eng"), Vorbis LYRICS or UNSYNCEDLYRICS, MP4 ©lyr ("lyrics").
// Nothing leaves the computer.
fn lyrics_key(key:&str)->bool { let key=key.to_ascii_lowercase(); key=="lyrics"||key.starts_with("lyrics-")||key=="unsyncedlyrics"||key=="unsynced lyrics"||key=="uslt" }
fn lyrics_text(raw:&str)->Option<String>{
    let text:String=raw.trim_start_matches('\u{feff}').replace("\r\n","\n").replace('\r',"\n").chars().filter(|c|*c=='\n'||*c=='\t'||!c.is_control()).take(200_000).collect();
    (!text.trim().is_empty()).then(||text.trim().to_owned())
}
fn decode_lrc(bytes:&[u8])->String{
    let wide=|big:bool|String::from_utf16_lossy(&bytes[2..].chunks_exact(2).map(|p|if big{u16::from_be_bytes([p[0],p[1]])}else{u16::from_le_bytes([p[0],p[1]])}).collect::<Vec<_>>());
    match bytes { [0xff,0xfe,..]=>wide(false), [0xfe,0xff,..]=>wide(true), _=>String::from_utf8_lossy(bytes).into_owned() }
}
fn sidecar_lyrics(path:&Path)->Option<String>{
    let lrc=path.with_extension("lrc");let meta=lrc.metadata().ok()?;
    if !meta.is_file()||meta.len()>524_288 {return None;}
    lyrics_text(&decode_lrc(&fs::read(lrc).ok()?))
}
static NEVER: AtomicBool = AtomicBool::new(false);
fn tagged_lyrics(path:&Path)->Option<String>{
    let probe=crate::binary("ffprobe").ok()?;
    let bytes=capture_until(crate::command(&probe).args(["-v","error","-protocol_whitelist","file,pipe","-max_alloc","33554432","-show_entries","format_tags:stream_tags","-of","json"]).arg(path),1_048_576,&NEVER).ok()?;
    let info:Value=serde_json::from_slice(&bytes).ok()?;
    let mut tags=vec![&info["format"]["tags"]];
    if let Some(streams)=info["streams"].as_array(){tags.extend(streams.iter().map(|s|&s["tags"]));}
    tags.into_iter().filter_map(Value::as_object).flatten().filter(|(key,_)|lyrics_key(key)).find_map(|(_,value)|value.as_str().and_then(lyrics_text))
}
// Lines stamped [mm:ss.xx] are synced lyrics; anything else is shown as plain text.
fn synced(text:&str)->bool {
    text.lines().filter(|line|{let line=line.trim_start();line.starts_with('[')&&line[1..].split_once(':').is_some_and(|(m,rest)|!m.is_empty()&&m.bytes().all(|b|b.is_ascii_digit())&&rest.starts_with(|c:char|c.is_ascii_digit()))}).take(2).count()>=2
}
fn local_lyrics(path:&Path)->Value{
    let (text,source)=match sidecar_lyrics(path){Some(text)=>(text,"lrc"),None=>match tagged_lyrics(path){Some(text)=>(text,"tag"),None=>return Value::Null}};
    if synced(&text){json!({"synced":text,"plain":"","source":source})}else{json!({"plain":text,"synced":null,"source":source})}
}
#[tauri::command]
pub async fn music_local_lyrics(engine:tauri::State<'_,crate::Engine>,id:String)->Result<Value,String>{
    let dir=engine.dir.clone();
    tauri::async_runtime::spawn_blocking(move||Ok(local_lyrics(&source(&id,&dir)?))).await.map_err(|e|e.to_string())?
}
pub fn artwork(app:&tauri::AppHandle,request:tauri::http::Request<Vec<u8>>)->tauri::http::Response<Vec<u8>>{
    let name=request.uri().path().trim_start_matches('/');let valid=name.strip_suffix(".jpg").is_some_and(|hash|local_id(&format!("local:{hash}")));
    let data=if valid {app.try_state::<crate::Engine>().and_then(|engine|{let path=engine.dir.join("music-local-art").join(name);if path.metadata().ok()?.len()>1_048_576{return None;}fs::read(path).ok()})}else{None};
    tauri::http::Response::builder().status(if data.is_some(){200}else{404}).header("Content-Type","image/jpeg").header("Access-Control-Allow-Origin","*").header("Cache-Control","private, max-age=86400").body(data.unwrap_or_default()).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_pages_remain_complete_while_scan_adds_before_the_offset(){
        let mut s=State::default();
        for n in 1000..2420 {let id=format!("local:{n:064x}");s.index.entries.insert(id.clone(),Entry{id,..Default::default()});}
        let first=page(&mut s,0,None).unwrap();let generation=first["generation"].as_u64();
        let mut ids:Vec<String>=first["items"].as_array().unwrap().iter().map(|v|v["id"].as_str().unwrap().into()).collect();
        for n in 0..1000 {let id=format!("local:{n:064x}");s.index.entries.insert(id.clone(),Entry{id,..Default::default()});}
        for offset in [400,800,1200] {ids.extend(page(&mut s,offset,generation).unwrap()["items"].as_array().unwrap().iter().map(|v|v["id"].as_str().unwrap().to_owned()));}
        assert_eq!(ids.len(),1420);assert_eq!(ids.iter().collect::<HashSet<_>>().len(),1420);
        let refreshed=page(&mut s,0,None).unwrap();assert_eq!(refreshed["total"],2420);
        assert!(page(&mut s,400,generation).is_err());
    }
    #[test]
    fn local_index_reads_tags_cover_relocates_skips_unchanged_and_blocks_network(){
        let dir=tempfile::tempdir().unwrap();let media=dir.path().join("media");fs::create_dir(&media).unwrap();
        let ffmpeg=crate::binary("ffmpeg").unwrap();let file=media.join("tagged.flac");let cover=dir.path().join("cover.png");
        assert!(crate::command(&ffmpeg).args(["-hide_banner","-loglevel","error","-nostdin","-f","lavfi","-i","color=c=blue:s=64x64","-frames:v","1"]).arg(&cover).status().unwrap().success());
        let status=crate::command(&ffmpeg).args(["-hide_banner","-loglevel","error","-nostdin","-f","lavfi","-i","sine=frequency=440:duration=1","-i"]).arg(&cover).args(["-map","0:a","-map","1:v","-c:a","flac","-c:v","copy","-disposition:v","attached_pic","-metadata","title=Local test","-metadata","artist=Test artist","-metadata","album=Test album"]).arg(&file).status().unwrap();assert!(status.success());
        let index_dir=dir.path().join("index");load(&index_dir).unwrap();CANCEL.store(false,Ordering::Relaxed);
        scan(vec![media.clone()]).unwrap();let entry=state().lock().unwrap().index.entries.values().next().unwrap().clone();
        assert!(local_id(&entry.id));assert_eq!(entry.title,"Local test");assert_eq!(entry.artist,"Test artist");assert_eq!(entry.album,"Test album");assert!(entry.duration>0.9);assert!(entry.image);
        assert!(source(&entry.id,&index_dir).unwrap().is_file());assert!(fs::metadata(index_dir.join("music-local-art").join(format!("{}.jpg",entry.hash))).unwrap().len()<1_048_576);
        let changed=state().lock().unwrap().changed;scan(vec![media.clone()]).unwrap();assert_eq!(state().lock().unwrap().changed,changed);
        let relocated=dir.path().join("moved");fs::create_dir(&relocated).unwrap();fs::rename(&file,relocated.join("renamed.flac")).unwrap();
        assert!(source(&entry.id,&index_dir).is_err());scan(vec![relocated.clone()]).unwrap();assert!(source(&entry.id,&index_dir).unwrap().ends_with("renamed.flac"));assert_eq!(state().lock().unwrap().index.entries.len(),1);
        let moved=relocated.join("renamed.flac");
        exact::indexed_source(&index_dir,&entry.id,&entry.hash).unwrap();
        let modified=moved.metadata().unwrap().modified().unwrap();let mut bytes=fs::read(&moved).unwrap();
        let tag=bytes.windows(10).position(|b|b==b"Local test").unwrap();bytes[tag+6]=b'b';
        fs::write(&moved,bytes).unwrap();fs::File::options().write(true).open(&moved).unwrap().set_modified(modified).unwrap();
        assert!(exact::indexed_source(&index_dir,&entry.id,&entry.hash).is_err());
        assert!(state().lock().unwrap().index.entries[&entry.id].needs_scan);
        scan(vec![relocated.clone()]).unwrap();
        let updated=state().lock().unwrap().index.entries[&entry.id].clone();
        assert_eq!(updated.title,"Local best");assert!(!updated.needs_scan);assert_ne!(updated.hash,entry.hash);
        assert!(exact::indexed_source(&index_dir,&entry.id,&entry.hash).is_err());
        assert!(exact::indexed_source(&index_dir,&entry.id,&updated.hash).is_ok());
        // A network playlist disguised as audio must never contact its origin.
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();listener.set_nonblocking(true).unwrap();
        let hostile=media.join("remote.mp3");fs::write(&hostile,format!("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://{}/audio.ts\n#EXT-X-ENDLIST\n",listener.local_addr().unwrap())).unwrap();
        assert!(inspect(&hostile,&index_dir,&"a".repeat(64)).is_err());assert_eq!(listener.accept().unwrap_err().kind(),std::io::ErrorKind::WouldBlock);
        CANCEL.store(true,Ordering::Relaxed);assert!(fingerprint(&relocated.join("renamed.flac")).is_err());CANCEL.store(false,Ordering::Relaxed);
        let corrupt=dir.path().join("corrupt");fs::create_dir(&corrupt).unwrap();fs::write(corrupt.join("music-local-index.json"),"bad data").unwrap();assert!(load(&corrupt).is_err());assert_eq!(fs::read_to_string(corrupt.join("music-local-index.json")).unwrap(),"bad data");
        for id in ["local:../secret","local:https://remote","local:abc",&format!("local:{}","A".repeat(64))]{assert!(!local_id(id));}
    }
}

#[cfg(test)]
mod lossless_tests {
    use super::*;
    #[test]
    fn lossless_means_bit_exact_codecs_and_old_entries_fall_back_to_sure_extensions() {
        for codec in ["flac", "alac", "pcm_s16le", "pcm_s24be", "wavpack", "ape"] { assert!(lossless_codec(codec), "{codec}"); }
        for codec in ["mp3", "aac", "opus", "vorbis", "wmav2", ""] { assert!(!lossless_codec(codec), "{codec}"); }
        assert!(lossless_by_name(Path::new("C:/Music/a.FLAC")) && lossless_by_name(Path::new("b.wav")) && lossless_by_name(Path::new("c.aiff")));
        // An .m4a may hold AAC as well as ALAC, so only its codec decides.
        assert!(!lossless_by_name(Path::new("d.m4a")) && !lossless_by_name(Path::new("e.mp3")));
    }
}

#[cfg(test)]
mod lyrics_tests {
    use super::*;
    fn write(ffmpeg:&Path,file:&Path,tag:&str,value:&str){
        let status=crate::command(ffmpeg).args(["-hide_banner","-loglevel","error","-nostdin","-y","-f","lavfi","-i","sine=frequency=440:duration=1","-metadata"]).arg(format!("{tag}={value}")).arg(file).status().unwrap();assert!(status.success());
    }
    #[test]
    fn local_files_give_their_own_lyrics_and_an_lrc_beside_them_wins(){
        let dir=tempfile::tempdir().unwrap();let ffmpeg=crate::binary("ffmpeg").unwrap();
        for (name,tag) in [("song.mp3","lyrics"),("song.flac","LYRICS"),("song.ogg","UNSYNCEDLYRICS"),("song.m4a","lyrics")] {
            let file=dir.path().join(name);write(&ffmpeg,&file,tag,"First line\nSecond line");
            let lyrics=local_lyrics(&file);assert_eq!(lyrics["source"],"tag","{name}");assert_eq!(lyrics["plain"],"First line\nSecond line","{name}");
        }
        let file=dir.path().join("timed.flac");write(&ffmpeg,&file,"LYRICS","[00:01.00]One\n[00:02.50]Two");
        assert_eq!(local_lyrics(&file)["synced"],"[00:01.00]One\n[00:02.50]Two");
        let plain=dir.path().join("plain.flac");write(&ffmpeg,&plain,"title","No lyrics");assert!(local_lyrics(&plain).is_null());
        let mut bom=vec![0xff,0xfe];for unit in "[00:03.00]\u{421}\u{43b}\u{43e}\u{432}\u{43e}\r\n[00:04.00]Next".encode_utf16(){bom.extend(unit.to_le_bytes());}
        fs::write(dir.path().join("plain.lrc"),bom).unwrap();
        let lyrics=local_lyrics(&plain);assert_eq!(lyrics["source"],"lrc");assert_eq!(lyrics["synced"],"[00:03.00]\u{421}\u{43b}\u{43e}\u{432}\u{43e}\n[00:04.00]Next");
        assert!(!synced("[ar:Artist]\n[ti:Title]\nPlain words"));
        assert!(lyrics_key("lyrics-eng")&&lyrics_key("UNSYNCEDLYRICS")&&!lyrics_key("title"));
    }
}
