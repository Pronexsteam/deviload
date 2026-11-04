//! Bounded diagnostic facts, never arbitrary subprocess text or media data.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::VecDeque,io::Read,sync::{Mutex,OnceLock},time::{SystemTime,UNIX_EPOCH}};

const MAX_EVENTS:usize=120;
const MAX_STDERR_EVENTS:usize=16;
const MAX_AGE:u64=2*60*60*1000;
static EVENTS:OnceLock<Mutex<VecDeque<Event>>>=OnceLock::new();
static STDERR_EVENTS:OnceLock<Mutex<VecDeque<Event>>>=OnceLock::new();
#[derive(Clone,Copy,Debug,Deserialize,Serialize,PartialEq)]
#[serde(rename_all="snake_case")]
pub enum Stage{Worker,Resolve,Preload,Fallback,Continuation,Cache,Update,Source,Start,Playing,Buffering,Recovery,Pause,Cancelled,DirectFull,DirectPrefix,Sabr,ReserveStream,CachedAudio}
#[derive(Clone,Copy,Debug,Deserialize,Serialize,PartialEq)]
#[serde(rename_all="snake_case")]
pub enum Code{Requested,Ready,Success,Cancelled,Timeout,Restricted,Limited,Network,Decode,Unsupported,WorkerStopped,Busy,InvalidResponse,Permission,Unavailable,Output,Failed,Offline,Remote,Pending,VerificationRequired,VerificationRejected,ProtectionUnknown,
    #[serde(rename="http_200")] Http200,#[serde(rename="http_206")] Http206,Partial,PendingTimeout,PendingEof,PendingUpstreamError,PendingNoMedia,PendingDenied,PendingLimited,PendingCancelled}
impl Code {
    fn is_pending_outcome(self)->bool{
        matches!(self, Self::PendingTimeout | Self::PendingEof | Self::PendingUpstreamError |
            Self::PendingNoMedia | Self::PendingDenied | Self::PendingLimited | Self::PendingCancelled)
    }
}
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Event{pub at:u64,pub stage:Stage,pub code:Code,#[serde(default,skip_serializing_if="Option::is_none")]pub elapsed_ms:Option<u64>}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64}
fn recent(events:&mut VecDeque<Event>,at:u64){while events.front().is_some_and(|event|event.at<at.saturating_sub(MAX_AGE)){events.pop_front();}}
pub fn record(stage:Stage,code:Code,elapsed_ms:Option<u64>){
    push(&EVENTS,MAX_EVENTS,stage,code,elapsed_ms);
}
fn push(store:&OnceLock<Mutex<VecDeque<Event>>>,limit:usize,stage:Stage,code:Code,elapsed_ms:Option<u64>){
    let at=now();let mut events=store.get_or_init(||Mutex::new(VecDeque::new())).lock().unwrap();recent(&mut events,at);
    if events.back().is_some_and(|previous|previous.stage==stage&&previous.code==code&&at.saturating_sub(previous.at)<1000){return;}
    events.push_back(Event{at,stage,code,elapsed_ms:elapsed_ms.map(|value|value.min(300000))});while events.len()>limit{events.pop_front();}
}
pub fn classify(message:&str)->Code{
    let text:String=message.chars().take(1000).flat_map(char::to_lowercase).collect();
    if ["attestation pending","stream protection: pending","playback verification is pending"].iter().any(|value|text.contains(value)){Code::Pending}
    else if ["attestation rejected","stream protection: rejected","rejected stream verification"].iter().any(|value|text.contains(value)){Code::VerificationRejected}
    else if ["attestation required","stream protection: required","requires stream verification"].iter().any(|value|text.contains(value)){Code::VerificationRequired}
    else if text.contains("stream protection"){Code::ProtectionUnknown}
    else if ["abort","cancel","superseded"].iter().any(|value|text.contains(value)){Code::Cancelled}
    else if ["429","rate limit","temporarily limit"].iter().any(|value|text.contains(value)){Code::Limited}
    else if ["401","403","restricted","sign in","not a bot","login_required","unplayable","age_check","unavailable for guest playback"].iter().any(|value|text.contains(value)){Code::Restricted}
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
    // Fixed route facts only. Old signed engines may still send arbitrary continuation error text;
    // classify that text without retaining it. Media IDs/control messages are never exported.
    let code=serde_json::from_value::<Code>(value["code"].clone()).ok();
    if value["stage"]=="continuation"{record(Stage::Continuation,code.unwrap_or_else(||classify(value["error"].as_str().unwrap_or(""))),None);}
    if value["stage"]=="source_path" {
        let stage=match value["path"].as_str(){Some("direct_full")=>Some(Stage::DirectFull),Some("direct_prefix")=>Some(Stage::DirectPrefix),Some("sabr")=>Some(Stage::Sabr),Some("reserve")=>Some(Stage::ReserveStream),Some("cache")=>Some(Stage::CachedAudio),_=>None};
        if let (Some(stage),Some(code))=(stage,code){
            if stage==Stage::Sabr || !code.is_pending_outcome(){record(stage,code,None);}
        }
    }
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
fn stderr_line(line:&[u8]){
    let decoded=String::from_utf8_lossy(line);
    let message=decoded.trim_start();
    if message.trim().is_empty() || message.starts_with("at ") {return;}
    let code=classify(message);
    push(&STDERR_EVENTS,MAX_STDERR_EVENTS,Stage::Worker,if code==Code::Failed{Code::Output}else{code},None);
}
fn snapshot_from(engine:&mut VecDeque<Event>,stderr:&mut VecDeque<Event>,at:u64)->Vec<Event>{
    recent(engine,at);
    recent(stderr,at);
    let remaining=MAX_EVENTS.saturating_sub(engine.len());
    let mut merged:Vec<_>=engine.iter().chain(stderr.iter().skip(stderr.len().saturating_sub(remaining))).cloned().collect();
    merged.sort_by_key(|event|event.at);
    merged
}
pub fn snapshot()->Vec<Event>{
    let mut engine=EVENTS.get_or_init(||Mutex::new(VecDeque::new())).lock().unwrap();
    let mut stderr=STDERR_EVENTS.get_or_init(||Mutex::new(VecDeque::new())).lock().unwrap();
    snapshot_from(&mut engine,&mut stderr,now())
}
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
fn stage_label(stage:&str)->&str{match stage{"direct_full"=>"Continuous direct audio","direct_prefix"=>"Direct opening prefix","sabr"=>"SABR audio stream","reserve_stream"=>"yt-dlp reserve stream","cached_audio"=>"Completed audio cache","worker"=>"Music engine","resolve"=>"Finding audio","preload"=>"Preparing next track","fallback"=>"Trying reserve source","continuation"=>"Continuing audio stream","cache"=>"Audio cache","update"=>"Engine update","source"=>"Selecting audio source","start"=>"Starting decoder","playing"=>"Audio playing","buffering"=>"Waiting for audio","recovery"=>"Recovering playback","pause"=>"Paused","cancelled"=>"Cancelled",_=>"Playback"}}
fn code_label(code:&str)->&str{match code{
    "pending_timeout"=>"Verification deadline expired",
    "pending_eof"=>"Audio stream ended during verification",
    "pending_upstream_error"=>"Audio stream failed during verification",
    "http_200"=>"HTTP 200 audio response","http_206"=>"HTTP 206 audio response","partial"=>"Source returned fewer bytes than the full recording",
    "pending_no_media"=>"Transport reported no media or protocol updates during verification",
    "pending_denied"=>"Source denied playback during verification",
    "pending_limited"=>"Source rate limited playback during verification",
    "pending_cancelled"=>"Playback attempt cancelled during verification",
    "pending"=>"Stream verification pending; reserve blocked","verification_required"=>"Stream verification required; reserve blocked","verification_rejected"=>"Stream verification rejected; reserve blocked","protection_unknown"=>"Unknown stream protection; reserve blocked","requested"=>"Started","ready"=>"Ready","success"=>"Completed","cancelled"=>"Cancelled","timeout"=>"Timed out","restricted"=>"Source denied access or requires verification","limited"=>"Source temporarily rate limited","network"=>"Connection failed","decode"=>"Audio decoding failed","unsupported"=>"Audio format unsupported","worker_stopped"=>"Music engine stopped or did not start","busy"=>"Music engine busy","invalid_response"=>"Unexpected engine response","permission"=>"Permission denied","unavailable"=>"Unavailable","output"=>"Engine emitted diagnostic output","failed"=>"Operation failed","offline"=>"Using downloaded audio","remote"=>"Using remote audio",_=>"Playback event"}}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn repeated_stderr_cannot_displace_the_structured_cause(){
        let mut engine=VecDeque::new();
        engine.push_back(Event{at:2,stage:Stage::Sabr,code:Code::PendingNoMedia,elapsed_ms:None});
        for at in 3..(MAX_EVENTS as u64+2){engine.push_back(Event{at,stage:Stage::Resolve,code:Code::Requested,elapsed_ms:None});}
        let mut stderr=VecDeque::from(vec![Event{at:201,stage:Stage::Worker,code:Code::Network,elapsed_ms:None};MAX_STDERR_EVENTS]);
        let snapshot=snapshot_from(&mut engine,&mut stderr,201);
        assert_eq!(snapshot.len(),MAX_EVENTS);
        assert_eq!(snapshot[0].code,Code::PendingNoMedia);
    }
    #[test]fn worker_pending_outcomes_are_distinct_and_have_report_labels(){
        for name in ["pending_timeout","pending_eof","pending_upstream_error","pending_no_media","pending_denied","pending_limited","pending_cancelled"] {
            let code:Code=serde_json::from_value(json!(name)).unwrap();
            assert!(code.is_pending_outcome());
            assert_ne!(code_label(name),"Playback event");
        }
    }
    #[test]fn protection_causes_take_precedence_over_abort_and_timeout(){
        for (message,code) in [("attestation pending; Download aborted",Code::Pending),("attestation required; timeout",Code::VerificationRequired),("attestation rejected",Code::VerificationRejected),("unknown stream protection state",Code::ProtectionUnknown),("HTTP 401",Code::Restricted)]{assert_eq!(classify(message),code);}
    }
    #[test]fn source_routes_never_retain_payload_fields(){
        for path in ["direct_full","direct_prefix","sabr","reserve","cache"]{assert!(protocol(&json!({"event":"diagnostic","stage":"source_path","path":path,"code":"success","id":"private-video","url":"https://private/?token=secret","cookie":"secret"})));}
        let report=report(vec![],json!({"running":false})).unwrap();
        assert!(!report.contains("private-video"));assert!(!report.contains("https://private"));assert!(!report.contains("token=secret"));
    }
    #[test]fn continuous_stream_events_decode_the_worker_wire_names(){
        assert_eq!(serde_json::from_str::<Stage>(r#""direct_full""#).unwrap(),Stage::DirectFull);
        for (wire,expected) in [("http_200",Code::Http200),("http_206",Code::Http206),("partial",Code::Partial)]{
            assert_eq!(serde_json::from_value::<Code>(json!(wire)).unwrap(),expected);
            assert_ne!(code_label(wire),code_label("unknown"));
        }
    }
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
