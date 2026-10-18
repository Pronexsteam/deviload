//! Bounded diagnostic facts, never arbitrary subprocess text or media data.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::VecDeque,io::Read,sync::{Mutex,OnceLock},time::{SystemTime,UNIX_EPOCH}};

const MAX_EVENTS:usize=120;
const MAX_AGE:u64=2*60*60*1000;
static EVENTS:OnceLock<Mutex<VecDeque<Event>>>=OnceLock::new();
#[derive(Clone,Copy,Debug,Deserialize,Serialize,PartialEq)]
#[serde(rename_all="snake_case")]
pub enum Stage{Worker,Resolve,Preload,Fallback,Continuation,Cache,Update,Source,Start,Playing,Buffering,Recovery,Pause,Cancelled}
#[derive(Clone,Copy,Debug,Deserialize,Serialize,PartialEq)]
#[serde(rename_all="snake_case")]
pub enum Code{Requested,Ready,Success,Cancelled,Timeout,Restricted,Limited,Network,Decode,Unsupported,WorkerStopped,Busy,InvalidResponse,Permission,Unavailable,Output,Failed,Offline,Remote}
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Event{pub at:u64,pub stage:Stage,pub code:Code,#[serde(default,skip_serializing_if="Option::is_none")]pub elapsed_ms:Option<u64>}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64}
fn recent(events:&mut VecDeque<Event>,at:u64){while events.front().is_some_and(|event|event.at<at.saturating_sub(MAX_AGE)){events.pop_front();}}
pub fn record(stage:Stage,code:Code,elapsed_ms:Option<u64>){
    let at=now();let mut events=EVENTS.get_or_init(||Mutex::new(VecDeque::new())).lock().unwrap();recent(&mut events,at);
    if events.back().is_some_and(|previous|previous.stage==stage&&previous.code==code&&at.saturating_sub(previous.at)<1000){return;}
    events.push_back(Event{at,stage,code,elapsed_ms:elapsed_ms.map(|value|value.min(300000))});while events.len()>MAX_EVENTS{events.pop_front();}
}
pub fn classify(message:&str)->Code{
    let text:String=message.chars().take(1000).flat_map(char::to_lowercase).collect();
    if ["abort","cancel","superseded"].iter().any(|value|text.contains(value)){Code::Cancelled}
    else if ["429","rate limit","temporarily limit"].iter().any(|value|text.contains(value)){Code::Limited}
    else if ["403","restricted","sign in","not a bot","login_required","unplayable","age_check"].iter().any(|value|text.contains(value)){Code::Restricted}
    else if ["timeout","timed out","did not start in time"].iter().any(|value|text.contains(value)){Code::Timeout}
    else if text.contains("busy"){Code::Busy}
    else if ["engine stopped","engine did not start","could not start music engine"].iter().any(|value|text.contains(value)){Code::WorkerStopped}
    else if ["network","fetch","connect","offline","dns","socket"].iter().any(|value|text.contains(value)){Code::Network}
    else if text.contains("decode"){Code::Decode}
    else if ["unsupported","not supported"].iter().any(|value|text.contains(value)){Code::Unsupported}
    else if text.contains("permission"){Code::Permission}
    else if text.contains("invalid music engine response"){Code::InvalidResponse}
    else {Code::Failed}
}
pub fn result(stage:Stage,result:&Result<impl Sized,String>,elapsed_ms:Option<u64>){record(stage,result.as_ref().map(|_|Code::Success).unwrap_or_else(|error|classify(error)),elapsed_ms);}
pub fn protocol(value:&Value)->bool{
    if value["event"]!="diagnostic"{return false;}
    // The signed/bundled worker currently reports continuation failures without
    // a request key. Never retain its id, error text, or extra payload fields.
    if value["stage"]=="continuation"{record(Stage::Continuation,classify(value["error"].as_str().unwrap_or("")),None);}
    true
}
pub fn drain_stderr(mut reader:impl Read){
    // Always drain the pipe so verbose workers cannot block. At most 512 bytes
    // from one line are examined; nothing from the line is retained in reports.
    let mut chunk=[0u8;2048];let mut line=Vec::with_capacity(512);
    loop{match reader.read(&mut chunk){Ok(0)|Err(_)=>break,Ok(size)=>for byte in &chunk[..size]{
        if *byte==b'\n'{stderr_line(&line);line.clear();}else if line.len()<512{line.push(*byte);}
    }}}
    if !line.is_empty(){stderr_line(&line);}
}
fn stderr_line(line:&[u8]){if line.is_empty(){return;}let code=classify(&String::from_utf8_lossy(line));record(Stage::Worker,if code==Code::Failed{Code::Output}else{code},None);}
pub fn snapshot()->Vec<Event>{let mut events=EVENTS.get_or_init(||Mutex::new(VecDeque::new())).lock().unwrap();recent(&mut events,now());events.iter().cloned().collect()}
pub fn report(mut client:Vec<Event>,engine:Value)->Result<String,String>{
    if client.len()>80{return Err("Invalid playback report.".into());}
    let at=now();client.retain(|event|event.at>=at.saturating_sub(MAX_AGE)&&event.at<=at.saturating_add(60000));
    for event in &mut client{event.elapsed_ms=event.elapsed_ms.map(|value|value.min(300000));}
    let data=json!({"format":"devil-music-diagnostics","version":1,"appVersion":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"generatedAt":at,"engine":engine,"engineEvents":snapshot(),"playbackEvents":client});
    let mut text=String::from("Devil Music playback report\n\nContains recent playback stages, error categories, timing, app version and platform.\nTrack names, track IDs, URLs, local paths, cookies and credentials are excluded.\nEvents are kept in memory for up to two hours and cleared when Deviload closes.\n\n");
    let mut timeline:Vec<&Value>=data["playbackEvents"].as_array().unwrap().iter().chain(data["engineEvents"].as_array().unwrap()).collect();timeline.sort_by_key(|event|event["at"].as_u64().unwrap_or_default());
    for event in timeline{
        let stage=event["stage"].as_str().unwrap_or("unknown");let code=event["code"].as_str().unwrap_or("unknown");
        text.push_str(&format!("{} | {} | {}\n",event["at"],stage_label(stage),code_label(code)));
    }
    text.push_str("\nStructured details:\n");text.push_str(&serde_json::to_string_pretty(&data).map_err(|_|"Could not prepare playback report.")?);
    if text.len()>64*1024{return Err("Invalid playback report.".into());}Ok(text)
}
fn stage_label(stage:&str)->&str{match stage{"worker"=>"Music engine","resolve"=>"Finding audio","preload"=>"Preparing next track","fallback"=>"Trying reserve source","continuation"=>"Continuing audio stream","cache"=>"Audio cache","update"=>"Engine update","source"=>"Selecting audio source","start"=>"Starting decoder","playing"=>"Audio playing","buffering"=>"Waiting for audio","recovery"=>"Recovering playback","pause"=>"Paused","cancelled"=>"Cancelled",_=>"Playback"}}
fn code_label(code:&str)->&str{match code{"requested"=>"Started","ready"=>"Ready","success"=>"Completed","cancelled"=>"Cancelled","timeout"=>"Timed out","restricted"=>"Source denied access or requires verification","limited"=>"Source temporarily rate limited","network"=>"Connection failed","decode"=>"Audio decoding failed","unsupported"=>"Audio format unsupported","worker_stopped"=>"Music engine stopped or did not start","busy"=>"Music engine busy","invalid_response"=>"Unexpected engine response","permission"=>"Permission denied","unavailable"=>"Unavailable","output"=>"Engine emitted diagnostic output","failed"=>"Operation failed","offline"=>"Using downloaded audio","remote"=>"Using remote audio",_=>"Playback event"}}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn errors_and_untrusted_protocol_fields_never_enter_report(){
        let secret="https://audio.example/?token=private C:\\Users\\Sam\\secret.mp3 cookie=super-secret";
        assert_eq!(classify(secret),Code::Failed);
        assert!(protocol(&json!({"event":"diagnostic","stage":"continuation","id":secret,"error":format!("network failed {secret}"),"payload":secret})));
        let report=report(vec![Event{at:now(),stage:Stage::Resolve,code:Code::Network,elapsed_ms:None}],json!({"running":false,"bundledVersion":1})).unwrap();
        for value in ["private","Users","secret.mp3","super-secret","audio.example"]{assert!(!report.contains(value));}
        assert!(report.contains("Connection failed"));
    }
    #[test]fn diagnostic_ring_and_stderr_are_bounded(){
        for _ in 0..200{record(Stage::Resolve,Code::Requested,None);record(Stage::Resolve,Code::Success,Some(u64::MAX));}
        drain_stderr(std::io::Cursor::new(vec![b'x';2*1024*1024]));
        let events=snapshot();assert!(events.len()<=MAX_EVENTS);assert!(events.iter().all(|event|event.elapsed_ms.is_none_or(|value|value<=300000)));
        assert!(report(vec![Event{at:now(),stage:Stage::Source,code:Code::Requested,elapsed_ms:None};81],json!({})).is_err());
    }
    #[test]fn client_events_reject_payload_fields_and_unrecognized_codes(){
        assert!(serde_json::from_value::<Event>(json!({"at":0,"stage":"source","code":"failed","url":"secret"})).is_err());
        assert!(serde_json::from_value::<Event>(json!({"at":0,"stage":"source","code":"token=secret"})).is_err());
        for (text,code) in [("HTTP 429",Code::Limited),("Playback restricted: sign in",Code::Restricted),("Music engine timed out",Code::Timeout),("Connection refused",Code::Network),("Permission denied",Code::Permission)]{assert_eq!(classify(text),code);}
    }
}
