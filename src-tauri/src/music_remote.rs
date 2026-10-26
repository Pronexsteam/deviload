//! An opt-in LAN music controller. Independent from file sharing and its token.
use crate::music_mini::{MiniState, sanitize};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap,VecDeque},io::{Read,Write},net::{TcpListener,TcpStream},sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}},thread,time::{Duration,Instant}};
use tauri::Emitter;

#[derive(Clone,Default,Serialize,Deserialize)]
pub struct RemoteState { pub player:MiniState, #[serde(default)] pub labels:HashMap<String,String>, #[serde(default)] pub lang:String }
struct Session { token:String, authority:String, snapshot:RemoteState, seen:Instant, connected:bool, commands:VecDeque<String> }
struct Hub { session:Mutex<Session>, stopped:AtomicBool }
static HUB:OnceLock<Mutex<Option<Arc<Hub>>>>=OnceLock::new();
fn slot()-> &'static Mutex<Option<Arc<Hub>>> {HUB.get_or_init(||Mutex::new(None))}
#[derive(Serialize)]
pub struct RemoteStatus { url:String, connected:bool }
fn active(hub:&Hub)->bool {!hub.stopped.load(Ordering::Relaxed)&&hub.session.lock().unwrap().seen.elapsed()<Duration::from_secs(1800)}
fn status(hub:&Hub)->RemoteStatus {let s=hub.session.lock().unwrap();RemoteStatus{url:format!("http://{}/#{}",s.authority,s.token),connected:s.connected&&s.seen.elapsed()<Duration::from_secs(5)}}
fn checked(mut s:RemoteState)->RemoteState {s.player=sanitize(s.player);s.lang=if matches!(s.lang.as_str(),"ru"|"es"){s.lang}else{"en".into()};s.labels.retain(|k,v|k.len()<40&&v.chars().count()<=240);if s.labels.len()>32{s.labels.clear();}s}
#[tauri::command]
pub fn music_remote_start(app:tauri::AppHandle,window:tauri::WebviewWindow,state:RemoteState)->Result<RemoteStatus,String>{
 if window.label()!="main"{return Err("Unavailable window".into());}
 let mut stored=slot().lock().unwrap();
 if let Some(hub)=stored.as_ref().filter(|h|active(h)){hub.session.lock().unwrap().snapshot=checked(state);return Ok(status(hub));}
 if let Some(old)=stored.take(){old.stopped.store(true,Ordering::Relaxed);}
 let ip=crate::share::lan_address()?;
 let listener=TcpListener::bind((ip,0)).map_err(|e|e.to_string())?;
 listener.set_nonblocking(true).map_err(|e|e.to_string())?;
 let authority=listener.local_addr().map_err(|e|e.to_string())?.to_string();
 let mut bytes=[0u8;32];rand::rng().fill_bytes(&mut bytes);let token=bytes.iter().map(|b|format!("{b:02x}")).collect();
 let hub=Arc::new(Hub{session:Mutex::new(Session{token,authority,snapshot:checked(state),seen:Instant::now(),connected:false,commands:VecDeque::new()}),stopped:AtomicBool::new(false)});
 let worker=hub.clone();thread::spawn(move||{
  // Bounded, sequential requests; slow clients cannot accumulate worker threads.
  while active(&worker){match listener.accept(){Ok((stream,_))=>{let _=serve(stream,&worker,&|action,value|{
   if matches!(action,"volume"|"seek"){app.emit_to("main","music-mini-adjust",serde_json::json!({"action":action,"value":value})).map_err(|e|e.to_string())}
   else{app.emit_to("main","music-control",action).map_err(|e|e.to_string())}
  });},Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(30)),Err(_)=>break}}
  worker.stopped.store(true,Ordering::Relaxed);
 });
 let result=status(&hub);*stored=Some(hub);Ok(result)
}
#[tauri::command]
pub fn music_remote_update(window:tauri::WebviewWindow,state:RemoteState)->Result<Option<RemoteStatus>,String>{
 if window.label()!="main"{return Err("Unavailable window".into());}
 Ok(slot().lock().unwrap().as_ref().filter(|h|active(h)).map(|h|{h.session.lock().unwrap().snapshot=checked(state);status(h)}))
}
#[tauri::command]
pub fn music_remote_stop(window:tauri::WebviewWindow)->Result<(),String>{
 if window.label()!="main"{return Err("Unavailable window".into());}if let Some(h)=slot().lock().unwrap().take(){h.stopped.store(true,Ordering::Relaxed);}Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Action { id:String, action:String, value:Option<f64> }
fn valid_action(a:&Action)->bool { !a.id.is_empty()&&a.id.len()<=80&&match a.action.as_str(){"previous"|"play"|"next"|"repeat"|"shuffle"|"mute"=>a.value.is_none(),"volume"|"seek"=>a.value.is_some_and(|v|v.is_finite()&&(0.0..=1.0).contains(&v)),_=>false} }
struct Request { method:String,path:String,headers:HashMap<String,String>,body:Vec<u8> }
fn read_request(stream:&mut TcpStream)->std::io::Result<Request>{
 let start=Instant::now();let mut bytes=Vec::new();let mut byte=[0];
 while !bytes.ends_with(b"\r\n\r\n") {if bytes.len()>=8192||start.elapsed()>Duration::from_secs(2){return Err(std::io::ErrorKind::InvalidData.into());}stream.read_exact(&mut byte)?;bytes.push(byte[0]);}
 let text=std::str::from_utf8(&bytes).map_err(|_|std::io::ErrorKind::InvalidData)?;let mut lines=text.split("\r\n");let parts:Vec<_>=lines.next().unwrap_or("").split_whitespace().collect();
 if parts.len()!=3||parts[2]!="HTTP/1.1"{return Err(std::io::ErrorKind::InvalidData.into());}
 let (method,path)=(parts[0].to_string(),parts[1].to_string());let mut headers=HashMap::new();
 for line in lines.filter(|l|!l.is_empty()){let(k,v)=line.split_once(':').ok_or(std::io::ErrorKind::InvalidData)?;if headers.insert(k.trim().to_ascii_lowercase(),v.trim().to_string()).is_some(){return Err(std::io::ErrorKind::InvalidData.into());}}
 if headers.contains_key("transfer-encoding"){return Err(std::io::ErrorKind::InvalidData.into());}
 let length=headers.get("content-length").map(|v|v.parse::<usize>()).transpose().map_err(|_|std::io::ErrorKind::InvalidData)?.unwrap_or(0);
 if length>1024{return Err(std::io::ErrorKind::InvalidData.into());}let mut body=vec![0;length];stream.read_exact(&mut body)?;Ok(Request{method,path,headers,body})
}
fn response(stream:&mut TcpStream,code:u16,kind:&str,body:&[u8])->std::io::Result<()>{
 write!(stream,"HTTP/1.1 {code} Response\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.ytimg.com https://lh3.googleusercontent.com https://yt3.googleusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n\r\n",body.len())?;stream.write_all(body)
}
fn serve(mut stream:TcpStream,hub:&Hub,emit:&dyn Fn(&str,Option<f64>)->Result<(),String>)->std::io::Result<()>{
 stream.set_read_timeout(Some(Duration::from_secs(1)))?;stream.set_write_timeout(Some(Duration::from_secs(1)))?;
 let r=match read_request(&mut stream){Ok(r)=>r,Err(_)=>return response(&mut stream,400,"text/plain",b"Invalid request")};
 if !active(hub){return response(&mut stream,410,"text/plain",b"Remote stopped");}
 let mut s=hub.session.lock().unwrap();let origin=format!("http://{}",s.authority);
 if r.headers.get("host")!=Some(&s.authority)||r.headers.get("origin").is_some_and(|o|o!=&origin){return response(&mut stream,403,"text/plain",b"Forbidden");}
 let asset:Option<(&str,&[u8])>=match r.path.as_str(){
 "/"=>Some(("text/html; charset=utf-8",include_bytes!("../../src/music-remote.html"))),
 "/music-remote.js"=>Some(("text/javascript",include_bytes!("../../src/music-remote.js"))),
 "/music-remote.css"=>Some(("text/css",include_bytes!("../../src/music-remote.css"))),
 "/theme-colors.css"=>Some(("text/css",include_bytes!("../../src/theme-colors.css"))),
 "/themes.css"=>Some(("text/css",include_bytes!("../../src/themes.css"))),
 "/assets/music-vinyl.png"=>Some(("image/png",include_bytes!("../../src/assets/music-vinyl.png"))),
 _=>None};
 if let Some((kind,body))=asset{if r.method=="GET"{return response(&mut stream,200,kind,body);}}
 if r.headers.get("x-remote-token")!=Some(&s.token){return response(&mut stream,403,"text/plain",b"Forbidden");}
 if r.method=="GET"&&r.path=="/state"{s.seen=Instant::now();s.connected=true;return response(&mut stream,200,"application/json",&serde_json::to_vec(&s.snapshot)?);}
 if r.method=="POST"&&r.path=="/action"{
  if r.headers.get("origin")!=Some(&origin)||r.headers.get("content-type").map(String::as_str)!=Some("application/json"){return response(&mut stream,403,"text/plain",b"Forbidden");}
  let a=match serde_json::from_slice::<Action>(&r.body){Ok(a) if valid_action(&a)=>a,_=>return response(&mut stream,400,"text/plain",b"Invalid action")};
  if !s.commands.contains(&a.id){if emit(&a.action,a.value).is_err(){return response(&mut stream,503,"text/plain",b"Unavailable");}s.commands.push_back(a.id);if s.commands.len()>64{s.commands.pop_front();}}
  s.seen=Instant::now();s.connected=true;return response(&mut stream,200,"application/json",b"{}");
 }
 response(&mut stream,404,"text/plain",b"Not found")
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn commands_are_bounded_and_cannot_launch_or_access_files(){
  for action in ["play","next","previous","shuffle","repeat","mute"]{assert!(valid_action(&Action{id:"1".into(),action:action.into(),value:None}));}
  for (action,value) in [("volume",Some(1.1)),("seek",Some(-1.0)),("volume",Some(f64::NAN)),("close",None),("download",None)]{assert!(!valid_action(&Action{id:"1".into(),action:action.into(),value}));}
 }
 #[test]fn http_auth_origin_revocation_and_duplicate_commands(){
  let hub=Arc::new(Hub{session:Mutex::new(Session{token:"test-token".into(),authority:"127.0.0.1:12345".into(),snapshot:RemoteState::default(),seen:Instant::now(),connected:false,commands:VecDeque::new()}),stopped:AtomicBool::new(false)});
  let count=Arc::new(Mutex::new(0));
  let request=|method:&str,path:&str,headers:&str,body:&str|{let listener=TcpListener::bind("127.0.0.1:0").unwrap();let mut client=TcpStream::connect(listener.local_addr().unwrap()).unwrap();let h=hub.clone();let count=count.clone();let worker=thread::spawn(move||{serve(listener.accept().unwrap().0,&h,&|_,_|{*count.lock().unwrap()+=1;Ok(())}).unwrap();});write!(client,"{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:12345\r\nContent-Length: {}\r\n{headers}\r\n{body}",body.len()).unwrap();let mut out=String::new();client.read_to_string(&mut out).unwrap();worker.join().unwrap();out};
  assert!(request("GET","/state","","").contains("403"));
  assert!(request("GET","/state","X-Remote-Token: test-token\r\n","").contains("200"));
  let action=r#"{"id":"first","action":"play","value":null}"#;
  assert!(request("POST","/action","X-Remote-Token: test-token\r\nOrigin: http://evil.test\r\nContent-Type: application/json\r\n",action).contains("403"));
  let headers="X-Remote-Token: test-token\r\nOrigin: http://127.0.0.1:12345\r\nContent-Type: application/json\r\n";
  for _ in 0..2{assert!(request("POST","/action",headers,action).contains("200"));}assert_eq!(*count.lock().unwrap(),1);
  assert!(request("GET","/../../private",headers,"").contains("404"));
  hub.stopped.store(true,Ordering::Relaxed);assert!(request("GET","/state",headers,"").contains("410"));
 }
}
