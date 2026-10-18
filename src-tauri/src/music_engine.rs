//! Persistent guest playback worker. Executable code is bundled or signature-verified.
use base64::Engine as _;
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::{BufRead, BufReader, Read, Write}, path::{Path,PathBuf}, process::{Child,ChildStdin,Stdio}, sync::{Arc,Mutex,OnceLock,mpsc,atomic::{AtomicBool,AtomicU64,Ordering}}, thread, time::{Duration,Instant}};
#[path="music_engine_diagnostics.rs"]
pub(crate) mod diagnostics;
use diagnostics::{Stage as DiagnosticStage,Code as DiagnosticCode};

const EMBEDDED: &[u8] = include_bytes!("../music-engine/payload.json.gz");
const VERSION: u64 = 1;
const FEED: &str = "https://raw.githubusercontent.com/Pronexsteam/deviload/updates/music-engine.json";
static WORKER: OnceLock<Mutex<Option<Arc<Worker>>>> = OnceLock::new();
static SERIAL: AtomicU64 = AtomicU64::new(1);
static FILES: [&str;3] = ["engine.mjs","po-worker.ts","xhr-sync-worker.js"];
type Reply = Result<Value,String>;
pub fn restricted_error(error:&str)->bool { error.starts_with("Playback restricted:") || error.contains("temporarily limited") }
struct Worker { input:Mutex<ChildStdin>,child:Mutex<Child>,pending:Mutex<HashMap<u64,mpsc::Sender<Reply>>>,alive:AtomicBool,port:Mutex<u16>,version:u64 }
impl Drop for Worker {fn drop(&mut self){if let Ok(child)=self.child.get_mut(){let _=child.kill();let _=child.wait();}}}
fn root()->Result<PathBuf,String>{
    #[cfg(debug_assertions)]
    if let Some(path)=std::env::var_os("DEVILOAD_MUSIC_TEST_DIR"){return Ok(PathBuf::from(path));}
    Ok(dirs::cache_dir().ok_or("No music cache folder")?.join("com.deviload.desktop").join("music"))
}
fn unpack(bytes:&[u8])->Result<Value,String>{
    if bytes.len()>4*1024*1024{return Err("Music engine package is too large".into());}
    let mut decoded=Vec::new();flate2::read::GzDecoder::new(bytes).take(12*1024*1024+1).read_to_end(&mut decoded).map_err(|_|"Invalid music engine package")?;
    if decoded.len()>12*1024*1024{return Err("Music engine package is too large".into());}
    let payload:Value=serde_json::from_slice(&decoded).map_err(|_|"Invalid music engine package")?;
    if payload["protocol"]!=1||payload["version"].as_u64().is_none()||payload["files"].as_object().is_none_or(|o|o.len()!=3)||FILES.iter().any(|f|payload["files"][f].as_str().is_none_or(|s|s.is_empty())){return Err("Incompatible music engine package".into());}
    Ok(payload)
}
fn install(root:&Path,bytes:&[u8])->Result<(PathBuf,u64),String>{
    let payload=unpack(bytes)?;let version=payload["version"].as_u64().unwrap();let folder=root.join(format!("engine-{version}"));
    fs::create_dir_all(&folder).map_err(|_|"Could not prepare music engine")?;
    for name in FILES {let path=folder.join(name);let text=payload["files"][name].as_str().unwrap();
        if fs::read(&path).ok().as_deref()!=Some(text.as_bytes()){fs::write(path,text).map_err(|_|"Could not prepare music engine")?;}}
    Ok((folder,version))
}
fn verified(envelope:&[u8])->Result<Vec<u8>,String>{
    let config:Value=serde_json::from_str(include_str!("../tauri.conf.json")).map_err(|_|"Invalid updater key")?;
    verified_by(envelope,config["plugins"]["updater"]["pubkey"].as_str().ok_or("Missing updater key")?)
}
fn verified_by(envelope:&[u8],public_key:&str)->Result<Vec<u8>,String>{
    if envelope.len()>6*1024*1024{return Err("Music engine update is too large".into());}
    let data:Value=serde_json::from_slice(envelope).map_err(|_|"Invalid music engine update")?;
    let bytes=base64::engine::general_purpose::STANDARD.decode(data["payload"].as_str().ok_or("Missing music engine payload")?).map_err(|_|"Invalid music engine payload")?;
    let signature=base64::engine::general_purpose::STANDARD.decode(data["signature"].as_str().ok_or("Missing music engine signature")?).map_err(|_|"Invalid music engine signature")?;
    let key=base64::engine::general_purpose::STANDARD.decode(public_key).map_err(|_|"Invalid updater key")?;
    let public=minisign_verify::PublicKey::decode(std::str::from_utf8(&key).map_err(|_|"Invalid updater key")?).map_err(|_|"Invalid updater key")?;
    let sig=minisign_verify::Signature::decode(std::str::from_utf8(&signature).map_err(|_|"Invalid music engine signature")?).map_err(|_|"Invalid music engine signature")?;
    public.verify(&bytes,&sig,false).map_err(|_|"Music engine signature verification failed")?;
    unpack(&bytes)?;Ok(bytes)
}
fn assets(root:&Path)->Result<PathBuf,String>{
    // Reverify every launch; a writable cache is never trusted as executable code.
    if let Ok(envelope)=fs::read(root.join("update.json")){
        if let Ok(bytes)=verified(&envelope){if unpack(&bytes)?["version"].as_u64().unwrap()>VERSION{return install(root,&bytes).map(|v|v.0);}}
    }
    install(root,EMBEDDED).map(|v|v.0)
}
impl Worker {
    fn send(&self,value:Value)->Result<(),String>{let mut input=self.input.lock().unwrap();writeln!(input,"{value}").and_then(|_|input.flush()).map_err(|_|"Music engine stopped".into())}
    fn request(&self,mut value:Value,timeout:Duration,cancelled:&dyn Fn()->bool)->Reply{
        if !self.alive.load(Ordering::Relaxed){return Err("Music engine stopped".into());}
        let key=SERIAL.fetch_add(1,Ordering::Relaxed);value["key"]=json!(key);let(tx,rx)=mpsc::channel();
        let stage=match value["action"].as_str(){Some("play") if value["preload"]==true=>DiagnosticStage::Preload,Some("cache")=>DiagnosticStage::Cache,_=>DiagnosticStage::Resolve};
        {let mut pending=self.pending.lock().unwrap();if pending.len()>=16{return Err("Music engine is busy".into());}pending.insert(key,tx);}
        if let Err(e)=self.send(value){self.pending.lock().unwrap().remove(&key);return Err(e);}
        let started=Instant::now();diagnostics::record(stage,DiagnosticCode::Requested,None);
        let deadline=started+timeout;
        let answer=loop{if cancelled(){break Err("Cancelled".into());}if Instant::now()>deadline{break Err("Music engine timed out".into());}
            match rx.recv_timeout(Duration::from_millis(20)){Ok(v)=>break v,Err(mpsc::RecvTimeoutError::Disconnected)=>break Err("Music engine stopped".into()),Err(_)=>{}}};
        self.pending.lock().unwrap().remove(&key);diagnostics::result(stage,&answer,Some(started.elapsed().as_millis() as u64));answer
    }
    fn start(folder:&Path,root:&Path)->Result<Arc<Self>,String>{
        diagnostics::record(DiagnosticStage::Worker,DiagnosticCode::Requested,None);
        fs::create_dir_all(root).map_err(|_|"Could not prepare music cache")?;
        let deno=crate::binary("deno")?;let mut command=crate::command(&deno);
        command.env_clear();for name in ["SystemRoot","TEMP","TMP"]{if let Some(value)=std::env::var_os(name){command.env(name,value);}}
        command.current_dir(root).args(["run","--no-config","--no-npm","--no-remote","--no-prompt","--unstable-worker-options","--allow-env","--allow-net"])
            .arg(format!("--allow-read={},{}",folder.display(),root.display())).arg(format!("--allow-write={}",root.display()))
            .arg(folder.join("engine.mjs")).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child=command.spawn().map_err(|_|"Could not start music engine")?;
        let output=child.stdout.take().ok_or("No music engine output")?;let input=child.stdin.take().ok_or("No music engine input")?;
        if let Some(stderr)=child.stderr.take(){thread::spawn(move||diagnostics::drain_stderr(stderr));}
        let version=folder.file_name().and_then(|name|name.to_str()).and_then(|name|name.strip_prefix("engine-")).and_then(|number|number.parse::<u64>().ok()).unwrap_or(VERSION);
        let worker=Arc::new(Self{input:Mutex::new(input),child:Mutex::new(child),pending:Mutex::new(HashMap::new()),alive:AtomicBool::new(true),port:Mutex::new(0),version});
        let weak=Arc::downgrade(&worker);let(tx,rx)=mpsc::channel();
        thread::spawn(move||{
            let mut reader=BufReader::new(output);
            loop{
                let mut line=String::new();match reader.by_ref().take(65537).read_line(&mut line){Ok(0)|Err(_)=>break,_=>{}}
                if line.len()>65536{break;}let Ok(value)=serde_json::from_str::<Value>(&line)else{continue;};let Some(worker)=weak.upgrade()else{break;};
                if value["event"]=="ready" {if let Some(port)=value["port"].as_u64().filter(|p|*p>0&&*p<=65535){*worker.port.lock().unwrap()=port as u16;diagnostics::record(DiagnosticStage::Worker,DiagnosticCode::Ready,None);let _=tx.send(());}continue;}
                if diagnostics::protocol(&value){continue;}
                if value["event"]=="fallback" {
                    let key=value["key"].clone();let id=value["id"].as_str().unwrap_or("").to_owned();let weak=Arc::downgrade(&worker);
                    thread::spawn(move||{diagnostics::record(DiagnosticStage::Fallback,DiagnosticCode::Requested,None);let started=Instant::now();let result=crate::music::reserve_audio(&id);diagnostics::result(DiagnosticStage::Fallback,&result,Some(started.elapsed().as_millis() as u64));if let Some(worker)=weak.upgrade(){let response=match result{Ok(url)=>json!({"action":"reserve","key":key,"url":url}),Err(e)=>json!({"action":"reserve","key":key,"error":e})};let _=worker.send(response);}});continue;
                }
                if let Some(key)=value["key"].as_u64(){if let Some(sender)=worker.pending.lock().unwrap().remove(&key){let reply=if let Some(error)=value["error"].as_str(){Err(error.to_owned())}else{Ok(value["data"].clone())};let _=sender.send(reply);}}
            }
            if let Some(worker)=weak.upgrade(){diagnostics::record(DiagnosticStage::Worker,DiagnosticCode::WorkerStopped,None);worker.alive.store(false,Ordering::Relaxed);worker.pending.lock().unwrap().clear();let mut child=worker.child.lock().unwrap();let _=child.kill();let _=child.wait();}
        });
        if rx.recv_timeout(Duration::from_secs(18)).is_err(){diagnostics::record(DiagnosticStage::Worker,DiagnosticCode::Timeout,None);worker.alive.store(false,Ordering::Relaxed);let _=worker.child.lock().unwrap().kill();return Err("Music engine did not start".into());}
        Ok(worker)
    }
}
fn worker()->Result<Arc<Worker>,String>{
    let mut state=WORKER.get_or_init(||Mutex::new(None)).lock().unwrap();
    if let Some(worker)=state.as_ref().filter(|w|w.alive.load(Ordering::Relaxed)){return Ok(worker.clone());}
    let root=root()?;let folder=assets(&root)?;
    let started=Worker::start(&folder,&root).or_else(|error|{
        if folder.file_name().is_some_and(|n|n!=format!("engine-{VERSION}").as_str()){
            let _=fs::rename(root.join("update.json"),root.join("rejected-update.json"));
            if let Ok(previous)=fs::read(root.join("previous-update.json")) {
                if let Ok(bytes)=verified(&previous) {
                    if let Ok(worker)=Worker::start(&install(&root,&bytes)?.0,&root) {
                        let _=fs::write(root.join("update.json"),previous);return Ok(worker);
                    }
                }
            }
            Worker::start(&install(&root,EMBEDDED)?.0,&root)
        }else{Err(error)}
    })?;*state=Some(started.clone());Ok(started)
}
pub fn prepare(){if let Ok(worker)=worker(){let _=worker.send(json!({"action":"prepare"}));}}
pub fn cancel(generation:u64){if let Some(state)=WORKER.get(){if let Some(worker)=state.lock().unwrap().as_ref(){let _=worker.send(json!({"action":"cancel","generation":generation}));}}}
pub fn play(id:&str,refresh:bool,preload:bool,generation:u64,cancelled:&dyn Fn()->bool)->Result<String,String>{
    let worker=worker().inspect_err(|error|diagnostics::record(DiagnosticStage::Worker,diagnostics::classify(error),None))?;
    if cancelled(){return Err("Cancelled".into());}
    let data=worker.request(json!({"action":"play","id":id,"refresh":refresh,"preload":preload,"generation":generation}),Duration::from_secs(16),cancelled)?;
    let raw=data["url"].as_str().ok_or("Invalid music engine response")?;let url=url::Url::parse(raw).map_err(|_|"Invalid music engine response")?;
    if url.scheme()!="http"||url.host_str()!=Some("127.0.0.1")||url.port()!=Some(*worker.port.lock().unwrap())||!url.username().is_empty()||url.password().is_some(){return Err("Invalid music engine response".into());}Ok(raw.into())
}
#[tauri::command]
pub async fn music_cache(clear:Option<bool>,limit:Option<u64>)->Reply{
    if limit.is_some_and(|value| ![209_715_200,1_073_741_824,5_368_709_120].contains(&value)){return Err("Invalid audio cache limit".into());}
    tauri::async_runtime::spawn_blocking(move||worker()?.request(json!({"action":"cache","clear":clear.unwrap_or(false),"limit":limit}),Duration::from_secs(8),&||false)).await.map_err(|_|"Music cache unavailable".to_owned())?
}
#[tauri::command]
pub async fn music_engine_update()->Reply{diagnostics::record(DiagnosticStage::Update,DiagnosticCode::Requested,None);let result=tauri::async_runtime::spawn_blocking(update).await.map_err(|_|"Music engine update failed".to_owned())?;diagnostics::result(DiagnosticStage::Update,&result,None);result}
fn engine_diagnostics()->Value{
    let active=WORKER.get().and_then(|state|state.lock().unwrap().as_ref().filter(|worker|worker.alive.load(Ordering::Relaxed)).map(|worker|worker.version));
    json!({"running":active.is_some(),"bundledVersion":VERSION,"activeVersion":active})
}
#[tauri::command]
pub async fn music_diagnostics()->Reply{Ok(json!({"engine":engine_diagnostics(),"events":diagnostics::snapshot()}))}
#[tauri::command]
pub async fn export_music_diagnostics(app:tauri::AppHandle,window:tauri::WebviewWindow,events:Vec<diagnostics::Event>)->Result<bool,String>{
    use tauri_plugin_dialog::DialogExt;
    if window.label()!="main"{return Err("Invalid playback report.".into());}
    let report=diagnostics::report(events,engine_diagnostics())?;
    tauri::async_runtime::spawn_blocking(move||{
        let Some(file)=app.dialog().file().add_filter("Playback report",&["txt"]).set_file_name("devil-music-playback-report.txt").blocking_save_file()else{return Ok(false);};
        let path=file.into_path().map_err(|_|"Choose a local folder.")?;let parent=path.parent().ok_or("Choose a local folder.")?;
        let mut temporary=tempfile::NamedTempFile::new_in(parent).map_err(|_|"Could not save playback report.")?;
        temporary.write_all(report.as_bytes()).and_then(|_|temporary.as_file().sync_all()).map_err(|_|"Could not save playback report.")?;
        temporary.persist(path).map_err(|_|"Could not save playback report.")?;Ok(true)
    }).await.map_err(|_|"Could not save playback report.".to_owned())?
}
fn update()->Reply{
    let _=rustls::crypto::ring::default_provider().install_default();
    let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Could not check music engine update")?;
    let response=client.get(FEED).send().map_err(|_|"Could not check music engine update")?;
    if response.status().as_u16()==404{return Ok(json!({"status":"unpublished"}));}if !response.status().is_success(){return Err("Could not check music engine update".into());}
    let mut envelope=Vec::new();response.take(6*1024*1024+1).read_to_end(&mut envelope).map_err(|_|"Could not download music engine update")?;
    let bytes=verified(&envelope)?;let version=unpack(&bytes)?["version"].as_u64().unwrap();let root=root()?;let mut current=VERSION;
    if let Ok(saved)=fs::read(root.join("update.json")){if let Ok(bytes)=verified(&saved){current=current.max(unpack(&bytes)?["version"].as_u64().unwrap());}}
    if version<=current{return Ok(json!({"status":"current"}));}
    fs::create_dir_all(&root).map_err(|_|"Could not save music engine update")?;
    let mut temp=tempfile::NamedTempFile::new_in(&root).map_err(|_|"Could not save music engine update")?;temp.write_all(&envelope).map_err(|_|"Could not save music engine update")?;temp.as_file().sync_all().map_err(|_|"Could not save music engine update")?;
    if root.join("update.json").exists(){fs::copy(root.join("update.json"),root.join("previous-update.json")).map_err(|_|"Could not preserve previous music engine")?;}
    temp.persist(root.join("update.json")).map_err(|_|"Could not save music engine update")?;
    Ok(json!({"status":"staged","version":version}))
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn source_restrictions_do_not_trigger_legacy_retry(){
        assert!(restricted_error("Playback restricted: YouTube requires sign-in or verification. Try another track."));
        assert!(restricted_error("Playback temporarily limited by YouTube. Wait before trying again."));
        assert!(restricted_error("Playback unavailable or temporarily limited"));
        assert!(!restricted_error("Opening audio timed out"));
    }
    #[test]fn bundled_engine_is_complete_and_bounded(){let data=unpack(EMBEDDED).unwrap();assert_eq!(data["version"],VERSION);assert!(unpack(&vec![0;4*1024*1024+1]).is_err());}
    #[test]fn unsigned_updates_are_rejected(){assert!(verified(br#"{"payload":"e30=","signature":"eA=="}"#).is_err());}
    #[test]fn signed_updates_reject_tampering_and_untrusted_keys(){
        let fixture:Value=serde_json::from_str(include_str!("../../engines/music/fixtures/signed-update.json")).unwrap();
        let envelope=serde_json::to_vec(&fixture["envelope"]).unwrap();let key=fixture["publicKey"].as_str().unwrap();
        assert_eq!(unpack(&verified_by(&envelope,key).unwrap()).unwrap()["version"],2);
        assert!(verified(&envelope).is_err());
        let mut modified=fixture["envelope"].clone();modified["payload"]=json!(base64::engine::general_purpose::STANDARD.encode(b"modified"));
        assert!(verified_by(&serde_json::to_vec(&modified).unwrap(),key).is_err());
    }
    #[test]fn installed_engine_restores_modified_code(){let root=tempfile::tempdir().unwrap();let(path,_)=install(root.path(),EMBEDDED).unwrap();fs::write(path.join("engine.mjs"),"untrusted").unwrap();install(root.path(),EMBEDDED).unwrap();assert_ne!(fs::read_to_string(path.join("engine.mjs")).unwrap(),"untrusted");}
}
