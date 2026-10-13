use rand::RngCore;
use reqwest::{blocking::Client, header::{HeaderMap, HeaderValue, USER_AGENT}};
use std::{collections::HashMap, io::{Read, Write}, net::{TcpListener, TcpStream}, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, AtomicUsize, Ordering}}, thread, time::{Duration, Instant}};

const CHUNK: u64 = 512 * 1024;
const MAX_STREAMS: usize = 12;
const STREAM_LIFETIME: Duration = Duration::from_secs(3600);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceError { Limited, Denied, Network, Invalid }
impl std::fmt::Display for SourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(if *self == Self::Limited { "YouTube is temporarily limiting playback. Try again later." } else { "Could not open this track" })
    }
}
impl std::error::Error for SourceError {}

#[derive(Default)]
pub struct PlaybackLimit { until: Mutex<Option<Instant>> }
impl PlaybackLimit {
    pub fn active(&self) -> bool { self.until.lock().unwrap().is_some_and(|until| Instant::now() < until) }
    pub fn note(&self, seconds: Option<u64>) {
        let until = Instant::now() + Duration::from_secs(seconds.unwrap_or(60).clamp(60, 86400));
        let mut current = self.until.lock().unwrap();
        *current = Some(current.map_or(until, |old| old.max(until)));
    }
}

pub struct Source {
    pub url: url::Url,
    pub size: u64,
    pub mime: &'static str,
    client: Client,
    headers: HeaderMap,
    chunks: Mutex<Vec<(u64, Vec<u8>)>>,
    fetch_lock: Mutex<()>,
    failed: Mutex<Option<SourceError>>,
    limit: Arc<PlaybackLimit>,
}

pub fn trusted_url(url: &url::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|host| host.ends_with(".googlevideo.com"))
        && url.username().is_empty() && url.password().is_none() && url.port_or_known_default() == Some(443)
}

impl Source {
    pub fn new(url: url::Url, size: u64, mime: &'static str, agent: &str, proxy: &str, limit: Arc<PlaybackLimit>) -> Result<Self, String> {
        if !trusted_url(&url) || size == 0 || size > 2 * 1024 * 1024 * 1024 { return Err("Could not open this track".into()); }
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut builder = Client::builder().timeout(Duration::from_secs(15)).connect_timeout(Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 3 && trusted_url(attempt.url()) { attempt.follow() } else { attempt.stop() }
            }));
        if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "Could not open this track")?); }
        let client = builder.build().map_err(|_| "Could not open this track")?;
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_str(agent).map_err(|_| "Could not open this track")?);
        Ok(Self { url, size, mime, client, headers, chunks: Mutex::new(Vec::new()), fetch_lock: Mutex::new(()), failed: Mutex::new(None), limit })
    }

    pub fn failed(&self) -> bool { self.failed.lock().unwrap().is_some() }

    // Some media servers accept the URL byte range while rejecting an HTTP Range
    // header. Translate here so every WebView gets ordinary seekable HTTP audio.
    fn fetch_chunk(&self, start: u64) -> Result<Vec<u8>, SourceError> {
        self.fetch_chunk_until(start, Instant::now() + Duration::from_secs(12))
    }

    fn fetch_chunk_until(&self, start: u64, deadline: Instant) -> Result<Vec<u8>, SourceError> {
        if let Some((_, bytes)) = self.chunks.lock().unwrap().iter().find(|(offset, _)| *offset == start) { return Ok(bytes.clone()); }
        if start >= self.size { return Err(SourceError::Invalid); }
        if Instant::now() >= deadline { return Err(SourceError::Network); }
        // WebViews may request overlapping ranges during startup and seeking.
        // Share the transfer instead of fetching the same bytes concurrently.
        let _transfer = loop {
            if let Ok(lock) = self.fetch_lock.try_lock() { break lock; }
            if Instant::now() >= deadline { return Err(SourceError::Network); }
            thread::sleep(Duration::from_millis(10));
        };
        if let Some((_, bytes)) = self.chunks.lock().unwrap().iter().find(|(offset, _)| *offset == start) { return Ok(bytes.clone()); }
        if let Some(error) = *self.failed.lock().unwrap() { return Err(error); }
        if self.limit.active() { return Err(SourceError::Limited); }
        let end = (start + CHUNK - 1).min(self.size - 1);
        let url = ranged_url(&self.url, start, end);
        let mut last = SourceError::Network;
        for attempt in 0..2 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { break; }
            let fetched = (|| {
                let response = self.client.get(url.clone()).headers(self.headers.clone())
                    .timeout(remaining.min(Duration::from_secs(6))).send().map_err(|_| SourceError::Network)?;
                let status = response.status();
                if !status.is_success() {
                    #[cfg(debug_assertions)] eprintln!("Guest audio upstream status: {status}");
                    if status.as_u16() == 429 {
                        self.limit.note(response.headers().get("Retry-After").and_then(|h| h.to_str().ok()).and_then(|s| s.parse().ok()));
                    }
                    return Err(match status.as_u16() { 429 => SourceError::Limited, 401 | 403 => SourceError::Denied,
                        408 | 500..=599 => SourceError::Network, _ => SourceError::Invalid });
                }
                let mut bytes = Vec::new();
                response.take(end - start + 2).read_to_end(&mut bytes).map_err(|_| SourceError::Network)?;
                if bytes.len() as u64 != end - start + 1 { return Err(SourceError::Network); }
                Ok(bytes)
            })();
            match fetched {
                Ok(bytes) => {
                    let mut chunks = self.chunks.lock().unwrap();
                    if !chunks.iter().any(|(offset,_)| *offset == start) {
                        if chunks.len() >= 8 { chunks.remove(0); }
                        chunks.push((start, bytes.clone()));
                    }
                    return Ok(bytes);
                }
                Err(error) => {
                    last = error;
                    // Fresh signed URLs can briefly return 403 before becoming usable.
                    // Retry those exact bytes once after a pause, without extracting
                    // another URL. A 429 never retries and also stops other sources.
                    if error == SourceError::Limited || error == SourceError::Invalid { break; }
                    if attempt == 0 {
                        let delay = if error == SourceError::Denied { Duration::from_secs(3) } else { Duration::from_millis(100) };
                        if deadline.saturating_duration_since(Instant::now()) <= delay { break; }
                        thread::sleep(delay);
                    }
                }
            }
        }
        if matches!(last, SourceError::Denied | SourceError::Limited) { *self.failed.lock().unwrap() = Some(last); }
        Err(last)
    }

    pub fn verify(&self, deadline: Instant) -> Result<(), SourceError> { self.fetch_chunk_until(0, deadline).map(|_| ()) }
}

fn ranged_url(source: &url::Url, start: u64, end: u64) -> url::Url {
    // Keep signed parameters byte-for-byte; only replace the byte-range field.
    let mut result = source.clone();
    let mut query = source.query().unwrap_or("").split('&').filter(|part| !part.is_empty() &&
        !url::form_urlencoded::parse(part.as_bytes()).any(|(key, _)| key == "range")).collect::<Vec<_>>().join("&");
    if !query.is_empty() { query.push('&'); }
    query.push_str(&format!("range={start}-{end}"));
    result.set_query(Some(&query));
    result
}

struct Entry { source: Arc<Source>, created: Instant }
struct Relay { port: u16, entries: Arc<Mutex<HashMap<String, Entry>>>, stopped: Arc<AtomicBool> }
impl Drop for Relay { fn drop(&mut self) { self.stopped.store(true, Ordering::Relaxed); } }
static RELAY: OnceLock<Mutex<Option<Relay>>> = OnceLock::new();

pub fn register(source: Arc<Source>) -> Result<String, String> {
    let mut relay = RELAY.get_or_init(|| Mutex::new(None)).lock().unwrap();
    if relay.is_none() { *relay = Some(Relay::start().map_err(|_| "Could not start the music player")?); }
    Ok(relay.as_ref().unwrap().insert(source))
}

impl Relay {
    fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let entries = Arc::new(Mutex::new(HashMap::<String,Entry>::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let (registry, done) = (entries.clone(), stopped.clone());
        thread::spawn(move || {
            let active = Arc::new(AtomicUsize::new(0));
            while !done.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if active.load(Ordering::Relaxed) >= 6 { continue; }
                        active.fetch_add(1, Ordering::Relaxed);
                        let (registry, active) = (registry.clone(), active.clone());
                        thread::spawn(move || {
                            let _ = serve(stream, &registry, port);
                            active.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(20)),
                    Err(_) => break,
                }
            }
        });
        Ok(Self { port, entries, stopped })
    }

    fn insert(&self, source: Arc<Source>) -> String {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|_, entry| entry.created.elapsed() < STREAM_LIFETIME);
        if let Some((token,_)) = entries.iter().find(|(_,entry)| Arc::ptr_eq(&source,&entry.source)) { return format!("http://127.0.0.1:{}/{token}",self.port); }
        if entries.len() >= MAX_STREAMS {
            if let Some(oldest) = entries.iter().max_by_key(|(_,entry)| entry.created.elapsed()).map(|(token,_)| token.clone()) { entries.remove(&oldest); }
        }
        let mut random = [0u8;24]; rand::rng().fill_bytes(&mut random);
        let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        entries.insert(token.clone(),Entry { source, created: Instant::now() });
        format!("http://127.0.0.1:{}/{token}",self.port)
    }
}

fn range(header: Option<&str>, size: u64) -> Result<(u64,u64), ()> {
    if size == 0 { return Err(()); }
    let Some(header) = header else { return Ok((0,size-1)); };
    let value = header.strip_prefix("bytes=").ok_or(())?;
    let (start,end) = value.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 { return Err(()); }
        return Ok((size.saturating_sub(suffix),size-1));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    let end = if end.is_empty() { size-1 } else { end.parse::<u64>().map_err(|_| ())?.min(size-1) };
    if start > end || start >= size { Err(()) } else { Ok((start,end)) }
}

fn error(stream: &mut TcpStream, status: &str) -> std::io::Result<()> {
    write!(stream,"HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}

fn serve(mut stream: TcpStream, registry: &Mutex<HashMap<String,Entry>>, port: u16) -> std::io::Result<()> {
    // Windows inherits the listener's nonblocking mode. These worker threads
    // use bounded blocking I/O; otherwise a split request can close the socket.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut request = Vec::new();
    let mut byte = [0u8;1];
    let started = Instant::now();
    while request.len() < 8192 && !request.ends_with(b"\r\n\r\n") {
        if started.elapsed() > Duration::from_secs(3) { return error(&mut stream,"408 Request Timeout"); }
        if stream.read(&mut byte)? == 0 { return Ok(()); }
        request.push(byte[0]);
    }
    if !request.ends_with(b"\r\n\r\n") { return error(&mut stream,"431 Request Header Fields Too Large"); }
    let text = String::from_utf8_lossy(&request);
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("");
    let path = first.next().unwrap_or("");
    if !matches!(method,"GET"|"HEAD") { return error(&mut stream,"405 Method Not Allowed"); }
    let mut host = "";
    let mut requested = None;
    for line in lines {
        if let Some((key,value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("host") { host=value.trim(); }
            if key.eq_ignore_ascii_case("range") { requested=Some(value.trim()); }
        }
    }
    if host != format!("127.0.0.1:{port}") { return error(&mut stream,"403 Forbidden"); }
    let source = registry.lock().unwrap().get(path.strip_prefix('/').unwrap_or(""))
        .filter(|entry| entry.created.elapsed() < STREAM_LIFETIME).map(|entry|entry.source.clone());
    let Some(source) = source else { return error(&mut stream,"404 Not Found"); };
    let Ok((start,end)) = range(requested, source.size) else {
        return write!(stream,"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",source.size);
    };
    let mut offset = start / CHUNK * CHUNK;
    let mut chunk = if method == "HEAD" { Vec::new() } else {
        match source.fetch_chunk(offset) { Ok(chunk) => chunk, Err(_) => return error(&mut stream,"502 Bad Gateway") }
    };
    write!(stream,"HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n",if requested.is_some() { "206 Partial Content" } else { "200 OK" },source.mime,end-start+1)?;
    if requested.is_some() { write!(stream,"Content-Range: bytes {start}-{end}/{}\r\n",source.size)?; }
    stream.write_all(b"\r\n")?;
    if method == "HEAD" { return Ok(()); }
    loop {
        let from = start.saturating_sub(offset) as usize;
        let to = (end - offset + 1).min(chunk.len() as u64) as usize;
        stream.write_all(&chunk[from..to])?;
        offset += CHUNK;
        if offset > end { break; }
        chunk = source.fetch_chunk(offset).map_err(std::io::Error::other)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(statuses: Vec<u16>, truncated: bool) -> (Source, Arc<AtomicUsize>, thread::JoinHandle<()>) {
        use std::io::BufRead;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url=url::Url::parse(&format!("http://{}/audio",listener.local_addr().unwrap())).unwrap();
        let count=Arc::new(AtomicUsize::new(0));let seen=count.clone();
        let thread=thread::spawn(move || {
            let deadline=Instant::now()+Duration::from_secs(6);
            while Instant::now()<deadline && seen.load(Ordering::Relaxed)<statuses.len() {
                let (mut stream,_)=match listener.accept(){Ok(pair)=>pair,Err(_)=>{thread::sleep(Duration::from_millis(5));continue;}};
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
                let mut input=std::io::BufReader::new(&stream);let mut line=String::new();
                loop {line.clear();if input.read_line(&mut line).unwrap_or(0)==0 || line=="\r\n" {break;}}
                let index=seen.fetch_add(1,Ordering::Relaxed);let status=statuses[index];
                let length=if status==200 {100}else{0};
                let _=write!(stream,"HTTP/1.1 {status} Test\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n");
                if length>0 {let _=stream.write_all(&vec![42;if truncated&&index==0 {50}else{100}]);}
            }
        });
        // Tests inject loopback directly; production Source::new still rejects it.
        (Source {url,size:100,mime:"audio/mp4",client:Client::builder().no_proxy().build().unwrap(),headers:HeaderMap::new(),chunks:Mutex::new(vec![]),fetch_lock:Mutex::new(()),failed:Mutex::new(None),limit:Arc::default()},count,thread)
    }

    #[test]
    fn interrupted_chunks_and_server_errors_retry_once_then_cache() {
        for (statuses,truncated) in [(vec![503,200],false),(vec![200,200],true)] {
            let (source,count,worker)=fixture(statuses,truncated);
            assert_eq!(source.fetch_chunk(0).unwrap(),vec![42;100]);
            assert_eq!(source.fetch_chunk(0).unwrap(),vec![42;100]);
            worker.join().unwrap();assert_eq!(count.load(Ordering::Relaxed),2);
        }
    }

    #[test]
    fn source_can_resume_after_a_network_outage_exhausts_its_retry() {
        let (source,count,worker)=fixture(vec![503,503,200],false);
        assert_eq!(source.fetch_chunk(0),Err(SourceError::Network));
        assert!(!source.failed());
        assert_eq!(source.fetch_chunk(0).unwrap(),vec![42;100]);
        worker.join().unwrap();assert_eq!(count.load(Ordering::Relaxed),3);
    }

    #[test]
    fn denied_audio_has_one_delayed_retry_but_limited_audio_never_retries() {
        for (statuses,expected) in [(vec![403,403],SourceError::Denied),(vec![429],SourceError::Limited)] {
            let requests=statuses.len();
            let (source,count,worker)=fixture(statuses,false);
            assert_eq!(source.fetch_chunk(0),Err(expected));worker.join().unwrap();assert_eq!(count.load(Ordering::Relaxed),requests);
            assert_eq!(source.fetch_chunk(0),Err(expected)); // a broken source stays invalid
            assert_eq!(source.fetch_chunk_until(0,Instant::now()),Err(SourceError::Network));
            assert_eq!(count.load(Ordering::Relaxed),requests);
        }
    }

    #[test]
    fn fresh_url_can_become_available_without_resolving_again() {
        let (source,count,worker)=fixture(vec![403,200],false);
        let started=Instant::now();
        assert_eq!(source.fetch_chunk(0).unwrap(),vec![42;100]);
        assert!(started.elapsed() >= Duration::from_secs(3));
        assert!(!source.failed());worker.join().unwrap();assert_eq!(count.load(Ordering::Relaxed),2);
    }

    #[test]
    fn simultaneous_audio_requests_share_one_upstream_transfer() {
        let (source,count,worker)=fixture(vec![200],false);let source=Arc::new(source);
        let requests:Vec<_>=(0..6).map(|_| {let source=source.clone();thread::spawn(move ||source.fetch_chunk(0).unwrap())}).collect();
        for request in requests {assert_eq!(request.join().unwrap(),vec![42;100]);}
        worker.join().unwrap();assert_eq!(count.load(Ordering::Relaxed),1);
    }

    #[test]
    fn signed_query_is_preserved_when_replacing_range() {
        let source=url::Url::parse("https://rr1.googlevideo.com/a?sig=x%2fy~z&n=a%20b&%72ange=old&lsparams=a,b").unwrap();
        assert_eq!(ranged_url(&source,4,8).as_str(),"https://rr1.googlevideo.com/a?sig=x%2fy~z&n=a%20b&lsparams=a,b&range=4-8");
        assert_eq!(ranged_url(&source,0,99).query_pairs().filter(|(key,_)|key=="range").count(),1);
    }

    #[test]
    fn media_rate_limit_stops_other_sources_but_keeps_cached_bytes_available() {
        let (source,count,worker)=fixture(vec![429],false);
        assert_eq!(source.fetch_chunk(0),Err(SourceError::Limited));worker.join().unwrap();
        let (mut other,other_count,other_worker)=fixture(vec![],false);other.limit=source.limit.clone();
        assert_eq!(other.fetch_chunk(0),Err(SourceError::Limited));
        other.chunks.lock().unwrap().push((0,vec![42;100]));
        assert_eq!(other.fetch_chunk(0).unwrap(),vec![42;100]);
        other_worker.join().unwrap();assert_eq!(other_count.load(Ordering::Relaxed),0);assert_eq!(count.load(Ordering::Relaxed),1);
        source.limit.note(Some(120));let until=source.limit.until.lock().unwrap().unwrap();source.limit.note(Some(60));
        assert_eq!(source.limit.until.lock().unwrap().unwrap(),until);
    }

    #[test]
    fn audio_ranges_cover_seeking_suffixes_and_invalid_requests() {
        assert_eq!(range(None,100),Ok((0,99)));
        assert_eq!(range(Some("bytes=30-"),100),Ok((30,99)));
        assert_eq!(range(Some("bytes=2-8"),100),Ok((2,8)));
        assert_eq!(range(Some("bytes=-10"),100),Ok((90,99)));
        for value in ["bytes=100-","bytes=5-2","bytes=1-2,4-5","bytes=-0","bad"] { assert!(range(Some(value),100).is_err()); }
    }

    #[test]
    fn audio_sources_reject_untrusted_hosts_and_credentials() {
        assert!(trusted_url(&url::Url::parse("https://rr1.googlevideo.com/videoplayback").unwrap()));
        for raw in ["http://rr1.googlevideo.com/a","https://googlevideo.com.evil.test/a","https://user@rr1.googlevideo.com/a","https://rr1.googlevideo.com:8080/a","http://127.0.0.1/a"] {
            assert!(!trusted_url(&url::Url::parse(raw).unwrap()));
        }
    }

    #[test]
    fn relay_accepts_headers_that_arrive_after_the_connection() {
        let (source,_,worker)=fixture(vec![],false);worker.join().unwrap();
        source.chunks.lock().unwrap().push((0,vec![42;100]));
        let relay=Relay::start().unwrap();let address=relay.insert(Arc::new(source));
        let url=url::Url::parse(&address).unwrap();
        let mut socket=TcpStream::connect(("127.0.0.1",relay.port)).unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        // A browser can connect before sending its request, or split headers
        // across packets. A nonblocking accepted socket must not be discarded.
        thread::sleep(Duration::from_millis(100));
        write!(socket,"GET {} HTTP/1.1\r\n",url.path()).unwrap();
        thread::sleep(Duration::from_millis(50));
        write!(socket,"Host: 127.0.0.1:{}\r\nRange: bytes=20-29\r\n\r\n",relay.port).unwrap();
        let mut response=Vec::new();socket.read_to_end(&mut response).unwrap();
        assert!(response.starts_with(b"HTTP/1.1 206"));
        assert!(response.ends_with(&[42;10]));
    }

    #[test]
    fn relay_serves_seek_ranges_and_head_without_an_upstream_request() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let source=Arc::new(Source {url:url::Url::parse("https://rr1.googlevideo.com/a").unwrap(),size:100,mime:"audio/mp4",client:Client::new(),headers:HeaderMap::new(),chunks:Mutex::new(vec![(0,(0..100).collect())]),fetch_lock:Mutex::new(()),failed:Mutex::new(None),limit:Arc::default()});
        let relay=Relay::start().unwrap();let address=relay.insert(source);
        let client=Client::builder().no_proxy().build().unwrap();
        let response=client.get(&address).header("Range","bytes=20-29").send().unwrap();
        assert_eq!(response.status(),206);assert_eq!(response.headers()["Content-Range"],"bytes 20-29/100");
        assert_eq!(response.bytes().unwrap().as_ref(),&(20..30).collect::<Vec<u8>>());
        let response=client.head(&address).send().unwrap();assert_eq!(response.headers()["Content-Length"],"100");assert_eq!(response.bytes().unwrap().len(),0);
        assert_eq!(client.get(format!("http://127.0.0.1:{}/bad-token",relay.port)).send().unwrap().status(),404);
        assert_eq!(client.get(&address).header("Host","evil.test").send().unwrap().status(),403);
        assert_eq!(client.get(&address).header("Range","bytes=100-").send().unwrap().status(),416);
    }
}
