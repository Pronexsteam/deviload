//! Static, isolated origin for the official YouTube player. No files, account
//! credentials, IPC or media URLs are exposed by this loopback-only service.
use rand::RngCore;
use std::{io::{Read,Write},net::{TcpListener,TcpStream},sync::{OnceLock,atomic::{AtomicUsize,Ordering}},time::Duration};
struct Bridge { port:u16, token:String }
static BRIDGE:OnceLock<Result<Bridge,String>>=OnceLock::new();
static CONNECTIONS:AtomicUsize=AtomicUsize::new(0);
const HTML:&str=include_str!("../../src/cinema-youtube.html");
const JS:&str=include_str!("../../src/cinema-youtube.js");
const CSS:&str=include_str!("../../src/cinema-youtube.css");
fn asset<'a>(path:&str,token:&str)->Option<(&'a str,&'a str)>{
 let suffix=path.strip_prefix(&format!("/{token}/"))?;
 match suffix {"index.html"=>Some(("text/html; charset=utf-8",HTML)),"player.js"=>Some(("text/javascript; charset=utf-8",JS)),"player.css"=>Some(("text/css; charset=utf-8",CSS)),_=>None}
}
fn serve(mut socket:TcpStream,port:u16,token:&str)->std::io::Result<()>{
 socket.set_read_timeout(Some(Duration::from_secs(2)))?;socket.set_write_timeout(Some(Duration::from_secs(2)))?;
 let mut request=Vec::new();let mut part=[0;1024];
 while request.len()<8192&&!request.windows(4).any(|w|w==b"\r\n\r\n") {let n=socket.read(&mut part)?;if n==0{return Ok(());}request.extend_from_slice(&part[..n]);}
 let text=String::from_utf8_lossy(&request);let mut lines=text.lines();let mut first=lines.next().unwrap_or("").split_whitespace();
 let method=first.next().unwrap_or("");let path=first.next().unwrap_or("");
 let host=lines.find_map(|line|line.split_once(':').filter(|(key,_)|key.eq_ignore_ascii_case("host")).map(|(_,v)|v.trim()));
 if request.len()>=8192||!request.windows(4).any(|w|w==b"\r\n\r\n")||host!=Some(format!("127.0.0.1:{port}").as_str())||!matches!(method,"GET"|"HEAD"){
  return write!(socket,"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
 }
 let Some((mime,body))=asset(path,token) else{return write!(socket,"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");};
 write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nContent-Security-Policy: default-src 'none'; script-src 'self' https://www.youtube.com; style-src 'self'; frame-src https://www.youtube.com; connect-src https://www.youtube.com; frame-ancestors http://tauri.localhost https://tauri.localhost tauri://localhost\r\nConnection: close\r\n\r\n",body.len())?;
 if method=="GET"{socket.write_all(body.as_bytes())?;}Ok(())
}
#[tauri::command]
pub fn cinema_open_youtube(id:String)->Result<(),String>{
 if id.len()!=11||!id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){return Err("Unavailable video".into());}
 crate::open_in_browser(&format!("https://www.youtube.com/watch?v={id}")).map_err(|_|"Could not open the video player.".into())
}
#[tauri::command]
pub fn cinema_embed()->Result<String,String>{
 let bridge=BRIDGE.get_or_init(||{
  let listener=TcpListener::bind("127.0.0.1:0").map_err(|_|"Could not open the video player.".to_owned())?;
  let port=listener.local_addr().map_err(|_|"Could not open the video player.")?.port();
  let mut key=[0u8;24];rand::rng().fill_bytes(&mut key);let token=key.iter().map(|b|format!("{b:02x}")).collect::<String>();let server_token=token.clone();
  std::thread::spawn(move||{for socket in listener.incoming().flatten(){
   if CONNECTIONS.fetch_add(1,Ordering::Relaxed)>=8 {CONNECTIONS.fetch_sub(1,Ordering::Relaxed);continue;}
   let token=server_token.clone();std::thread::spawn(move||{let _=serve(socket,port,&token);CONNECTIONS.fetch_sub(1,Ordering::Relaxed);});
  }});Ok(Bridge{port,token})
 });
 bridge.as_ref().map(|b|format!("http://127.0.0.1:{}/{}/index.html",b.port,b.token)).map_err(Clone::clone)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn bridge_has_only_three_fixed_resources(){assert!(asset("/secret/index.html","secret").is_some());assert!(asset("/secret/player.js","secret").is_some());for path in ["/other/index.html","/secret/../Cargo.toml","/secret/index.html?x=1","/secret/"]{assert!(asset(path,"secret").is_none());}assert!(!JS.contains("__TAURI__"));}
 #[test]fn bridge_is_loopback_only_and_rejects_foreign_host(){let url=cinema_embed().unwrap();let url=url::Url::parse(&url).unwrap();assert_eq!(url.host_str(),Some("127.0.0.1"));let port=url.port().unwrap();let mut s=TcpStream::connect(("127.0.0.1",port)).unwrap();write!(s,"GET {} HTTP/1.1\r\nHost: evil.example\r\n\r\n",url.path()).unwrap();let mut result=String::new();s.read_to_string(&mut result).unwrap();assert!(result.starts_with("HTTP/1.1 400"));}
}
