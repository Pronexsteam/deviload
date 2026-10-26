//! Experimental, host-controlled listening rooms. Only track metadata and the
//! playback clock cross the tunnel; audio, files and library data never do.
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest,Sha256};
use std::{fs,io::{Read,Write,BufRead,BufReader},net::{TcpListener,TcpStream},path::{Path,PathBuf},process::{Child,Stdio},sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,AtomicU64,Ordering}},thread,time::{Duration,Instant}};

const DOWNLOAD:&str="https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe";
const CHECKSUM:&str="76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2";
const FAILURE: &str = "Could not connect the listening room. Try again or create a new room.";
#[derive(Clone,Default,Serialize,Deserialize)]
pub struct RoomState{#[serde(default)]pub id:String,#[serde(default)]pub title:String,#[serde(default)]pub artists:Vec<String>,#[serde(default)]pub image:String,#[serde(default)]pub position:f64,#[serde(default)]pub duration:f64,#[serde(default)]pub playing:bool}
fn checked(mut s:RoomState)->Result<RoomState,String>{
 if (!s.id.is_empty()&&(s.id.len()!=11||!s.id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')))||!s.position.is_finite()||!s.duration.is_finite(){return Err(FAILURE.into());}
 s.title=s.title.chars().take(240).collect();s.artists=s.artists.into_iter().take(4).map(|a|a.chars().take(80).collect()).collect();
 s.image=if s.image.len()<=256&&url::Url::parse(&s.image).is_ok_and(|u|u.scheme()=="https"&&matches!(u.host_str(),Some("i.ytimg.com"|"lh3.googleusercontent.com"|"yt3.googleusercontent.com"))){s.image}else{String::new()};
 s.position=s.position.clamp(0.,86400.);s.duration=s.duration.clamp(0.,86400.);if s.id.is_empty(){s.playing=false;}Ok(s)
}
struct Clock{state:RoomState,updated:Instant,guest:Option<Instant>}
struct Host{clock:Mutex<Clock>,token:String,stopped:AtomicBool,child:Mutex<Option<Child>>}
impl Host{fn stop(&self){self.stopped.store(true,Ordering::Relaxed);if let Some(mut child)=self.child.lock().unwrap().take(){let _=child.kill();let _=child.wait();}}}
static ROOM:OnceLock<Mutex<Option<Arc<Host>>>>=OnceLock::new();
static STARTING:Mutex<()>=Mutex::new(());
static GENERATION:AtomicU64=AtomicU64::new(0);
fn slot()-> &'static Mutex<Option<Arc<Host>>>{ROOM.get_or_init(||Mutex::new(None))}
pub fn stop(){GENERATION.fetch_add(1,Ordering::SeqCst);if let Some(host)=slot().lock().unwrap().take(){host.stop();}}
fn allowed(window:&tauri::WebviewWindow)->Result<(),String>{if window.label()=="main"{Ok(())}else{Err("Listening rooms are only available in the main window.".into())}}
fn client()->Result<reqwest::blocking::Client,String>{let _=rustls::crypto::ring::default_provider().install_default();reqwest::blocking::Client::builder().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|FAILURE.into())}
type DnsEntries=std::collections::HashMap<String,(Instant,Vec<std::net::SocketAddr>)>;
static ROOM_DNS:OnceLock<Mutex<DnsEntries>>=OnceLock::new();
fn room_request(url:&str,token:&str)->Result<reqwest::blocking::Response,String>{
 let _=rustls::crypto::ring::default_provider().install_default();
 let parsed=url::Url::parse(url).map_err(|_|FAILURE)?;let hostname=parsed.host_str().ok_or(FAILURE)?;
 let cache=ROOM_DNS.get_or_init(||Mutex::new(DnsEntries::new()));
 let cached=cache.lock().unwrap().get(hostname).filter(|(at,_)|at.elapsed()<Duration::from_secs(120)).map(|(_,addresses)|addresses.clone());
 let request=|addresses:Option<&[std::net::SocketAddr]>|{
  let mut builder=reqwest::blocking::Client::builder().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none());
  if let Some(addresses)=addresses{builder=builder.resolve_to_addrs(hostname,addresses);}
  builder.build()?.get(url).header("X-Room-Token",token).send()
 };
 match request(cached.as_deref()){
  Ok(response)=>return response.error_for_status().map_err(|_|FAILURE.into()),
  Err(error) if !error.is_connect()=>return Err(FAILURE.into()),
  Err(_)=>{}
 }
 // Some ISP resolvers negatively cache newly created Quick Tunnel names.
 // Ask the tunnel provider for this public host only; never change system DNS.
 let mut dns_url=url::Url::parse("https://1.1.1.1/dns-query").map_err(|_|FAILURE)?;dns_url.query_pairs_mut().append_pair("name",hostname).append_pair("type","A");
 let response=client()?.get(dns_url).header("Accept","application/dns-json").send().and_then(|r|r.error_for_status()).map_err(|_|FAILURE)?;
 let mut bytes=Vec::new();response.take(16385).read_to_end(&mut bytes).map_err(|_|FAILURE)?;if bytes.len()>16384{return Err(FAILURE.into());}
 let dns:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|FAILURE)?;
 let addresses:Vec<std::net::SocketAddr>=dns["Answer"].as_array().into_iter().flatten().filter(|answer|answer["type"]==1).filter_map(|answer|answer["data"].as_str()?.parse::<std::net::Ipv4Addr>().ok()).filter(|ip|{
  let o=ip.octets();!ip.is_private()&&!ip.is_loopback()&&!ip.is_link_local()&&!ip.is_unspecified()&&!ip.is_documentation()&&o[0]<224&&o[0]!=0&&!(o[0]==100&&(64..=127).contains(&o[1]))&&!(o[0]==198&&(18..=19).contains(&o[1]))
 }).take(8).map(|ip|std::net::SocketAddr::new(ip.into(),443)).collect();
 if addresses.is_empty(){return Err(FAILURE.into());}
 let response=request(Some(&addresses)).and_then(|r|r.error_for_status()).map_err(|_|FAILURE)?;
 let mut entries=cache.lock().unwrap();if entries.len()>=8{entries.clear();}entries.insert(hostname.into(),(Instant::now(),addresses));Ok(response)
}

fn helper(dir:&Path)->Result<PathBuf,String>{
 let _=rustls::crypto::ring::default_provider().install_default();
 if !cfg!(all(target_os="windows",target_arch="x86_64")){return Err("Internet room hosting is available in this Windows test build.".into());}
 let folder=dir.join("engines");fs::create_dir_all(&folder).map_err(|_|FAILURE)?;let path=folder.join("cloudflared-2026.10.3.exe");
 let verify=|path:&Path|->bool{fs::File::open(path).ok().and_then(|f|{let mut bytes=Vec::new();f.take(64*1024*1024+1).read_to_end(&mut bytes).ok()?;Some(bytes.len()<=64*1024*1024&&format!("{:x}",Sha256::digest(&bytes))==CHECKSUM)}).unwrap_or(false)};
 if path.is_file(){return if verify(&path){Ok(path)}else{Err("The room helper checksum did not match. Nothing was started.".into())};}
 let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(180)).build().map_err(|_|FAILURE)?;
 let response=client.get(DOWNLOAD).send().and_then(|r|r.error_for_status()).map_err(|_|"Could not download the room helper. Try again.")?;
 let mut bytes=Vec::new();response.take(64*1024*1024+1).read_to_end(&mut bytes).map_err(|_|FAILURE)?;
 if bytes.len()>64*1024*1024||format!("{:x}",Sha256::digest(&bytes))!=CHECKSUM{return Err("The room helper checksum did not match. Nothing was started.".into());}
 let mut file=tempfile::NamedTempFile::new_in(&folder).map_err(|_|FAILURE)?;file.write_all(&bytes).map_err(|_|FAILURE)?;file.as_file().sync_all().map_err(|_|FAILURE)?;
 file.persist_noclobber(&path).map_err(|_|FAILURE)?;Ok(path)
}
#[derive(Serialize,Deserialize)]
pub struct Packet{pub state:RoomState,pub age_ms:u64,#[serde(default)]pub transport_ms:u64}
#[derive(Serialize)]
pub struct HostStatus{connected:bool}
fn response(stream:&mut TcpStream,code:u16,body:&[u8])->std::io::Result<()>{write!(stream,"HTTP/1.1 {code} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n",body.len())?;stream.write_all(body)}
fn serve(mut stream:TcpStream,host:&Host)->std::io::Result<()>{
 stream.set_read_timeout(Some(Duration::from_secs(1)))?;stream.set_write_timeout(Some(Duration::from_secs(1)))?;
 let mut bytes=Vec::new();let mut byte=[0];let started=Instant::now();
 while !bytes.ends_with(b"\r\n\r\n"){if bytes.len()>=8192||started.elapsed()>Duration::from_secs(2){return response(&mut stream,400,b"{}");}stream.read_exact(&mut byte)?;bytes.push(byte[0]);}
 let text=String::from_utf8_lossy(&bytes);let mut lines=text.split("\r\n");if lines.next()!=Some("GET /state HTTP/1.1"){return response(&mut stream,404,b"{}");}
 let mut token=None;for line in lines{if let Some((key,value))=line.split_once(':'){if key.eq_ignore_ascii_case("x-room-token"){if token.is_some(){return response(&mut stream,403,b"{}");}token=Some(value.trim());}}}
 if token!=Some(host.token.as_str()){return response(&mut stream,403,b"{}");}
 let mut clock=host.clock.lock().unwrap();if host.stopped.load(Ordering::Relaxed)||clock.updated.elapsed()>Duration::from_secs(30){return response(&mut stream,410,b"{}");}
 clock.guest=Some(Instant::now());let packet=Packet{state:clock.state.clone(),age_ms:clock.updated.elapsed().as_millis() as u64,transport_ms:0};
 response(&mut stream,200,&serde_json::to_vec(&packet)?)
}
fn connection(link:&str)->Result<(String,String),String>{
 let url=url::Url::parse(link).map_err(|_|FAILURE)?;let host=url.host_str().unwrap_or("");let prefix=host.strip_suffix(".trycloudflare.com").unwrap_or("");
 let token=url.fragment().unwrap_or("");
 if url.scheme()!="https"||prefix.is_empty()||prefix.len()>63||!prefix.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')||!url.username().is_empty()||url.password().is_some()||url.port().is_some()||url.path()!="/"||url.query().is_some()||token.len()!=64||!token.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Paste the full listening room link, including its invitation code.".into());}
 Ok((format!("https://{host}/state"),token.into()))
}
fn start_host(dir:&Path,state:RoomState)->Result<String,String>{
  let _guard=STARTING.try_lock().map_err(|_|FAILURE)?;stop();let generation=GENERATION.load(Ordering::SeqCst);let exe=helper(dir)?;
  if generation!=GENERATION.load(Ordering::SeqCst){return Err(FAILURE.into());}
  let listener=TcpListener::bind("127.0.0.1:0").map_err(|_|FAILURE)?;listener.set_nonblocking(true).map_err(|_|FAILURE)?;let address=listener.local_addr().map_err(|_|FAILURE)?;
  let mut random=[0;32];rand::rng().fill_bytes(&mut random);let token:String=random.iter().map(|b|format!("{b:02x}")).collect();
  let mut child=crate::command(&exe).args(["tunnel","--no-autoupdate","--url",&format!("http://{address}"),"--protocol","http2"]).stdout(Stdio::null()).stderr(Stdio::piped()).stdin(Stdio::null()).spawn().map_err(|_|FAILURE)?;
  let stderr=child.stderr.take().ok_or(FAILURE)?;let (tx,rx)=std::sync::mpsc::channel();
  thread::spawn(move||{for line in BufReader::new(stderr).lines().map_while(Result::ok){for word in line.split_whitespace(){let candidate=word.trim_matches(|c:char|!c.is_ascii_alphanumeric()&&c!=':'&&c!='/'&&c!='.'&&c!='-');if candidate.starts_with("https://")&&candidate.ends_with(".trycloudflare.com"){let _=tx.send(candidate.to_string());}}}});
  let host=Arc::new(Host{clock:Mutex::new(Clock{state,updated:Instant::now(),guest:None}),token,stopped:AtomicBool::new(false),child:Mutex::new(Some(child))});
  *slot().lock().unwrap()=Some(host.clone());let worker=host.clone();
  thread::spawn(move||{while !worker.stopped.load(Ordering::Relaxed){if worker.clock.lock().unwrap().updated.elapsed()>Duration::from_secs(90){break;}match listener.accept(){Ok((stream,_))=>{let _=serve(stream,&worker);},Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(20)),Err(_)=>break}}worker.stop();});
  match rx.recv_timeout(Duration::from_secs(50)){Ok(url)=>{let link=format!("{url}/#{}",host.token);if connection(&link).is_err()||generation!=GENERATION.load(Ordering::SeqCst){host.stop();return Err(FAILURE.into());}host.clock.lock().unwrap().updated=Instant::now();Ok(link)},Err(_)=>{host.stop();Err(FAILURE.into())}}
}
#[tauri::command]
pub async fn music_room_create(window:tauri::WebviewWindow,engine:tauri::State<'_,crate::Engine>,state:RoomState)->Result<String,String>{
 allowed(&window)?;let state=checked(state)?;let dir=engine.dir.clone();
 tauri::async_runtime::spawn_blocking(move||{
  start_host(&dir,state)
 }).await.map_err(|_|FAILURE)?
}
#[tauri::command]
pub fn music_room_update(window:tauri::WebviewWindow,state:RoomState)->Result<HostStatus,String>{
 allowed(&window)?;let state=checked(state)?;let stored=slot().lock().unwrap();let host=stored.as_ref().filter(|h|!h.stopped.load(Ordering::Relaxed)).ok_or(FAILURE)?;let mut clock=host.clock.lock().unwrap();clock.state=state;clock.updated=Instant::now();Ok(HostStatus{connected:clock.guest.is_some_and(|at|at.elapsed()<Duration::from_secs(5))})
}
#[tauri::command]
pub fn music_room_stop(window:tauri::WebviewWindow)->Result<(),String>{allowed(&window)?;stop();Ok(())}
#[tauri::command]
pub async fn music_room_poll(window:tauri::WebviewWindow,link:String)->Result<Packet,String>{
 allowed(&window)?;let (url,token)=connection(&link)?;
 tauri::async_runtime::spawn_blocking(move||{let start=Instant::now();let response=room_request(&url,&token)?;let mut bytes=Vec::new();response.take(16385).read_to_end(&mut bytes).map_err(|_|FAILURE)?;if bytes.len()>16384{return Err(FAILURE.into());}let mut packet:Packet=serde_json::from_slice(&bytes).map_err(|_|FAILURE)?;packet.state=checked(packet.state)?;packet.age_ms=packet.age_ms.min(30000);packet.transport_ms=(start.elapsed().as_millis() as u64/2).min(4000);Ok(packet)}).await.map_err(|_|FAILURE)?
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn room_links_cannot_access_local_files_private_services_or_redirect_targets(){
  let code="a".repeat(64);assert!(connection(&format!("https://one-two.trycloudflare.com/#{code}")).is_ok());
  for base in ["http://one.trycloudflare.com/","https://127.0.0.1/","file:///private","https://evil.test/","https://one.trycloudflare.com.evil.test/","https://user@one.trycloudflare.com/","https://one.trycloudflare.com/anything","https://one.trycloudflare.com/?x=1"]{assert!(connection(&format!("{base}#{code}")).is_err());}
  assert!(connection("https://one.trycloudflare.com/#short").is_err());
 }
 #[test]fn room_metadata_is_bounded_and_does_not_accept_arbitrary_artwork(){let s=checked(RoomState{title:"x".repeat(999),image:"file:///secret".into(),artists:vec!["a".repeat(100);20],position:-10.,duration:1e9,..Default::default()}).unwrap();assert_eq!(s.title.len(),240);assert_eq!(s.artists.len(),4);assert_eq!(s.image,"");assert!(!s.playing);assert_eq!(s.position,0.);assert_eq!(s.duration,86400.);assert!(checked(RoomState{position:f64::NAN,..Default::default()}).is_err());}
 #[test]fn listener_only_serves_authenticated_metadata(){
  let host=Arc::new(Host{clock:Mutex::new(Clock{state:RoomState::default(),updated:Instant::now(),guest:None}),token:"private".into(),stopped:AtomicBool::new(false),child:Mutex::new(None)});
  for(request,expected)in [("GET /state HTTP/1.1\r\nHost: localhost\r\n\r\n",403),("GET /state HTTP/1.1\r\nX-Room-Token: private\r\n\r\n",200),("POST /action HTTP/1.1\r\nX-Room-Token: private\r\n\r\n",404)]{
   let listener=TcpListener::bind("127.0.0.1:0").unwrap();let mut client=TcpStream::connect(listener.local_addr().unwrap()).unwrap();let h=host.clone();let thread=thread::spawn(move||serve(listener.accept().unwrap().0,&h).unwrap());client.write_all(request.as_bytes()).unwrap();let mut response=String::new();client.read_to_string(&mut response).unwrap();thread.join().unwrap();assert!(response.starts_with(&format!("HTTP/1.1 {expected}")));
  }
 }

 // Opt-in network smoke check: never contacts Cloudflare in the normal suite.
 #[test]fn live_tunnel_roundtrip_when_explicitly_requested(){
  let Some(dir)=std::env::var_os("DEVILOAD_ROOM_NETWORK_TEST") else{return;};
  struct Cleanup;impl Drop for Cleanup{fn drop(&mut self){stop();}}let _cleanup=Cleanup;
  let state=RoomState{id:"fixture0001".into(),title:"Room transport test".into(),position:12.,playing:true,..Default::default()};
  let link=start_host(Path::new(&dir),state).expect("start room");let (url,token)=connection(&link).unwrap();
  fs::write(Path::new(&dir).join("test-host.txt"),url::Url::parse(&url).unwrap().host_str().unwrap()).unwrap();
  let mut packet=None;
  for _ in 0..12{if let Ok(response)=room_request(&url,&token){eprintln!("room response {}",response.status());if response.status().is_success(){packet=response.json::<Packet>().ok();if packet.is_some(){break;}}}thread::sleep(Duration::from_secs(1));}
  if packet.is_none(){if let Err(error)=client().unwrap().get(&url).header("X-Room-Token",&token).send(){eprintln!("room network failure: {error}");}}
  let packet=packet.expect("read room through public tunnel");assert_eq!(packet.state.id,"fixture0001");assert_eq!(packet.state.position,12.);assert!(packet.state.playing);
  assert!(room_request(&url,"wrong-invitation").is_err());
 }
}
