mod convert;
mod heal;
mod media_server;
mod model;
mod power;
mod share;
mod watch;
use model::{Job, Options};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet}, fs, io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf},
    process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, mpsc},
    thread, time::Duration,
};
use tauri::{Emitter, Manager};
use base64::Engine as _;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    jobs: Vec<Job>,
    options: Options,
    parallel: usize,
    #[serde(default)]
    warning: String,
    // Where new downloads go when the app starts; empty means the last used folder.
    #[serde(default)]
    default_folder: String,
    // Jellyfin, Emby or Plex to notify after downloads laid out for it.
    #[serde(default)]
    media_server: media_server::MediaServer,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self { jobs: vec![], options: Options::default(), parallel: 2, warning: String::new(), default_folder: String::new(),
            media_server: media_server::MediaServer::default() }
    }
}

#[derive(Clone)]
struct Engine {
    data: Arc<Mutex<Snapshot>>,
    dir: PathBuf,
    shutdown: Arc<AtomicBool>,
}

fn save(dir: &Path, data: &Snapshot) -> Result<(), String> {
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(&serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(dir.join("queue.json")).map_err(|e| e.to_string())?;
    Ok(())
}

fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    let mut paths = program.parent().map(|p| vec![p.to_path_buf()]).unwrap_or_default();
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    #[cfg(target_os = "macos")] {
        paths.push("/opt/homebrew/bin".into());
        paths.push("/usr/local/bin".into());
    }
    if let Ok(path) = std::env::join_paths(paths) { c.env("PATH", path); }
    c
}

// The proxy from the settings applies to every yt-dlp run that goes online.
static PROXY: Mutex<String> = Mutex::new(String::new());

fn ytdlp_command(exe: &Path) -> Command {
    let proxy = PROXY.lock().unwrap().clone();
    ytdlp_command_with(exe, &proxy)
}

// UTF-8 output keeps Windows error messages readable in any system language.
fn ytdlp_command_with(exe: &Path, proxy: &str) -> Command {
    let mut c = command(exe);
    c.args(["--encoding", "utf-8"]);
    if !proxy.is_empty() { c.args(["--proxy", proxy]); }
    c
}

fn binary(name: &str) -> Result<PathBuf, String> {
    let filename = if cfg!(windows) { format!("{name}.exe") } else { name.into() };
    let mut dirs: Vec<PathBuf> = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            dirs.push(p.into());
            dirs.push(p.join("bin"));
            // A macOS app keeps the bundled engines in Contents/Resources/bin.
            #[cfg(target_os = "macos")]
            if let Some(contents) = p.parent() { dirs.push(contents.join("Resources").join("bin")); }
            // The Linux packages put them in usr/lib/<product>/bin next to usr/bin.
            #[cfg(all(unix, not(target_os = "macos")))]
            if let Some(usr) = p.parent() {
                if let Ok(entries) = fs::read_dir(usr.join("lib")) {
                    dirs.extend(entries.flatten().filter(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase().contains("deviload"))
                        .map(|entry| entry.path().join("bin")));
                }
            }
        }
    }
    // Development builds also look in the checkout's bin folder.
    #[cfg(debug_assertions)]
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bin"));
    dirs.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    #[cfg(target_os = "macos")] {
        dirs.push("/opt/homebrew/bin".into()); dirs.push("/usr/local/bin".into());
    }
    let found = dirs.into_iter().map(|d| d.join(&filename)).find(|p| p.is_file())
        .ok_or_else(|| format!("{filename} not found. Install yt-dlp, FFmpeg and Deno, then restart the app."))?;
    #[cfg(unix)]
    return runnable(found);
    #[cfg(not(unix))]
    Ok(found)
}

// A package can lose the executable bit of a bundled engine, and an AppImage is
// read-only; such an engine runs from a copy in the app's data folder.
#[cfg(unix)]
fn runnable(path: PathBuf) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.permissions().mode() & 0o111 != 0 { return Ok(path); }
    let folder = dirs::data_local_dir().ok_or("No folder for the engines")?.join("com.deviload.desktop").join("engines");
    let copy = folder.join(path.file_name().unwrap_or_default());
    if fs::metadata(&copy).is_ok_and(|existing| existing.len() == meta.len() && existing.permissions().mode() & 0o111 != 0) { return Ok(copy); }
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    fs::copy(&path, &copy).map_err(|e| format!("Could not prepare {}: {e}", path.display()))?;
    fs::set_permissions(&copy, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    Ok(copy)
}

// The engines' locations go before the "--" that ends the options.
fn download_args(job: &Job, dir: &Path) -> Result<Vec<String>, String> {
    let ffmpeg = binary("ffmpeg")?;
    binary("ffprobe")?;
    let deno = binary("deno")?;
    let mut args = job.options.args(&job.url, dir);
    let tail = args.split_off(args.len() - 2);
    args.extend(["--ffmpeg-location".into(), ffmpeg.parent().unwrap().to_string_lossy().into(),
        "--js-runtimes".into(), format!("deno:{}", deno.display())]);
    args.extend(tail);
    Ok(args)
}

fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|c| c.is_whitespace() || "\"&|<>^%(),;'`$".contains(c)) { return arg.into(); }
    format!("\"{}\"", arg.replace('"', "\\\""))
}

// The exact yt-dlp call for a task, for bug reports and for running it by hand.
#[tauri::command]
fn job_command(id: u64, engine: tauri::State<Engine>) -> Result<String, String> {
    let job = engine.data.lock().unwrap().jobs.iter().find(|j| j.id == id).cloned().ok_or("Task not found")?;
    let exe = binary("yt-dlp")?;
    let command = ytdlp_command(&exe);
    let mut parts = vec![quote_arg(&exe.to_string_lossy())];
    parts.extend(command.get_args().map(|arg| quote_arg(&arg.to_string_lossy())));
    parts.extend(download_args(&job, &engine.dir)?.iter().map(|arg| quote_arg(arg)));
    Ok(parts.join(" "))
}

// Text files with links, one or many per line; only the text is returned.
#[tauri::command]
fn read_link_list(path: String) -> Result<String, String> {
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 2_000_000 { return Err("The file is larger than 2 MB".into()); }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_owned())
}

#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }.map_err(|e| format!("Could not change the start with Windows: {e}"))?;
    manager.is_enabled().map_err(|e| e.to_string())
}

fn kill_tree(pid: u32) {
    #[cfg(windows)] {
        let _ = command(Path::new("taskkill.exe")).args(["/PID", &pid.to_string(), "/T", "/F"]).output();
    }
    #[cfg(unix)] unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
}

impl Engine {
    fn persist(&self, d: &mut Snapshot) {
        if let Err(e) = save(&self.dir, d) { d.warning = format!("Could not save the queue: {e}"); }
    }
    fn run_job(&self, id: u64) {
        let job = {
            let d = self.data.lock().unwrap();
            match d.jobs.iter().find(|j| j.id == id) { Some(j) => j.clone(), None => return }
        };
        let result = self.download(&job).and_then(|_| self.finish_clip_gif(&job)).map(|_| self.finish_media_server(&job));
        let mut d = self.data.lock().unwrap();
        if let Some(j) = d.jobs.iter_mut().find(|j| j.id == id) {
            j.pid = None;
            if j.status == "pausing" { j.status = "paused".into(); }
            else if j.status == "cancelling" || self.shutdown.load(Ordering::Relaxed) { j.status = "cancelled".into(); }
            else {
                match result {
                    Ok(()) => { j.status = "done".into(); j.percent = 100.0; j.scheduled_at = None; }
                    Err(e) => {
                        j.consume(&e);
                        if !schedule_retry(j) {
                            let cookies = session_file(&self.dir);
                            match heal::plan(j, cookies.is_file(), now_seconds()) {
                                Some(fix) => heal::apply(j, &fix, &cookies, now_seconds()),
                                None => j.status = "error".into(),
                            }
                        }
                    }
                }
            }
        }
        self.persist(&mut d);
        // When the last download for the media server is done, ask it to scan.
        let server = d.media_server.clone();
        let batch_done = !d.jobs.iter().any(|j| j.options.folder_rule == "server" && (["running", "cancelling", "pausing"].contains(&j.status.as_str()) || ready_to_run(j, now_seconds())));
        let finished = d.jobs.iter().any(|j| j.id == id && j.status == "done");
        drop(d);
        if job.options.folder_rule == "server" && finished && batch_done && !server.kind.is_empty() {
            let engine = self.clone();
            thread::spawn(move || {
                if let Err(error) = media_server::refresh(&server) {
                    let mut d = engine.data.lock().unwrap();
                    if let Some(j) = d.jobs.iter_mut().find(|j| j.id == id) { j.consume(&format!("Deviload: {error}")); }
                    engine.persist(&mut d);
                }
            });
        }
    }
    // Details for Jellyfin and Plex; a failure here is noted in the log but keeps the download.
    fn finish_media_server(&self, job: &Job) {
        if job.options.folder_rule != "server" || job.options.audio_only() { return; }
        let errors = media_server::describe_all(Path::new(&job.options.folder));
        if errors.is_empty() { return; }
        let mut d = self.data.lock().unwrap();
        if let Some(j) = d.jobs.iter_mut().find(|j| j.id == job.id) {
            for error in errors { j.consume(&format!("Deviload: no details for the media server: {error}")); }
        }
    }
    fn finish_clip_gif(&self, job: &Job) -> Result<(), String> {
        if job.options.clip_format != "gif" { return Ok(()); }
        let file = {
            let mut d = self.data.lock().unwrap();
            let current = d.jobs.iter_mut().find(|item| item.id == job.id).ok_or("Task not found")?;
            current.consume("Creating a GIF from the downloaded clip…");
            PathBuf::from(&current.file)
        };
        if !file.is_file() { return Err("The downloaded clip for the GIF was not found".into()); }
        let source = probe_source(&file)?;
        let project = ProjectExport { clips: vec![ProjectClip { job_id: job.id, start: 0.0, end: source.duration, look: ClipLook::default() }],
            canvas: "source".into(), format: "gif".into(), quality: 480, ..ProjectExport::default() };
        let output = new_output_path(&file, "GIF", "gif")?;
        render_project(&[source], &project, None, &[], &output, &|_| {})?;
        let mut d = self.data.lock().unwrap();
        if let Some(current) = d.jobs.iter_mut().find(|item| item.id == job.id) {
            current.file = output.to_string_lossy().into_owned();
        }
        Ok(())
    }
    // yt-dlp skips what its archive lists even after the file was deleted. Before a
    // download, entries whose files are all gone are dropped, so they download again.
    fn forget_deleted(&self, job: &Job) {
        let gone: HashSet<String> = {
            let d = self.data.lock().unwrap();
            // Another download of this format may be appending to the same archive right now.
            if d.jobs.iter().any(|j| j.id != job.id && j.status == "running" && j.options.quality == job.options.quality) { return; }
            let mut present: HashMap<&str, bool> = HashMap::new();
            for [key, file] in d.jobs.iter().filter(|j| j.options.quality == job.options.quality).flat_map(|j| &j.downloads) {
                if !file.is_empty() { *present.entry(key.as_str()).or_insert(false) |= Path::new(file).exists(); }
            }
            present.into_iter().filter(|(_, there)| !there).map(|(key, _)| key.to_owned()).collect()
        };
        if gone.is_empty() { return; }
        let path = self.dir.join(format!("archive-{}.txt", job.options.quality));
        if let Some(kept) = fs::read_to_string(&path).ok().and_then(|text| model::prune_archive(&text, &gone)) {
            let _ = fs::write(&path, kept);
        }
    }
    fn download(&self, job: &Job) -> Result<(), String> {
        if job.options.archive && job.options.clip_start.is_none() { self.forget_deleted(job); }
        let exe = binary("yt-dlp")?;
        let args = download_args(job, &self.dir)?;
        fs::create_dir_all(&job.options.folder).map_err(|e| e.to_string())?;
        let mut cmd = ytdlp_command(&exe);
        cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(unix)] {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        {
            let mut d = self.data.lock().unwrap();
            if let Some(j) = d.jobs.iter_mut().find(|j| j.id == job.id) { j.pid = Some(child.id()); }
        }
        let (tx, rx) = mpsc::sync_channel::<String>(256);
        let tx_err = tx.clone();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let out_thread = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) { if tx.send(line).is_err() { break; } }
        });
        let err_thread = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) { if tx_err.send(line).is_err() { break; } }
        });
        let status = loop {
            // Bound each drain so noisy children cannot starve cancellation.
            for line in rx.try_iter().take(256) {
                let mut d = self.data.lock().unwrap();
                if let Some(j) = d.jobs.iter_mut().find(|j| j.id == job.id) { j.consume(&line); }
            }
            let cancelled = self.shutdown.load(Ordering::Relaxed) || {
                let d = self.data.lock().unwrap();
                d.jobs.iter().any(|j| j.id == job.id && ["cancelling", "pausing"].contains(&j.status.as_str()))
            };
            if cancelled { kill_tree(child.id()); let _ = child.kill(); }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(e) => {
                    kill_tree(child.id()); let _ = child.wait();
                    drop(rx);
                    let _ = out_thread.join(); let _ = err_thread.join();
                    return Err(e.to_string());
                }
            }
        };
        // Read through EOF before deciding success; FFmpeg errors can be the last line.
        for line in rx {
            let mut d = self.data.lock().unwrap();
            if let Some(j) = d.jobs.iter_mut().find(|j| j.id == job.id) { j.consume(&line); }
        }
        let _ = out_thread.join(); let _ = err_thread.join();
        if status.success() { return Ok(()); }
        let code = status.code().map_or_else(|| "?".to_string(), |code| code.to_string());
        Err(format!("yt-dlp exited with code {code}. See the task log for details."))
    }
    fn stop(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let pids = {
            let mut d = self.data.lock().unwrap();
            let mut pids = vec![];
            for j in &mut d.jobs {
                if let Some(pid) = j.pid { pids.push(pid); j.status = "interrupted".into(); }
            }
            self.persist(&mut d);
            pids
        };
        for pid in pids { kill_tree(pid); }
    }
}

#[tauri::command]
fn snapshot(engine: tauri::State<Engine>) -> Snapshot { engine.data.lock().unwrap().clone() }

#[tauri::command]
fn set_media_server(server: media_server::MediaServer, engine: tauri::State<Engine>) -> Result<(), String> {
    let server = media_server::MediaServer { kind: server.kind, url: server.url.trim().into(), token: server.token.trim().into() };
    server.validate()?;
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    d.media_server = server;
    if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    Ok(())
}

// Asks the saved server to scan now; the settings use it to check the address and the key.
#[tauri::command]
async fn check_media_server(engine: tauri::State<'_, Engine>) -> Result<(), String> {
    let server = engine.data.lock().unwrap().media_server.clone();
    if server.kind.is_empty() { return Err("Choose a media server first".into()); }
    tauri::async_runtime::spawn_blocking(move || media_server::refresh(&server)).await.map_err(|e| e.to_string())?
}

// An empty folder goes back to the last used one.
#[tauri::command]
fn set_default_folder(folder: String, engine: tauri::State<Engine>) -> Result<String, String> {
    let folder = if folder.trim().is_empty() { PathBuf::new() } else { plain_folder(&folder) };
    if !folder.as_os_str().is_empty() && (!folder.is_absolute() || !folder.is_dir()) {
        return Err("Pick an existing folder".into());
    }
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    d.default_folder = folder.to_string_lossy().into_owned();
    if !d.default_folder.is_empty() { d.options.folder = d.default_folder.clone(); }
    if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    Ok(d.default_folder.clone())
}

#[tauri::command]
fn common_folders() -> Vec<(String, String)> {
    [("downloads", Some(model::download_dir())), ("music", dirs::audio_dir()),
     ("desktop", dirs::desktop_dir())].into_iter()
        .filter_map(|(name, path)| path.map(|p| (name.into(), p.to_string_lossy().into())))
        .collect()
}

const YOUTUBE_SIGN_IN: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
const SESSION_URLS: [&str; 4] = ["https://www.youtube.com/", "https://music.youtube.com/", "https://accounts.google.com/", "https://www.google.com/"];

fn session_file(dir: &Path) -> PathBuf { dir.join("youtube-cookies.txt") }

// The YouTube window keeps its own WebView profile, so signing out never
// touches the main window's storage.
fn youtube_profile(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map(|dir| dir.join("youtube-session")).map_err(|e| e.to_string())
}

fn cookie_file_content(cookies: &[tauri::webview::Cookie<'static>]) -> Option<String> {
    let mut out = String::from("# Netscape HTTP Cookie File\n# Deviload YouTube session; keep this file private.\n\n");
    let mut seen = HashSet::new();
    let mut signed_in = false;
    for cookie in cookies {
        let Some(domain) = cookie.domain() else { continue; };
        let host = domain.trim_start_matches('.').to_ascii_lowercase();
        if !(host == "youtube.com" || host.ends_with(".youtube.com") || host == "google.com" || host.ends_with(".google.com")) { continue; }
        let path = cookie.path().unwrap_or("/");
        let name = cookie.name();
        let value = cookie.value();
        if [domain, path, name, value].iter().any(|part| part.contains(['\t', '\r', '\n'])) { continue; }
        if !seen.insert((host.clone(), path.to_owned(), name.to_owned())) { continue; }
        signed_in |= ["LOGIN_INFO", "SID", "__Secure-3PSID"].contains(&name);
        let expiry = cookie.expires_datetime().map(|d| d.unix_timestamp().max(0)).unwrap_or(0);
        out.push_str(&format!(".{}\tTRUE\t{}\t{}\t{}\t{}\t{}\n", host,
            path,
            if cookie.secure().unwrap_or(false) { "TRUE" } else { "FALSE" }, expiry, name, value));
    }
    signed_in.then_some(out)
}

// Returns true when the window holds a signed-in session and the file was written.
fn save_session(window: &tauri::WebviewWindow, dir: &Path) -> Result<bool, String> {
    let mut cookies = Vec::new();
    for url in SESSION_URLS {
        cookies.extend(window.cookies_for_url(url.parse().unwrap()).map_err(|e| e.to_string())?);
    }
    let Some(content) = cookie_file_content(&cookies) else { return Ok(false); };
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    let path = session_file(dir);
    temp.persist(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
async fn open_youtube(app: tauri::AppHandle, engine: tauri::State<'_, Engine>, sign_in: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("youtube") {
        if sign_in { window.navigate(YOUTUBE_SIGN_IN.parse().unwrap()).map_err(|e| e.to_string())?; }
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let address = if sign_in { YOUTUBE_SIGN_IN } else { "https://www.youtube.com/" };
    let url = address.parse().map_err(|e| format!("Invalid YouTube address: {e}"))?;
    let dir = engine.dir.clone();
    let builder = tauri::WebviewWindowBuilder::new(&app, "youtube", tauri::WebviewUrl::External(url))
        .title("YouTube · Deviload")
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 540.0)
        .on_page_load(move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished { return; }
            let host = payload.url().host_str().unwrap_or("").to_ascii_lowercase();
            if host != "youtube.com" && !host.ends_with(".youtube.com") { return; }
            let dir = dir.clone();
            // Reading cookies on the page-load thread deadlocks WebView2.
            thread::spawn(move || {
                if let Ok(true) = save_session(&window, &dir) {
                    let _ = window.app_handle().emit("youtube-session", true);
                    if sign_in { let _ = window.close(); }
                }
            });
        });
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(youtube_profile(&app)?);
    builder.build().map(|_| ()).map_err(|e| format!("Could not open YouTube: {e}"))
}

#[tauri::command]
fn youtube_login_status(engine: tauri::State<Engine>) -> Option<String> {
    let path = session_file(&engine.dir);
    if path.is_file() { Some(path.to_string_lossy().into()) } else { None }
}

#[tauri::command]
async fn youtube_sign_out(app: tauri::AppHandle, engine: tauri::State<'_, Engine>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("youtube") { let _ = window.destroy(); }
    let file = session_file(&engine.dir);
    if file.exists() { fs::remove_file(&file).map_err(|e| format!("Could not remove the saved sign-in: {e}"))?; }
    let profile = youtube_profile(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // WebView2 can hold the profile for a moment after the window closes.
        for _ in 0..20 {
            if !profile.exists() || fs::remove_dir_all(&profile).is_ok() { return; }
            thread::sleep(Duration::from_millis(250));
        }
        let _ = fs::write(profile.with_extension("delete"), b"");
    }).await.map_err(|e| e.to_string())?;
    let _ = app.emit("youtube-session", false);
    Ok(())
}

#[tauri::command]
fn diagnostics() -> Vec<(String, bool)> {
    ["yt-dlp", "ffmpeg", "ffprobe", "deno"].iter().map(|s| (s.to_string(), binary(s).is_ok())).collect()
}

fn ytdlp_version(exe: &Path) -> Result<String, String> {
    let output = command(exe).arg("--version").output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[tauri::command]
async fn ytdlp_info() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| ytdlp_version(&binary("yt-dlp")?)).await.map_err(|e| e.to_string())?
}

// Library tags, Devil Cut projects and player positions, kept next to the queue.
const STORE_SECTIONS: [&str; 3] = ["library", "projects", "positions"];
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn read_store(dir: &Path) -> serde_json::Map<String, serde_json::Value> {
    fs::read(dir.join("library.json")).ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

#[tauri::command]
fn ui_store(engine: tauri::State<Engine>) -> serde_json::Value {
    let _guard = STORE_LOCK.lock().unwrap();
    serde_json::Value::Object(read_store(&engine.dir))
}

#[tauri::command]
fn save_ui_store(section: String, value: serde_json::Value, engine: tauri::State<Engine>) -> Result<(), String> {
    if !STORE_SECTIONS.contains(&section.as_str()) || !value.is_object() { return Err("Unknown library section".into()); }
    if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 4_000_000 { return Err("Library data is too large".into()); }
    let _guard = STORE_LOCK.lock().unwrap();
    let mut store = read_store(&engine.dir);
    store.insert(section, value);
    write_store(&engine.dir, &store)
}

fn write_store(dir: &Path, store: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(dir.join("library.json")).map_err(|e| e.to_string())?;
    Ok(())
}

fn stored_proxy(dir: &Path) -> String {
    read_store(dir).get("network").and_then(|network| network["proxy"].as_str())
        .and_then(|proxy| model::parse_proxy(proxy).ok()).unwrap_or_default()
}

#[tauri::command]
fn set_proxy(proxy: String, engine: tauri::State<Engine>) -> Result<String, String> {
    let proxy = model::parse_proxy(&proxy)?;
    {
        let _guard = STORE_LOCK.lock().unwrap();
        let mut store = read_store(&engine.dir);
        store.insert("network".into(), serde_json::json!({"proxy": proxy}));
        write_store(&engine.dir, &store)?;
    }
    *PROXY.lock().unwrap() = proxy.clone();
    Ok(proxy)
}

// Devil Cut projects are saved one at a time, so the editor window and the
// main window never overwrite each other's changes. `None` deletes.
#[tauri::command]
fn save_ui_project(id: String, project: Option<serde_json::Value>, engine: tauri::State<Engine>, app: tauri::AppHandle) -> Result<(), String> {
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) {
        return Err("Unknown library section".into());
    }
    if let Some(value) = &project {
        if !value.is_object() || serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > 1_000_000 {
            return Err("Library data is too large".into());
        }
    }
    {
        let _guard = STORE_LOCK.lock().unwrap();
        let mut store = read_store(&engine.dir);
        let projects = store.entry("projects").or_insert_with(|| serde_json::json!({}));
        if !projects.is_object() { *projects = serde_json::json!({}); }
        let map = projects.as_object_mut().unwrap();
        match project { Some(value) => { map.insert(id, value); } None => { map.remove(&id); } }
        write_store(&engine.dir, &store)?;
    }
    let _ = app.emit("devilcut-projects", ());
    Ok(())
}

// Devil Cut lives in its own window; later calls focus it and pass the request on.
#[tauri::command]
async fn open_devil_cut(app: tauri::AppHandle, job: Option<u64>, project: Option<String>) -> Result<(), String> {
    let query = match (job, project) {
        (Some(id), _) => format!("job={id}"),
        (None, Some(id)) if !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) => format!("project={id}"),
        _ => String::new(),
    };
    if let Some(window) = app.get_webview_window("devilcut") {
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
        if !query.is_empty() { app.emit_to("devilcut", "devilcut-open", query).map_err(|e| e.to_string())?; }
        return Ok(());
    }
    let page = if query.is_empty() { "cut.html".to_owned() } else { format!("cut.html?{query}") };
    let window = tauri::WebviewWindowBuilder::new(&app, "devilcut", tauri::WebviewUrl::App(page.into()))
        .title("Devil Cut · Deviload")
        .inner_size(1360.0, 860.0)
        .min_inner_size(980.0, 640.0)
        .theme(Some(tauri::Theme::Dark))
        .build().map_err(|e| format!("Could not open Devil Cut: {e}"))?;
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) { let _ = window.set_icon(icon); }
    let _ = window.maximize();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineUpdate { before: String, after: String }

// YouTube changes often; the nightly channel gets fixes first.
#[tauri::command]
async fn update_ytdlp() -> Result<EngineUpdate, String> {
    tauri::async_runtime::spawn_blocking(update_engine).await.map_err(|e| e.to_string())?
}

fn update_engine() -> Result<EngineUpdate, String> {
    let exe = binary("yt-dlp")?;
    let before = ytdlp_version(&exe)?;
    let output = ytdlp_command(&exe).args(["--update-to", "nightly"]).stdin(Stdio::null())
        .output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("").trim();
        return Err(format!("yt-dlp could not update itself: {}", detail.chars().take(280).collect::<String>()));
    }
    Ok(EngineUpdate { before, after: ytdlp_version(&exe)? })
}

#[tauri::command]
fn now_seconds() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs()
}

fn ready_to_run(job: &Job, now: u64) -> bool {
    job.status == "queued" && job.scheduled_at.is_none_or(|when| when <= now)
}
fn transient_download_error(log: &[String]) -> bool {
    let detail = log.iter().rev().take(20).rev().cloned().collect::<Vec<_>>().join(" ").to_ascii_lowercase();
    if ["login", "sign in", "private video", "copyright", "video unavailable",
        "unsupported url", "cookies", "permission denied"].iter().any(|word| detail.contains(word)) {
        return false;
    }
    ["timed out", "timeout", "connection reset", "connection refused",
        "temporary failure", "network is unreachable", "http error 429",
        "http error 502", "http error 503", "http error 504"].iter()
        .any(|word| detail.contains(word))
}
fn schedule_retry(job: &mut Job) -> bool {
    if !job.auto_retry || job.retry_attempts >= 2 || !transient_download_error(&job.log) {
        return false;
    }
    let wait = if job.retry_attempts == 0 { 30 } else { 120 };
    job.retry_attempts += 1;
    job.scheduled_at = Some(now_seconds() + wait);
    job.status = "queued".into();
    job.percent = 0.0;
    job.speed.clear();
    job.file.clear();
    job.consume(&format!("Auto-retry in {wait} seconds (attempt {}/2)", job.retry_attempts));
    true
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preflight {
    ready: bool,
    blockers: Vec<String>,
    warnings: Vec<String>,
    available_bytes: Option<u64>,
    estimated_bytes: Option<u64>,
}

fn check_preflight(text: &str, options: &Options, estimated_bytes: Option<u64>, jobs: &[Job]) -> Result<Preflight, String> {
    options.validate()?;
    let urls = model::parse_urls(text)?;
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    if !options.format_id.is_empty() && urls.len() != 1 {
        blockers.push("The selected stream fits only a single link.".into());
    }
    for name in ["yt-dlp", "ffmpeg", "ffprobe", "deno"] {
        if binary(name).is_err() { blockers.push(format!("{name} was not found next to the app or in PATH.")); }
    }
    let folder = PathBuf::from(&options.folder);
    let mut available_bytes = None;
    match fs::create_dir_all(&folder) {
        Ok(()) => {
            match tempfile::Builder::new().prefix(".deviload-preflight-").tempfile_in(&folder) {
                Ok(_) => {},
                Err(error) => blockers.push(format!("The save folder is not writable: {error}")),
            }
            if let Ok(free) = fs2::available_space(&folder) {
                available_bytes = Some(free);
                if free < 256 * 1024 * 1024 { blockers.push("Less than 256 MB free on the disk.".into()); }
                else if free < 1024 * 1024 * 1024 { warnings.push("Less than 1 GB free on the disk.".into()); }
                if let Some(size) = estimated_bytes {
                    if size.saturating_add(256 * 1024 * 1024) > free {
                        blockers.push("By estimate the source will not fit on the disk with a 256 MB margin.".into());
                    }
                }
            } else { warnings.push("Could not determine the free disk space.".into()); }
        },
        Err(error) => blockers.push(format!("Could not open the save folder: {error}")),
    }
    let duplicates = urls.iter().filter(|url| jobs.iter().any(|job| job.url == **url &&
        ["queued", "running", "paused", "done"].contains(&job.status.as_str()))).count();
    if duplicates > 0 { warnings.push(format!("Already in the history or the queue: {duplicates} links.")); }
    if estimated_bytes.is_none() { warnings.push("Size unknown: the source may report it only during the download.".into()); }
    Ok(Preflight { ready: blockers.is_empty(), blockers, warnings, available_bytes, estimated_bytes })
}

#[tauri::command]
fn preflight_download(text: String, options: Options, estimated_bytes: Option<u64>, engine: tauri::State<'_, Engine>) -> Result<Preflight, String> {
    let jobs = engine.data.lock().unwrap().jobs.clone();
    check_preflight(&text, &options, estimated_bytes.filter(|size| *size <= 1_000_000_000_000), &jobs)
}

// Links already waiting or downloading are not added twice.
fn queue_urls(d: &mut Snapshot, urls: Vec<String>, options: &Options, scheduled_at: Option<u64>, auto_retry: bool) -> usize {
    let mut next_id = d.jobs.iter().map(|j| j.id).max().unwrap_or(0) + 1;
    let mut count = 0;
    for url in urls {
        if d.jobs.iter().any(|j| j.url == url && ["queued", "running", "cancelling", "pausing", "paused"].contains(&j.status.as_str())) { continue; }
        d.jobs.push(Job { id: next_id, url, options: options.clone(), status: "queued".into(),
            percent: 0.0, speed: String::new(), file: String::new(), log: vec![], scheduled_at, auto_retry, retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], pid: None, hidden_in_queue: false, hidden_in_library: false });
        next_id += 1; count += 1;
    }
    count
}

#[tauri::command]
fn enqueue(text: String, options: Options, parallel: usize, scheduled_at: Option<u64>, auto_retry: bool, engine: tauri::State<Engine>) -> Result<usize, String> {
    options.validate()?;
    let urls = model::parse_urls(&text)?;
    if !options.format_id.is_empty() && urls.len() != 1 {
        return Err("The selected stream belongs to one link. For several links choose a standard quality.".into());
    }
    if !(1..=8).contains(&parallel) { return Err("Parallel downloads: from 1 to 8".into()); }
    if scheduled_at.is_some_and(|when| when > now_seconds() + 365 * 24 * 3600) {
        return Err("Scheduling is limited to one year ahead".into());
    }
    // Fail before accepting tasks when the environment is incomplete.
    for name in ["yt-dlp", "ffmpeg", "ffprobe", "deno"] { binary(name)?; }
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    let count = queue_urls(&mut d, urls, &options, scheduled_at, auto_retry);
    d.options = options; d.parallel = parallel;
    if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    Ok(count)
}

// Deviload 1.x was a portable PowerShell app that kept its history, settings and
// download archive next to its own files. Cookies are never carried over.
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LegacyImport { files: usize, settings: bool, archive: usize, language: String }

fn read_legacy_json(path: &Path) -> Option<serde_json::Value> {
    let bytes = fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn is_legacy_folder(dir: &Path) -> bool {
    dir.join("YT-Downloader.ps1").is_file()
        && (dir.join("history.json").is_file() || dir.join("ui-settings.json").is_file())
}

fn legacy_quality(file: &str) -> &'static str {
    match Path::new(file).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mp3") => "mp3", Some("flac") => "flac", Some("wav") => "wav", _ => "best",
    }
}

fn import_legacy_into(legacy: &Path, data: &mut Snapshot, archive_dir: &Path) -> Result<LegacyImport, String> {
    if !is_legacy_folder(legacy) { return Err("This folder does not contain Deviload 1.x".into()); }
    let mut result = LegacyImport::default();
    if let Some(saved) = read_legacy_json(&legacy.join("ui-settings.json")) {
        let index = |key: &str| saved[key].as_u64().map(|value| value as usize);
        let options = &mut data.options;
        if let Some(folder) = saved["folder"].as_str().filter(|folder| Path::new(folder).is_absolute() && Path::new(folder).is_dir()) {
            options.folder = folder.into();
        }
        if let Some(quality) = index("quality").and_then(|i| ["best", "1080", "720", "480", "mp3", "flac"].get(i)) {
            options.quality = (*quality).into();
        }
        if let Some(value) = saved["playlist"].as_bool() { options.playlist = value; }
        if let Some(value) = saved["splitChapters"].as_bool() { options.split_chapters = value; }
        if let Some(value) = saved["sponsorblock"].as_bool() { options.sponsorblock = value; }
        if let Some(value) = saved["subsOn"].as_bool() { options.subtitles = value; }
        if let Some(value) = saved["archive"].as_bool() { options.archive = value; }
        if let Some(rate) = index("rate").and_then(|i| [0, 1, 3, 5, 10].get(i)) { options.rate_mbps = *rate; }
        if let Some(parallel) = index("parallel").filter(|i| *i < 3) { data.parallel = parallel + 1; }
        result.language = saved["lang"].as_str().filter(|lang| ["ru", "en"].contains(lang)).unwrap_or_default().into();
        result.settings = true;
    }
    if let Some(history) = read_legacy_json(&legacy.join("history.json")) {
        let items = match history { serde_json::Value::Array(items) => items, item @ serde_json::Value::Object(_) => vec![item], _ => vec![] };
        let mut next_id = data.jobs.iter().map(|j| j.id).max().unwrap_or(0) + 1;
        // Newest first in the old file; the newest item gets the highest id here.
        for item in items.iter().rev() {
            let Some(file) = item["path"].as_str().filter(|file| Path::new(file).is_file()) else { continue };
            if data.jobs.iter().any(|job| job.file == file) { continue; }
            let url = item["url"].as_str().and_then(|url| model::parse_urls(url).ok())
                .and_then(|urls| urls.into_iter().next()).unwrap_or_default();
            let options = Options { quality: legacy_quality(file).into(), archive: false, ..data.options.clone() };
            let mut job = Job { id: next_id, url, options, status: "done".into(), percent: 100.0, speed: String::new(),
                file: file.into(), log: vec![], scheduled_at: None, auto_retry: false, retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], pid: None, hidden_in_queue: false, hidden_in_library: false };
            job.log.push("Moved from Deviload 1.x".into());
            data.jobs.push(job);
            next_id += 1;
            result.files += 1;
        }
    }
    if let Ok(text) = fs::read_to_string(legacy.join("download-archive.txt")) {
        let target = archive_dir.join(format!("archive-{}.txt", data.options.quality));
        let known: HashSet<String> = fs::read_to_string(&target).unwrap_or_default().lines().map(str::to_owned).collect();
        let fresh: Vec<&str> = text.lines().map(str::trim)
            .filter(|line| line.split(' ').count() == 2 && line.len() <= 200 && !known.contains(*line))
            .collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        if !fresh.is_empty() {
            let mut file = fs::OpenOptions::new().create(true).append(true).open(&target).map_err(|e| e.to_string())?;
            let mut chunk = fresh.join("\n");
            chunk.push('\n');
            file.write_all(chunk.as_bytes()).map_err(|e| e.to_string())?;
            result.archive = fresh.len();
        }
    }
    Ok(result)
}

fn legacy_candidates() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = [dirs::download_dir(), dirs::desktop_dir(), dirs::document_dir(), dirs::home_dir()]
        .into_iter().flatten().collect();
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
        if let Some(parent) = exe_dir.parent() { roots.push(parent.to_path_buf()); }
        roots.push(exe_dir);
    }
    let mut found = vec![];
    for dir in roots {
        if is_legacy_folder(&dir) { found.push(dir.clone()); }
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten().take(400) {
            let path = entry.path();
            if path.is_dir() && is_legacy_folder(&path) { found.push(path); }
        }
    }
    found.dedup();
    found
}

#[tauri::command]
async fn find_legacy() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| legacy_candidates().into_iter().next().map(|p| p.to_string_lossy().into_owned()))
        .await.ok().flatten()
}

#[tauri::command]
fn import_legacy(folder: String, engine: tauri::State<Engine>) -> Result<LegacyImport, String> {
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    let result = import_legacy_into(Path::new(&folder), &mut d, &engine.dir)?;
    if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    Ok(result)
}

#[tauri::command]
fn change_job(id: u64, action: String, engine: tauri::State<Engine>) -> Result<(), String> {
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    let j = d.jobs.iter_mut().find(|j| j.id == id).ok_or("Task not found")?;
    match action.as_str() {
        "pause" if j.status == "queued" => j.status = "paused".into(),
        "pause" if j.status == "running" => j.status = "pausing".into(),
        "resume" if j.status == "paused" => { j.status = "queued".into(); j.percent = 0.0; j.speed.clear(); },
        "cancel" if j.status == "paused" => j.status = "cancelled".into(),
        "cancel" if j.status == "queued" => j.status = "cancelled".into(),
        "cancel" if j.status == "running" => j.status = "cancelling".into(),
        "retry" if ["error", "cancelled", "interrupted"].contains(&j.status.as_str()) => {
            j.status = "queued".into(); j.percent = 0.0; j.log.clear(); j.speed.clear(); j.file.clear(); j.scheduled_at = None; j.retry_attempts = 0;
            j.healed.clear();
        }
        // Without the archive yt-dlp fetches what it skipped; files still on the disk are not downloaded twice.
        "again" if j.status == "done" && j.archived > 0 => {
            j.status = "queued".into(); j.percent = 0.0; j.log.clear(); j.speed.clear(); j.file.clear(); j.scheduled_at = None;
            j.retry_attempts = 0; j.archived = 0; j.options.archive = false; j.healed.clear();
        }
        _ => return Err("This action is not available in the current state".into()),
    }
    if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    Ok(())
}

#[tauri::command]
fn move_job(id: u64, direction: String, engine: tauri::State<Engine>) -> Result<(), String> {
    let mut data = engine.data.lock().unwrap();
    let old = data.clone();
    let from = data.jobs.iter().position(|job| job.id == id).ok_or("Task not found")?;
    if !["queued", "paused"].contains(&data.jobs[from].status.as_str()) {
        return Err("Only waiting tasks can be moved".into());
    }
    let target = match direction.as_str() {
        "up" => (0..from).rev().find(|&index| ["queued", "paused"].contains(&data.jobs[index].status.as_str())),
        "down" => ((from + 1)..data.jobs.len()).find(|&index| ["queued", "paused"].contains(&data.jobs[index].status.as_str())),
        _ => return Err("Unknown direction".into()),
    };
    if let Some(to) = target {
        data.jobs.swap(from, to);
        if let Err(error) = save(&engine.dir, &data) { *data = old; return Err(error); }
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorInfo {
    file_name: String,
    duration: f64,
    thumbnails: Vec<String>,
}

fn completed_video(engine: &Engine, id: u64) -> Result<PathBuf, String> {
    let file = {
        let d = engine.data.lock().unwrap();
        let job = d.jobs.iter().find(|j| j.id == id).ok_or("Task not found")?;
        if job.status != "done" || job.file.is_empty() { return Err("Finish downloading the video first".into()); }
        PathBuf::from(&job.file)
    };
    let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["mkv", "mp4", "mov", "webm", "m4v"].contains(&ext.as_str()) {
        return Err("Devil Cut works with MKV, MP4, MOV and WebM video files for now".into());
    }
    if !file.is_file() { return Err("The video is no longer at the saved path".into()); }
    Ok(file)
}

fn completed_media(engine: &Engine, id: u64) -> Result<PathBuf, String> {
    let file = {
        let d = engine.data.lock().unwrap();
        let job = d.jobs.iter().find(|j| j.id == id).ok_or("Task not found")?;
        if job.status != "done" || job.file.is_empty() { return Err("The file is not ready yet".into()); }
        PathBuf::from(&job.file)
    };
    let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["mkv", "mp4", "mov", "webm", "m4v", "mp3", "flac", "wav", "m4a", "ogg", "opus", "aac", "gif"].contains(&ext.as_str()) {
        return Err("The built-in player does not support this file format".into());
    }
    file.canonicalize().map_err(|_| "The file is no longer at the saved path".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerChapter { start: f64, title: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerMetadata {
    chapters: Vec<PlayerChapter>,
    subtitles: Option<String>,
    subtitle_language: Option<String>,
}

fn read_player_metadata(file: &Path) -> Result<PlayerMetadata, String> {
    let probe = binary("ffprobe")?;
    let output = command(&probe).args(["-v", "error", "-show_chapters", "-show_streams", "-of", "json"])
        .arg(file).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("FFprobe could not read chapters and subtitles".into()); }
    let info: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let chapters = info["chapters"].as_array().into_iter().flatten().filter_map(|entry| {
        let start = entry["start_time"].as_str()?.parse::<f64>().ok()?;
        if !start.is_finite() || start < 0.0 { return None; }
        let title = entry["tags"]["title"].as_str().unwrap_or("").to_owned();
        Some(PlayerChapter { start, title })
    }).take(300).collect();
    let streams = info["streams"].as_array();
    let subtitle = streams.into_iter().flatten().find(|entry| {
        entry["codec_type"].as_str() == Some("subtitle") &&
            !["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"]
                .contains(&entry["codec_name"].as_str().unwrap_or(""))
    });
    let mut result = PlayerMetadata { chapters, subtitles: None, subtitle_language: None };
    let ffmpeg = binary("ffmpeg")?;
    if let Some(stream) = subtitle {
        if let Some(index) = stream["index"].as_u64() {
            let output = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(file).args(["-map", &format!("0:{index}"), "-f", "webvtt", "-"])
                .output().map_err(|e| e.to_string())?;
            if output.status.success() && !output.stdout.is_empty() && output.stdout.len() <= 2_000_000 {
                result.subtitles = Some("data:text/vtt;base64,".to_owned() +
                    &base64::engine::general_purpose::STANDARD.encode(output.stdout));
                result.subtitle_language = stream["tags"]["language"].as_str().map(str::to_owned);
            }
        }
    }
    if result.subtitles.is_none() {
        let stem = file.file_stem().unwrap_or_default().to_string_lossy();
        if let Some(parent) = file.parent() {
            if let Ok(entries) = fs::read_dir(parent) {
                for entry in entries.flatten().take(500) {
                    let path = entry.path();
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if !name.starts_with(&format!("{stem}.")) ||
                        !["vtt", "srt"].contains(&path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str()) {
                        continue;
                    }
                    if path.metadata().map_or(true, |metadata| metadata.len() > 2_000_000) { continue; }
                    let output = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-i"])
                        .arg(&path).args(["-f", "webvtt", "-"]).output().map_err(|e| e.to_string())?;
                    if output.status.success() && !output.stdout.is_empty() && output.stdout.len() <= 2_000_000 {
                        result.subtitles = Some("data:text/vtt;base64,".to_owned() +
                            &base64::engine::general_purpose::STANDARD.encode(output.stdout));
                        result.subtitle_language = subtitle_file_language(&stem, &name);
                        break;
                    }
                }
            }
        }
    }
    Ok(result)
}

fn subtitle_file_language(stem: &str, name: &str) -> Option<String> {
    let middle = name.strip_prefix(stem)?.strip_prefix('.')?;
    let language = middle.rsplit_once('.')?.0;
    (!language.is_empty() && language.len() <= 12 && language.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .then(|| language.to_owned())
}

#[tauri::command]
async fn player_metadata(id: u64, engine: tauri::State<'_, Engine>) -> Result<PlayerMetadata, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_player_metadata(&completed_video(&engine, id)?))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn media_source(id: u64, engine: tauri::State<'_, Engine>, app: tauri::AppHandle) -> Result<String, String> {
    let file = completed_media(&engine, id)?;
    app.asset_protocol_scope().allow_file(&file).map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioInfo {
    file_name: String,
    duration: Option<f64>,
    title: String,
    artist: String,
    album: String,
    track: String,
}

#[derive(Deserialize)]
struct AudioTags { title: String, artist: String, album: String, track: String }

fn audio_file(engine: &Engine, id: u64) -> Result<PathBuf, String> {
    let file = completed_media(engine, id)?;
    let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["mp3", "flac", "wav"].contains(&ext.as_str()) {
        return Err("Audio tools support MP3, FLAC and WAV".into());
    }
    Ok(file)
}

fn read_audio_info(file: &Path) -> Result<AudioInfo, String> {
    let probe = binary("ffprobe")?;
    let output = command(&probe).args(["-v", "error", "-show_entries",
        "format=duration:format_tags=title,artist,album,track", "-of", "json"])
        .arg(file).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("Could not read the audio tags".into()); }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let format = &value["format"];
    let tags = &format["tags"];
    let tag = |key: &str| tags.get(key).and_then(|v| v.as_str()).unwrap_or("").to_owned();
    Ok(AudioInfo {
        file_name: file.file_name().unwrap_or_default().to_string_lossy().into(),
        duration: format["duration"].as_str().and_then(|v| v.parse().ok()),
        title: tag("title"), artist: tag("artist"), album: tag("album"), track: tag("track"),
    })
}

fn checked_tag(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > 200 || value.chars().any(char::is_control) {
        return Err("A tag must not contain control characters or be longer than 200 characters".into());
    }
    Ok(value.to_owned())
}

fn save_audio_tags(file: &Path, tags: AudioTags) -> Result<PathBuf, String> {
    let title = checked_tag(&tags.title)?;
    let artist = checked_tag(&tags.artist)?;
    let album = checked_tag(&tags.album)?;
    let track = checked_tag(&tags.track)?;
    let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("mp3");
    let output = new_output_path(file, "Tagged", ext)?;
    let ffmpeg = binary("ffmpeg")?;
    let result = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i"])
        .arg(file).args(["-map", "0", "-c", "copy", "-metadata", &format!("title={title}"),
            "-metadata", &format!("artist={artist}"), "-metadata", &format!("album={album}"),
            "-metadata", &format!("track={track}")])
        .arg(&output).output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        let _ = fs::remove_file(&output);
        return Err(format!("Could not save the tags: {}", String::from_utf8_lossy(&result.stderr).chars().take(400).collect::<String>()));
    }
    Ok(output)
}

fn normalize_audio(file: &Path) -> Result<PathBuf, String> {
    let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    let codec = match ext.as_str() {
        "mp3" => "libmp3lame", "flac" => "flac", "wav" => "pcm_s16le",
        _ => return Err("Normalization supports MP3, FLAC and WAV".into()),
    };
    let output = new_output_path(file, "Normalized", &ext)?;
    let ffmpeg = binary("ffmpeg")?;
    let result = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i"])
        .arg(file).args(["-map", "0:a:0", "-map_metadata", "0", "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", codec])
        .arg(&output).output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        let _ = fs::remove_file(&output);
        return Err(format!("Could not normalize the audio: {}", String::from_utf8_lossy(&result.stderr).chars().take(400).collect::<String>()));
    }
    Ok(output)
}

#[tauri::command]
async fn audio_info(id: u64, engine: tauri::State<'_, Engine>) -> Result<AudioInfo, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_audio_info(&audio_file(&engine, id)?))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn audio_save_tags(id: u64, tags: AudioTags, engine: tauri::State<'_, Engine>) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_audio_tags(&audio_file(&engine, id)?, tags).map(|p| p.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn audio_normalize(id: u64, engine: tauri::State<'_, Engine>) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        normalize_audio(&audio_file(&engine, id)?).map(|p| p.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}
fn video_duration(file: &Path) -> Result<f64, String> {
    let probe = binary("ffprobe")?;
    let output = command(&probe).args(["-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1"]).arg(file).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("FFprobe could not read the video duration".into()); }
    let duration: f64 = String::from_utf8_lossy(&output.stdout).trim().parse()
        .map_err(|_| "Could not determine the video duration".to_string())?;
    if !duration.is_finite() || duration <= 0.0 { return Err("Invalid video duration".into()); }
    Ok(duration)
}

#[tauri::command]
async fn editor_info(id: u64, frames: Option<u32>, engine: tauri::State<'_, Engine>) -> Result<EditorInfo, String> {
    let engine = engine.inner().clone();
    let count = frames.unwrap_or(4).clamp(4, 16);
    tauri::async_runtime::spawn_blocking(move || {
        let file = completed_video(&engine, id)?;
        let duration = video_duration(&file)?;
        let ffmpeg = binary("ffmpeg")?;
        let mut thumbnails = Vec::new();
        for index in 0..count {
            let fraction = (index as f64 + 0.5) / count as f64;
            let second = (duration * fraction).min((duration - 0.05).max(0.0));
            let output = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-ss", &second.to_string(), "-i"])
                .arg(&file).args(["-frames:v", "1", "-vf", "scale=200:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"])
                .output().map_err(|e| e.to_string())?;
            if output.status.success() && !output.stdout.is_empty() && output.stdout.len() < 1_000_000 {
                thumbnails.push("data:image/jpeg;base64,".to_owned() + &base64::engine::general_purpose::STANDARD.encode(output.stdout));
            }
        }
        Ok(EditorInfo { file_name: file.file_name().unwrap_or_default().to_string_lossy().into(), duration, thumbnails })
    }).await.map_err(|e| e.to_string())?
}

// A picture of the sound for the timeline; empty when the file has no audio.
#[tauri::command]
async fn editor_waveform(id: u64, engine: tauri::State<'_, Engine>) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = completed_media(&engine, id)?;
        if !media_has_audio(&file)? { return Ok(String::new()); }
        let output = command(&binary("ffmpeg")?).args(["-hide_banner", "-loglevel", "error", "-i"]).arg(&file)
            .args(["-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1600x72:colors=0xffb08f:scale=sqrt",
                "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"])
            .output().map_err(|e| e.to_string())?;
        if !output.status.success() || output.stdout.is_empty() || output.stdout.len() > 2_000_000 { return Ok(String::new()); }
        Ok("data:image/png;base64,".to_owned() + &base64::engine::general_purpose::STANDARD.encode(output.stdout))
    }).await.map_err(|e| e.to_string())?
}

fn new_output_path(file: &Path, suffix: &str, extension: &str) -> Result<PathBuf, String> {
    let stem = file.file_stem().unwrap_or_default().to_string_lossy();
    for index in 1..10000 {
        let number = if index == 1 { String::new() } else { format!(" {index}") };
        let path = file.with_file_name(format!("{stem} - Devil Cut {suffix}{number}.{extension}"));
        if !path.exists() { return Ok(path); }
    }
    Err("Could not pick a name for the new file".into())
}

fn caption_font() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)] {
        let fonts = PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into())).join("Fonts");
        candidates.extend(["segoeuib.ttf", "arialbd.ttf", "arial.ttf"].map(|name| fonts.join(name)));
    }
    #[cfg(target_os = "macos")]
    candidates.extend(["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf"].map(PathBuf::from));
    #[cfg(all(unix, not(target_os = "macos")))]
    candidates.extend(["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"].map(PathBuf::from));
    candidates.into_iter().find(|path| path.is_file())
}

// Filter option values: quote the path and escape the option separator.
fn filter_path(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/").replace(':', "\\:").replace('\'', "'\\''");
    format!("'{text}'")
}

// Runs FFmpeg with -progress on stdout and reports the finished share of `seconds`.
fn run_ffmpeg(cmd: Command, seconds: f64, progress: &dyn Fn(f64)) -> Result<(), String> {
    run_ffmpeg_tracked(cmd, seconds, progress, &|_| {})
}

// The same, telling `started` the process id so another command can stop it.
fn run_ffmpeg_tracked(mut cmd: Command, seconds: f64, progress: &dyn Fn(f64), started: &dyn Fn(u32)) -> Result<(), String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    started(child.id());
    let stderr = child.stderr.take().unwrap();
    let errors = thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut text);
        text
    });
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        let value = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="));
        if let Some(micros) = value.and_then(|value| value.trim().parse::<f64>().ok()) {
            if seconds > 0.0 { progress((micros / 1_000_000.0 / seconds).clamp(0.0, 1.0)); }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let detail = errors.join().unwrap_or_default();
    if status.success() {
        progress(1.0);
        return Ok(());
    }
    let tail: Vec<char> = detail.trim().chars().collect();
    Err(tail[tail.len().saturating_sub(600)..].iter().collect())
}

fn ffmpeg_command() -> Result<Command, String> {
    let mut cmd = command(&binary("ffmpeg")?);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-progress", "pipe:1", "-nostats", "-n"]);
    Ok(cmd)
}

// A Devil Cut project: clips in order, each with its own look, one canvas,
// optional music, rendered by FFmpeg in a single pass.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ClipLook {
    speed: f64,
    volume: f64,
    fade_in: bool,
    fade_out: bool,
    rotate: u16,
    flip: bool,
    brightness: f64,
    contrast: f64,
    saturation: f64,
    caption: String,
    caption_position: String,
    caption_style: String,
    // How this clip enters from the previous one; ignored on the first clip.
    transition: String,
}

const TRANSITIONS: [&str; 6] = ["none", "fade", "fadeblack", "slideleft", "wipeleft", "circleopen"];

impl Default for ClipLook {
    fn default() -> Self {
        Self { speed: 1.0, volume: 1.0, fade_in: false, fade_out: false, rotate: 0, flip: false,
            brightness: 0.0, contrast: 1.0, saturation: 1.0, caption: String::new(),
            caption_position: "bottom".into(), caption_style: "outline".into(), transition: "none".into() }
    }
}

impl ClipLook {
    fn validate(&self) -> Result<(), String> {
        if ![0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].contains(&self.speed) { return Err("Unknown playback speed".into()); }
        if !self.volume.is_finite() || !(0.0..=2.0).contains(&self.volume) { return Err("Volume must be between 0 and 200%".into()); }
        if ![0, 90, 180, 270].contains(&self.rotate) { return Err("Rotation must be 0, 90, 180 or 270 degrees".into()); }
        let color = [(self.brightness, -0.5, 0.5), (self.contrast, 0.5, 2.0), (self.saturation, 0.0, 3.0)];
        if color.iter().any(|(value, low, high)| !value.is_finite() || value < low || value > high) {
            return Err("Color settings are out of range".into());
        }
        if self.caption.chars().count() > 120 || self.caption.chars().any(|c| c.is_control() && c != '\n') {
            return Err("A caption must be up to 120 characters without control characters".into());
        }
        if !["top", "center", "bottom"].contains(&self.caption_position.as_str()) { return Err("Unknown caption position".into()); }
        if !["outline", "box"].contains(&self.caption_style.as_str()) { return Err("Unknown caption style".into()); }
        if !TRANSITIONS.contains(&self.transition.as_str()) { return Err("Unknown transition".into()); }
        Ok(())
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectClip { job_id: u64, start: f64, end: f64, #[serde(default)] look: ClipLook }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMusic { job_id: u64, #[serde(default = "default_music_volume")] volume: f64 }
fn default_music_volume() -> f64 { 0.35 }

// Sound taken off a clip: a part of a file that plays from `at` seconds of the project.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectAudio {
    job_id: u64,
    start: f64,
    end: f64,
    at: f64,
    #[serde(default = "unit")] speed: f64,
    #[serde(default = "unit")] volume: f64,
    #[serde(default)] fade_in: bool,
    #[serde(default)] fade_out: bool,
}
fn unit() -> f64 { 1.0 }
const MAX_AUDIO_PIECES: usize = 40;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ProjectExport { clips: Vec<ProjectClip>, canvas: String, fit: String, music: Option<ProjectMusic>, audio: Vec<ProjectAudio>, format: String, quality: u32 }

impl Default for ProjectExport {
    fn default() -> Self {
        Self { clips: vec![], canvas: "16:9".into(), fit: "fit".into(), music: None, audio: vec![], format: "mp4".into(), quality: 1080 }
    }
}

struct Source { path: PathBuf, duration: f64, has_audio: bool, width: u32, height: u32 }

fn probe_source(path: &Path) -> Result<Source, String> {
    let probe = binary("ffprobe")?;
    let output = command(&probe).args(["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json"])
        .arg(path).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("FFprobe could not read the video duration".into()); }
    let info: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let streams = info["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|stream| stream["codec_type"] == "video").ok_or("The file has no video track")?;
    let duration: f64 = info["format"]["duration"].as_str().and_then(|value| value.parse().ok())
        .ok_or("Could not determine the video duration")?;
    Ok(Source {
        path: path.to_path_buf(), duration,
        has_audio: streams.iter().any(|stream| stream["codec_type"] == "audio"),
        width: video["width"].as_u64().unwrap_or(1280) as u32,
        height: video["height"].as_u64().unwrap_or(720) as u32,
    })
}

fn even(value: f64) -> u32 { ((value / 2.0).round() as u32).max(1) * 2 }

fn canvas_size(canvas: &str, quality: u32, first: &Source) -> Result<(u32, u32), String> {
    let short = quality as f64;
    Ok(match canvas {
        "16:9" => (even(short * 16.0 / 9.0), quality),
        "9:16" => (quality, even(short * 16.0 / 9.0)),
        "1:1" => (quality, quality),
        "4:5" => (quality, even(short * 5.0 / 4.0)),
        "source" => {
            let (width, height) = (first.width.max(2) as f64, first.height.max(2) as f64);
            let scale = (short / width.min(height)).min(1.0);
            (even(width * scale), even(height * scale))
        }
        _ => return Err("Unknown canvas format".into()),
    })
}

fn tempo(speed: f64) -> String {
    if speed > 2.0 { format!("atempo=2,atempo={}", speed / 2.0) } else { format!("atempo={speed}") }
}

// `pieces` are the files of `project.audio`, in the same order.
fn render_project(sources: &[Source], project: &ProjectExport, music: Option<&Source>, pieces: &[Source], output: &Path, progress: &dyn Fn(f64)) -> Result<(), String> {
    if sources.is_empty() || sources.len() > 60 || sources.len() != project.clips.len() {
        return Err("A project needs from 1 to 60 clips".into());
    }
    if project.audio.len() > MAX_AUDIO_PIECES || pieces.len() != project.audio.len() {
        return Err("A project holds up to 40 separate sounds".into());
    }
    if !["mp4", "gif", "mp3"].contains(&project.format.as_str()) { return Err("Unknown export format".into()); }
    if ![480, 720, 1080].contains(&project.quality) { return Err("Unknown export resolution".into()); }
    if !["fill", "fit", "blur"].contains(&project.fit.as_str()) { return Err("Unknown fit mode".into()); }
    let (width, height) = canvas_size(&project.canvas, project.quality, &sources[0])?;
    let with_video = project.format != "mp3";
    let with_audio = project.format != "gif";
    let lengths: Vec<f64> = project.clips.iter().map(|clip| (clip.end - clip.start) / clip.look.speed).collect();
    let overlaps = transition_overlaps(project, &lengths);
    let mut total = 0.0;
    let mut graph = String::new();
    let mut joined = String::new();
    let mut captions = Vec::new();
    let mut cmd = ffmpeg_command()?;
    for (index, (clip, source)) in project.clips.iter().zip(sources).enumerate() {
        clip.look.validate()?;
        let look = &clip.look;
        if !clip.start.is_finite() || !clip.end.is_finite() || clip.start < 0.0 ||
            clip.end - clip.start < 0.1 || clip.end > source.duration + 0.05 {
            return Err("A clip is outside its source video".into());
        }
        let length = (clip.end - clip.start) / look.speed;
        total += length;
        if total > 7200.0 { return Err("The project is longer than two hours".into()); }
        cmd.args(["-ss", &clip.start.to_string(), "-t", &(clip.end - clip.start).to_string(), "-i"]).arg(&source.path);
        let fade = (length / 4.0).min(0.5);
        if with_video {
            let mut chain = vec!["setpts=PTS-STARTPTS".to_owned()];
            match look.rotate { 90 => chain.push("transpose=1".into()), 180 => chain.push("hflip,vflip".into()),
                270 => chain.push("transpose=2".into()), _ => {} }
            if look.flip { chain.push("hflip".into()); }
            if look.brightness != 0.0 || look.contrast != 1.0 || look.saturation != 1.0 {
                chain.push(format!("eq=brightness={}:contrast={}:saturation={}", look.brightness, look.contrast, look.saturation));
            }
            if look.speed != 1.0 { chain.push(format!("setpts=PTS/{}", look.speed)); }
            let base = chain.join(",");
            let fitted = match project.fit.as_str() {
                "fill" => format!("[{index}:v]{base},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"),
                "blur" => format!("[{index}:v]{base},split=2[bg{index}][fg{index}];[bg{index}]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},boxblur=24:2[bb{index}];[fg{index}]scale={width}:{height}:force_original_aspect_ratio=decrease[fs{index}];[bb{index}][fs{index}]overlay=(W-w)/2:(H-h)/2"),
                _ => format!("[{index}:v]{base},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"),
            };
            let mut finish = vec!["setsar=1".to_owned(), "fps=30".into(), "format=yuv420p".into()];
            if look.fade_in { finish.push(format!("fade=t=in:st=0:d={fade:.3}")); }
            if look.fade_out { finish.push(format!("fade=t=out:st={:.3}:d={fade:.3}", length - fade)); }
            let text = look.caption.trim();
            if !text.is_empty() {
                let mut temp = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
                temp.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
                temp.as_file().sync_all().map_err(|e| e.to_string())?;
                let font = caption_font().ok_or("No font for captions was found")?;
                let y = match look.caption_position.as_str() { "top" => "h/14", "center" => "(h-text_h)/2", _ => "h-text_h-h/14" };
                let style = if look.caption_style == "box" { "box=1:boxcolor=black@0.6:boxborderw=18" } else { "borderw=3:bordercolor=black@0.85" };
                finish.push(format!("drawtext=fontfile={}:textfile={}:fontcolor=white:fontsize={}:{style}:line_spacing=6:x=(w-text_w)/2:y={y}",
                    filter_path(&font), filter_path(temp.path()), (width.min(height) / 13).max(12)));
                captions.push(temp);
            }
            // One time base for every piece, so concat and xfade can be chained freely.
            finish.push("settb=AVTB".into());
            graph.push_str(&format!("{fitted},{}[v{index}];", finish.join(",")));
            joined.push_str(&format!("[v{index}]"));
        }
        if with_audio {
            if source.has_audio && look.volume > 0.0 {
                let mut chain = vec!["asetpts=PTS-STARTPTS".to_owned()];
                if look.speed != 1.0 { chain.push(tempo(look.speed)); }
                if look.volume != 1.0 { chain.push(format!("volume={}", look.volume)); }
                if look.fade_in { chain.push(format!("afade=t=in:st=0:d={fade:.3}")); }
                if look.fade_out { chain.push(format!("afade=t=out:st={:.3}:d={fade:.3}", length - fade)); }
                chain.push("aresample=48000".into());
                chain.push("aformat=sample_fmts=fltp:channel_layouts=stereo".into());
                graph.push_str(&format!("[{index}:a]{}[a{index}];", chain.join(",")));
            } else {
                graph.push_str(&format!("anullsrc=r=48000:cl=stereo,atrim=duration={length:.3}[a{index}];"));
            }
            joined.push_str(&format!("[a{index}]"));
        }
    }
    let count = sources.len();
    if overlaps.iter().all(|overlap| *overlap == 0.0) {
        let (v, a) = (u8::from(with_video), u8::from(with_audio));
        let video_out = if with_video { "[vcat]" } else { "" };
        let audio_out = if with_audio { "[acat]" } else { "" };
        graph.push_str(&format!("{joined}concat=n={count}:v={v}:a={a}{video_out}{audio_out}"));
    } else {
        // Clips with a transition start before the previous one ends, so the result is shorter.
        let mut chains = vec![];
        if with_video { chains.push(join_with_transitions(project, &lengths, &overlaps, 'v', "vcat")); }
        if with_audio { chains.push(join_with_transitions(project, &lengths, &overlaps, 'a', "acat")); }
        graph.push_str(&chains.join(";"));
    }
    let total = total - overlaps.iter().sum::<f64>();
    let mut audio_label = "[acat]".to_owned();
    let mut layers = vec![];
    let mut input = count;
    for (index, (piece, source)) in project.audio.iter().zip(pieces).enumerate() {
        if !source.has_audio { return Err("The selected file has no audio track".into()); }
        if ![0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].contains(&piece.speed) { return Err("Unknown playback speed".into()); }
        if !piece.volume.is_finite() || !(0.0..=2.0).contains(&piece.volume) { return Err("Volume must be between 0 and 200%".into()); }
        if !piece.start.is_finite() || !piece.end.is_finite() || !piece.at.is_finite() || piece.start < 0.0 || piece.at < 0.0 ||
            piece.end - piece.start < 0.1 || piece.end > source.duration + 0.05 {
            return Err("A sound is outside its source file".into());
        }
        // A sound that starts after the video ends is not heard in the preview either.
        if !with_audio || piece.at >= total || piece.volume == 0.0 { continue; }
        let length = (piece.end - piece.start) / piece.speed;
        let fade = (length / 4.0).min(0.5);
        cmd.args(["-ss", &piece.start.to_string(), "-t", &(piece.end - piece.start).to_string(), "-i"]).arg(&source.path);
        let mut chain = vec!["asetpts=PTS-STARTPTS".to_owned()];
        if piece.speed != 1.0 { chain.push(tempo(piece.speed)); }
        if piece.volume != 1.0 { chain.push(format!("volume={}", piece.volume)); }
        if piece.fade_in { chain.push(format!("afade=t=in:st=0:d={fade:.3}")); }
        if piece.fade_out { chain.push(format!("afade=t=out:st={:.3}:d={fade:.3}", length - fade)); }
        chain.push("aresample=48000".into());
        chain.push("aformat=sample_fmts=fltp:channel_layouts=stereo".into());
        chain.push(format!("adelay={}:all=1", (piece.at * 1000.0).round() as u64));
        graph.push_str(&format!(";[{input}:a]{}[s{index}]", chain.join(",")));
        layers.push(format!("[s{index}]"));
        input += 1;
    }
    if let (true, Some(track), Some(settings)) = (with_audio, music, project.music.as_ref()) {
        if !track.has_audio { return Err("The selected file has no audio track".into()); }
        if !settings.volume.is_finite() || !(0.0..=2.0).contains(&settings.volume) { return Err("Volume must be between 0 and 200%".into()); }
        cmd.args(["-stream_loop", "-1", "-i"]).arg(&track.path);
        graph.push_str(&format!(";[{input}:a]atrim=duration={total:.3},asetpts=PTS-STARTPTS,volume={},afade=t=out:st={:.3}:d=1.5,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[music]",
            settings.volume, (total - 1.5).max(0.0)));
        layers.push("[music]".into());
    }
    if !layers.is_empty() {
        // The joined clips come first, so the mix ends with the video.
        graph.push_str(&format!(";[acat]{}amix=inputs={}:duration=first:dropout_transition=0:normalize=0[amix]", layers.concat(), layers.len() + 1));
        audio_label = "[amix]".into();
    }
    match project.format.as_str() {
        "gif" => {
            graph.push_str(";[vcat]fps=12,scale='min(480,iw)':-2:flags=lanczos,split[g0][g1];[g0]palettegen[gp];[g1][gp]paletteuse[gif]");
            cmd.args(["-filter_complex", &graph, "-map", "[gif]", "-loop", "0"]);
        }
        "mp3" => { cmd.args(["-filter_complex", &graph, "-map", &audio_label, "-c:a", "libmp3lame", "-q:a", "2"]); }
        _ => {
            cmd.args(["-filter_complex", &graph, "-map", "[vcat]", "-map", &audio_label,
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
        }
    }
    cmd.arg(output);
    let result = run_ffmpeg(cmd, total, progress);
    drop(captions);
    if let Err(detail) = result {
        let _ = fs::remove_file(output);
        return Err(format!("FFmpeg did not create the file: {detail}"));
    }
    Ok(())
}

// A transition takes half a second, or less when a neighbouring clip is short.
fn transition_overlaps(project: &ProjectExport, lengths: &[f64]) -> Vec<f64> {
    project.clips.iter().enumerate().map(|(index, clip)| {
        if index == 0 || clip.look.transition == "none" { return 0.0; }
        (0.5f64).min(lengths[index - 1] / 2.0).min(lengths[index] / 2.0)
    }).collect()
}

fn join_with_transitions(project: &ProjectExport, lengths: &[f64], overlaps: &[f64], kind: char, output: &str) -> String {
    let count = lengths.len();
    let mut steps = vec![];
    let mut current = format!("[{kind}0]");
    let mut elapsed = lengths[0];
    for index in 1..count {
        let label = if index + 1 == count { format!("[{output}]") } else { format!("[{kind}j{index}]") };
        let overlap = overlaps[index];
        let step = match (kind, overlap > 0.0) {
            ('v', true) => format!("{current}[v{index}]xfade=transition={}:duration={overlap:.3}:offset={:.3}{label}",
                project.clips[index].look.transition, elapsed - overlap),
            ('v', false) => format!("{current}[v{index}]concat=n=2:v=1:a=0,settb=AVTB{label}"),
            (_, true) => format!("{current}[a{index}]acrossfade=d={overlap:.3}:c1=tri:c2=tri{label}"),
            (_, false) => format!("{current}[a{index}]concat=n=2:v=0:a=1{label}"),
        };
        steps.push(step);
        elapsed += lengths[index] - overlap;
        current = label;
    }
    if count == 1 { steps.push(format!("[{kind}0]{}[{output}]", if kind == 'v' { "null" } else { "anull" })); }
    steps.join(";")
}

fn project_output(first: &Path, format: &str) -> Result<PathBuf, String> {
    let (suffix, extension) = match format { "gif" => ("GIF", "gif"), "mp3" => ("Audio", "mp3"), _ => ("Video", "mp4") };
    new_output_path(first, suffix, extension)
}

#[tauri::command]
async fn editor_render(project: ProjectExport, engine: tauri::State<'_, Engine>, app: tauri::AppHandle) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut probed: HashMap<u64, Source> = HashMap::new();
        let mut sources = Vec::new();
        for clip in &project.clips {
            if !probed.contains_key(&clip.job_id) {
                let source = probe_source(&completed_video(&engine, clip.job_id)?)?;
                probed.insert(clip.job_id, source);
            }
            let source = &probed[&clip.job_id];
            sources.push(Source { path: source.path.clone(), duration: source.duration, has_audio: source.has_audio, width: source.width, height: source.height });
        }
        let music = match &project.music {
            Some(track) => {
                let path = completed_media(&engine, track.job_id)?;
                Some(Source { has_audio: media_has_audio(&path)?, path, duration: 0.0, width: 0, height: 0 })
            }
            None => None,
        };
        let mut pieces = Vec::new();
        for piece in project.audio.iter().take(MAX_AUDIO_PIECES + 1) {
            if !probed.contains_key(&piece.job_id) {
                let source = probe_source(&completed_video(&engine, piece.job_id)?)?;
                probed.insert(piece.job_id, source);
            }
            let source = &probed[&piece.job_id];
            pieces.push(Source { path: source.path.clone(), duration: source.duration, has_audio: source.has_audio, width: source.width, height: source.height });
        }
        let first = sources.first().ok_or("A project needs from 1 to 60 clips")?.path.clone();
        let output = project_output(&first, &project.format)?;
        let progress = |share: f64| { let _ = app.emit("devilcut-progress", share); };
        render_project(&sources, &project, music.as_ref(), &pieces, &output, &progress)?;
        Ok(output.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

// Small frames at exact times for a zoomed-in timeline.
#[tauri::command]
async fn editor_thumbnails(id: u64, times: Vec<f64>, engine: tauri::State<'_, Engine>) -> Result<Vec<String>, String> {
    if times.len() > 48 { return Err("Too many frames requested".into()); }
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = completed_video(&engine, id)?;
        let ffmpeg = binary("ffmpeg")?;
        let mut frames = Vec::with_capacity(times.len());
        for second in times {
            if !second.is_finite() || second < 0.0 { frames.push(String::new()); continue; }
            let output = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-ss", &second.to_string(), "-i"])
                .arg(&file).args(["-frames:v", "1", "-vf", "scale=160:-2", "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "-"])
                .output().map_err(|e| e.to_string())?;
            frames.push(if output.status.success() && !output.stdout.is_empty() && output.stdout.len() < 500_000 {
                "data:image/jpeg;base64,".to_owned() + &base64::engine::general_purpose::STANDARD.encode(output.stdout)
            } else { String::new() });
        }
        Ok(frames)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn editor_frame(id: u64, second: f64, engine: tauri::State<'_, Engine>) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = completed_video(&engine, id)?;
        let duration = video_duration(&file)?;
        if !second.is_finite() || second < 0.0 || second > duration {
            return Err("The frame is outside the video".into());
        }
        let ffmpeg = binary("ffmpeg")?;
        let output = command(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-ss", &second.to_string(), "-i"])
            .arg(file).args(["-frames:v", "1", "-vf", "scale=640:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"])
            .output().map_err(|e| e.to_string())?;
        if !output.status.success() || output.stdout.is_empty() || output.stdout.len() > 2_000_000 {
            return Err("Could not show the video frame".into());
        }
        Ok("data:image/jpeg;base64,".to_owned() + &base64::engine::general_purpose::STANDARD.encode(output.stdout))
    }).await.map_err(|e| e.to_string())?
}

fn save_frame(file: &Path, second: f64) -> Result<PathBuf, String> {
    let duration = video_duration(file)?;
    if !second.is_finite() || second < 0.0 || second > duration { return Err("The frame is outside the video".into()); }
    let output = new_output_path(file, "Frame", "png")?;
    let ffmpeg = binary("ffmpeg")?;
    let result = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-nostdin", "-n",
        "-ss", &second.to_string(), "-i"]).arg(file).args(["-frames:v", "1"])
        .arg(&output).output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        let _ = fs::remove_file(&output);
        return Err("FFmpeg could not save the frame".into());
    }
    Ok(output)
}

#[tauri::command]
async fn editor_save_frame(id: u64, second: f64, engine: tauri::State<'_, Engine>) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = completed_video(&engine, id)?;
        save_frame(&file, second).map(|path| path.to_string_lossy().into())
    }).await.map_err(|e| e.to_string())?
}
fn media_has_audio(file: &Path) -> Result<bool, String> {
    let probe = binary("ffprobe")?;
    let result = command(&probe).args(["-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=index", "-of", "csv=p=0"]).arg(file)
        .output().map_err(|e| e.to_string())?;
    Ok(result.status.success() && !result.stdout.is_empty())
}

#[cfg(windows)]
fn reveal_file_windows(file: &Path) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};
    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, mode: u32) -> i32;
        fn CoUninitialize();
        fn CoTaskMemFree(pointer: *mut c_void);
    }
    #[link(name = "shell32")]
    extern "system" {
        fn SHParseDisplayName(name: *const u16, context: *mut c_void, pidl: *mut *mut c_void, attributes: u32, result: *mut u32) -> i32;
        fn SHOpenFolderAndSelectItems(pidl: *const c_void, count: u32, items: *const *const c_void, flags: u32) -> i32;
    }
    let name: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let initialized = CoInitializeEx(ptr::null_mut(), 2);
        if initialized < 0 { return Err(format!("Could not prepare File Explorer: {:#010X}", initialized as u32)); }
        let mut pidl = ptr::null_mut();
        let parsed = SHParseDisplayName(name.as_ptr(), ptr::null_mut(), &mut pidl, 0, ptr::null_mut());
        let result = if parsed < 0 {
            Err(format!("Could not find the file in File Explorer: {:#010X}", parsed as u32))
        } else {
            let opened = SHOpenFolderAndSelectItems(pidl, 0, ptr::null(), 0);
            if opened < 0 { Err(format!("Could not select the file in File Explorer: {:#010X}", opened as u32)) }
            else { Ok(()) }
        };
        if !pidl.is_null() { CoTaskMemFree(pidl); }
        CoUninitialize();
        result
    }
}

#[tauri::command]
async fn reveal_download(id: u64, engine: tauri::State<'_, Engine>) -> Result<(), String> {
    let file = {
        let d = engine.data.lock().unwrap();
        let job = d.jobs.iter().find(|j| j.id == id).ok_or("Task not found")?;
        if job.status != "done" || job.file.is_empty() { return Err("The finished file was not found".into()); }
        PathBuf::from(&job.file)
    };
    reveal(file).await
}

// Exports from Devil Cut are not queue tasks, so they are revealed by path.
#[tauri::command]
async fn reveal_file(path: String) -> Result<(), String> {
    reveal(PathBuf::from(path)).await
}

async fn reveal(file: PathBuf) -> Result<(), String> {
    if !file.is_file() { return Err("The file is no longer at the saved path".into()); }
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || reveal_file_windows(&file))
        .await.map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg("-R").arg(&file).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(file.parent().unwrap_or(Path::new("."))).spawn();
    #[cfg(not(windows))]
    return result.map(|_| ()).map_err(|e| format!("Could not open the folder: {e}"));
}

// Explorer falls back to another folder when the path has forward slashes or a trailing separator.
fn plain_folder(text: &str) -> PathBuf {
    let text = text.trim();
    #[cfg(windows)] {
        let text = text.replace('/', "\\");
        let trimmed = text.trim_end_matches('\\');
        // A drive root keeps its separator.
        return PathBuf::from(if trimmed.is_empty() || trimmed.ends_with(':') { &text[..] } else { trimmed });
    }
    #[cfg(not(windows))]
    PathBuf::from(text)
}

// Opens the folder chosen in the download settings; without one, the default or the last used folder.
#[tauri::command]
fn open_downloads(folder: Option<String>, engine: tauri::State<Engine>) -> Result<(), String> {
    let folder = match folder.map(|text| plain_folder(&text)).filter(|path| path.is_absolute()) {
        Some(path) => path,
        None => {
            let d = engine.data.lock().unwrap();
            plain_folder(if d.default_folder.is_empty() { &d.options.folder } else { &d.default_folder })
        }
    };
    if !folder.is_dir() { return Err("The downloads folder does not exist yet".into()); }
    #[cfg(windows)]
    let result = Command::new("explorer.exe").arg(&folder).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&folder).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&folder).spawn();
    result.map(|_| ()).map_err(|e| format!("Could not open the folder: {e}"))
}

#[tauri::command]
fn clear_finished(engine: tauri::State<Engine>) -> Result<(), String> {
    change_records(&engine, |jobs| {
        // Cancelled tasks go too: nothing more will happen to them.
        for job in jobs.iter_mut().filter(|j| ["done", "cancelled"].contains(&j.status.as_str())) { job.hidden_in_queue = true; }
        Ok(())
    })
}

const REMOVABLE: [&str; 4] = ["done", "error", "cancelled", "interrupted"];

// Applies a change to the task records, drops those hidden everywhere and saves.
fn change_records(engine: &Engine, change: impl FnOnce(&mut Vec<Job>) -> Result<(), String>) -> Result<(), String> {
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    change(&mut d.jobs)?;
    d.jobs.retain(|j| !(j.hidden_in_queue && (j.hidden_in_library || j.status != "done")));
    if let Err(e) = save(&engine.dir, &d) { *d = old; return Err(e); }
    Ok(())
}

// A finished download leaves the queue but stays in the library.
#[tauri::command]
fn remove_job(id: u64, engine: tauri::State<Engine>) -> Result<(), String> {
    change_records(&engine, |jobs| {
        let job = jobs.iter_mut().find(|j| j.id == id).ok_or("Task not found")?;
        if !REMOVABLE.contains(&job.status.as_str()) { return Err("Stop the task before removing it".into()); }
        job.hidden_in_queue = true;
        Ok(())
    })
}

#[tauri::command]
fn remove_from_library(id: u64, engine: tauri::State<Engine>) -> Result<(), String> {
    change_records(&engine, |jobs| {
        let job = jobs.iter_mut().find(|j| j.id == id && j.status == "done").ok_or("Task not found")?;
        job.hidden_in_library = true;
        Ok(())
    })
}

#[tauri::command]
fn clear_library(engine: tauri::State<Engine>) -> Result<(), String> {
    change_records(&engine, |jobs| {
        for job in jobs.iter_mut().filter(|j| j.status == "done") { job.hidden_in_library = true; }
        Ok(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    title: String,
    channel: String,
    duration: Option<u64>,
    thumbnail: String,
    url: String,
}

#[tauri::command]
async fn search_media(query: String, source: String) -> Result<Vec<SearchHit>, String> {
    let query = query.trim().to_owned();
    if query.is_empty() || query.chars().count() > 120 {
        return Err("Enter a query of 1 to 120 characters".into());
    }
    let source = match source.as_str() {
        "youtube" | "music" => source,
        _ => return Err("Unknown search source".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let exe = binary("yt-dlp")?;
        let term = if source == "music" {
            let mut address = url::Url::parse("https://music.youtube.com/search").unwrap();
            address.query_pairs_mut().append_pair("q", &query);
            address.to_string()
        } else { format!("ytsearch12:{query}") };
        let output = ytdlp_command(&exe)
            .args(["--ignore-config", "--flat-playlist", "--dump-single-json",
                "--skip-download", "--no-warnings", "--no-colors", "--"])
            .arg(term)
            .output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Search failed: {}", detail.chars().take(280).collect::<String>()));
        }
        let data: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "yt-dlp returned an invalid search result".to_string())?;
        let mut hits = Vec::new();
        for item in data["entries"].as_array().into_iter().flatten() {
            let id = item["id"].as_str().unwrap_or("");
            let valid_id = id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
            if !valid_id { continue; }
            if hits.len() >= 12 { break; }
            hits.push(SearchHit {
                title: item["title"].as_str().unwrap_or("").to_owned(),
                channel: item["channel"].as_str().or_else(|| item["uploader"].as_str()).unwrap_or("").to_owned(),
                duration: item["duration"].as_u64(),
                thumbnail: format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"),
                url: format!("https://www.youtube.com/watch?v={id}"),
            });
        }
        Ok(hits)
    }).await.map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectInfo {
    title: String,
    channel: String,
    duration: Option<f64>,
    thumbnail: String,
    item_count: Option<u64>,
    chapter_count: usize,
    is_list: bool,
    formats: Vec<FormatChoice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatChoice {
    id: String,
    extension: String,
    width: Option<u64>,
    height: Option<u64>,
    fps: Option<f64>,
    video_codec: String,
    audio_codec: String,
    bytes: Option<u64>,
    has_audio: bool,
    has_video: bool,
}

#[tauri::command]
async fn inspect_media(address: String) -> Result<InspectInfo, String> {
    let urls = model::parse_urls(&address)?;
    if urls.len() != 1 { return Err("Check one link at a time".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let exe = binary("yt-dlp")?;
        let output = ytdlp_command(&exe)
            .args(["--ignore-config", "--flat-playlist", "--dump-single-json", "--skip-download",
                "--playlist-items", "1", "--no-warnings", "--no-colors", "--"])
            .arg(&urls[0]).output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Could not check the link: {}", detail.chars().take(280).collect::<String>()));
        }
        let info: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "yt-dlp returned invalid metadata".to_string())?;
        let thumbnail = info["id"].as_str().filter(|id| id.len() == 11 &&
            id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
            .map(|id| format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")).unwrap_or_default();
        let mut formats: Vec<FormatChoice> = info["formats"].as_array().into_iter().flatten()
            .filter_map(|entry| {
                let id = entry["format_id"].as_str()?.to_owned();
                if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) { return None; }
                let video_codec = entry["vcodec"].as_str().unwrap_or("none").to_owned();
                let audio_codec = entry["acodec"].as_str().unwrap_or("none").to_owned();
                let has_video = video_codec != "none";
                let has_audio = audio_codec != "none";
                if !has_video && !has_audio { return None; }
                Some(FormatChoice {
                    id, extension: entry["ext"].as_str().unwrap_or("").to_owned(),
                    width: entry["width"].as_u64(), height: entry["height"].as_u64(),
                    fps: entry["fps"].as_f64(), video_codec, audio_codec,
                    bytes: entry["filesize"].as_u64().or_else(|| entry["filesize_approx"].as_u64()),
                    has_audio, has_video,
                })
            }).collect();
        formats.sort_by(|a,b| b.has_video.cmp(&a.has_video)
            .then_with(|| b.height.cmp(&a.height))
            .then_with(|| b.fps.partial_cmp(&a.fps).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| b.bytes.cmp(&a.bytes)));
        let mut chosen: Vec<FormatChoice> = formats.iter().filter(|f| f.has_video).take(38)
            .map(|f| FormatChoice { id:f.id.clone(), extension:f.extension.clone(), width:f.width,
                height:f.height, fps:f.fps, video_codec:f.video_codec.clone(), audio_codec:f.audio_codec.clone(),
                bytes:f.bytes, has_audio:f.has_audio, has_video:f.has_video }).collect();
        chosen.extend(formats.into_iter().filter(|f| !f.has_video).take(10));
        Ok(InspectInfo {
            title: info["title"].as_str().unwrap_or("").to_owned(),
            channel: info["channel"].as_str().or_else(|| info["uploader"].as_str()).unwrap_or("").to_owned(),
            duration: info["duration"].as_f64(),
            thumbnail,
            item_count: info["playlist_count"].as_u64().or_else(|| info["n_entries"].as_u64()),
            chapter_count: info["chapters"].as_array().map_or(0, Vec::len),
            is_list: info["_type"].as_str() == Some("playlist"),
            formats: chosen,
        })
    }).await.map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistEntry { index: u64, title: String, duration: Option<f64> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistInfo { title: String, total: Option<u64>, entries: Vec<PlaylistEntry> }

#[tauri::command]
async fn playlist_entries(address: String) -> Result<PlaylistInfo, String> {
    let urls = model::parse_urls(&address)?;
    if urls.len() != 1 { return Err("Give a single playlist link".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let exe = binary("yt-dlp")?;
        let output = ytdlp_command(&exe)
            .args(["--ignore-config", "--flat-playlist", "--dump-single-json", "--skip-download",
                "--playlist-end", "100", "--no-warnings", "--no-colors", "--"])
            .arg(&urls[0]).output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Could not open the playlist: {}", detail.chars().take(280).collect::<String>()));
        }
        let data: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "yt-dlp returned an invalid playlist".to_string())?;
        let list = data["entries"].as_array().ok_or("The link does not contain a playlist")?;
        let entries = list.iter().enumerate().filter_map(|(position, item)| {
            if item.is_null() { return None; }
            Some(PlaylistEntry {
                index: item["playlist_index"].as_u64().unwrap_or(position as u64 + 1),
                title: item["title"].as_str().unwrap_or("").to_owned(),
                duration: item["duration"].as_f64(),
            })
        }).collect();
        Ok(PlaylistInfo {
            title: data["title"].as_str().unwrap_or("").to_owned(),
            total: data["playlist_count"].as_u64().or_else(|| data["n_entries"].as_u64()),
            entries,
        })
    }).await.map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateGroup { bytes: u64, files: Vec<String>, ids: Vec<u64> }

fn same_content(left: &Path, right: &Path) -> Result<bool, String> {
    let left_len = fs::metadata(left).map_err(|e| e.to_string())?.len();
    if left_len != fs::metadata(right).map_err(|e| e.to_string())?.len() { return Ok(false); }
    let mut a = BufReader::new(fs::File::open(left).map_err(|e| e.to_string())?);
    let mut b = BufReader::new(fs::File::open(right).map_err(|e| e.to_string())?);
    let mut aa = [0u8; 65536];
    let mut bb = [0u8; 65536];
    let mut remaining = left_len;
    while remaining > 0 {
        let count = remaining.min(aa.len() as u64) as usize;
        a.read_exact(&mut aa[..count]).map_err(|e| e.to_string())?;
        b.read_exact(&mut bb[..count]).map_err(|e| e.to_string())?;
        if aa[..count] != bb[..count] { return Ok(false); }
        remaining -= count as u64;
    }
    Ok(true)
}

#[tauri::command]
async fn find_duplicates(engine: tauri::State<'_, Engine>) -> Result<Vec<DuplicateGroup>, String> {
    let jobs = engine.data.lock().unwrap().jobs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut by_size: HashMap<u64, Vec<(u64, PathBuf)>> = HashMap::new();
        for job in jobs.iter().filter(|job| job.status == "done" && !job.file.is_empty()) {
            let path = PathBuf::from(&job.file);
            if let Ok(metadata) = fs::metadata(&path) {
                if metadata.is_file() { by_size.entry(metadata.len()).or_default().push((job.id, path)); }
            }
        }
        let mut found = Vec::new();
        for (bytes, items) in by_size {
            if items.len() < 2 { continue; }
            let mut used = HashSet::new();
            for (index, (id, path)) in items.iter().enumerate() {
                if used.contains(&index) { continue; }
                let mut ids = vec![*id];
                let mut files = vec![path.to_string_lossy().into_owned()];
                for (other_index, (other_id, other_path)) in items.iter().enumerate().skip(index + 1) {
                    if used.contains(&other_index) || path == other_path { continue; }
                    if same_content(path, other_path)? {
                        used.insert(other_index);
                        ids.push(*other_id);
                        files.push(other_path.to_string_lossy().into_owned());
                    }
                }
                if ids.len() > 1 { found.push(DuplicateGroup { bytes, files, ids }); }
            }
        }
        found.sort_by(|a,b| b.bytes.cmp(&a.bytes));
        Ok(found)
    }).await.map_err(|e| e.to_string())?
}

// App updates come from the GitHub releases feed, signed with the updater key.
#[derive(Default)]
struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdate { version: String, notes: String, installable: bool }

// Copies that can replace themselves: the Windows installer (it leaves an uninstaller
// next to the app), the macOS app and the AppImage. The portable zip and the .deb
// package are updated by hand.
fn self_updating() -> bool {
    if cfg!(windows) {
        return std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file())).unwrap_or(false);
    }
    cfg!(target_os = "macos") || std::env::var_os("APPIMAGE").is_some()
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<Option<AppUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let own = app.updater_builder().build().map_err(|e| e.to_string())?.check().await;
    let (update, installable) = match own {
        Ok(update) => (update, self_updating()),
        // A feed without an entry for this system still tells the version: read it from the
        // Windows entry and send the user to the releases page.
        Err(_) if !cfg!(windows) => {
            let update = app.updater_builder().target("windows-x86_64").build().map_err(|e| e.to_string())?.check().await
                .map_err(|e| format!("Could not check for updates: {e}"))?;
            (update, false)
        }
        Err(e) => return Err(format!("Could not check for updates: {e}")),
    };
    let info = update.as_ref().map(|update| AppUpdate { version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default().chars().take(600).collect(), installable });
    *pending.0.lock().unwrap() = update.filter(|_| installable);
    Ok(info)
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle, pending: tauri::State<'_, PendingUpdate>, engine: tauri::State<'_, Engine>) -> Result<(), String> {
    if !self_updating() { return Err("This copy is updated by hand. Download the new version from the releases page.".into()); }
    let update = pending.0.lock().unwrap().take().ok_or("Check for updates first")?;
    let mut received = 0u64;
    let bytes = update.download(|chunk, total| {
        received += chunk as u64;
        if let Some(total) = total.filter(|total| *total > 0) { let _ = app.emit("app-update-progress", received as f64 / total as f64); }
    }, || {}).await.map_err(|e| format!("Could not download the update: {e}"))?;
    // Running downloads become "interrupted" and can be resumed after the restart.
    engine.stop();
    // On Windows this starts the installer and closes Deviload; the macOS app and the AppImage are replaced in place.
    update.install(bytes).map_err(|e| format!("Could not install the update: {e}. Restart Deviload and try again."))?;
    app.restart();
}

#[derive(Default)]
struct CloseToTray(AtomicBool);

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<'_, CloseToTray>) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn open_releases() -> Result<(), String> {
    const URL: &str = "https://github.com/Pronexsteam/deviload/releases/latest";
    #[cfg(windows)]
    let result = Command::new("explorer.exe").arg(URL).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(URL).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(URL).spawn();
    result.map(|_| ()).map_err(|e| format!("Could not open the releases page: {e}"))
}

struct TrayItems {
    open: tauri::menu::MenuItem<tauri::Wry>,
    quit: tauri::menu::MenuItem<tauri::Wry>,
}

#[tauri::command]
fn set_tray_labels(open: String, quit: String, items: tauri::State<'_, TrayItems>) -> Result<(), String> {
    let clean = |value: &str| value.chars().filter(|c| !c.is_control()).take(60).collect::<String>();
    items.open.set_text(clean(&open)).map_err(|e| e.to_string())?;
    items.quit.set_text(clean(&quit)).map_err(|e| e.to_string())
}

// A dot on the tray icon: amber while downloading, red after a failure.
fn draw_badge(pixels: &mut [u8], width: u32, height: u32, color: [u8; 3]) {
    let radius = width as f32 * 0.2;
    let ring = radius + width as f32 * 0.06;
    let (cx, cy) = (width as f32 - ring, height as f32 - ring);
    for y in 0..height {
        for x in 0..width {
            let distance = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let at = ((y * width + x) * 4) as usize;
            let paint = if distance <= radius { color } else if distance <= ring { [16, 19, 23] } else { continue };
            pixels[at..at + 3].copy_from_slice(&paint);
            pixels[at + 3] = 255;
        }
    }
}

#[tauri::command]
fn set_tray_state(state: String, tooltip: String, app: tauri::AppHandle) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("The tray icon is missing")?;
    let color = match state.as_str() { "working" => Some([255, 176, 64]), "error" => Some([255, 75, 59]), _ => None };
    let icon = match color {
        Some(color) => {
            let base = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).map_err(|e| e.to_string())?;
            let (width, height) = (base.width(), base.height());
            let mut pixels = base.rgba().to_vec();
            draw_badge(&mut pixels, width, height, color);
            Some(tauri::image::Image::new_owned(pixels, width, height))
        }
        None => app.default_window_icon().cloned(),
    };
    tray.set_icon(icon).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip.chars().filter(|c| !c.is_control()).take(120).collect::<String>())).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_network_settings() -> Result<(), String> {
    #[cfg(windows)]
    return Command::new("explorer.exe").arg("ms-settings:network-status").spawn()
        .map(|_| ()).map_err(|e| format!("Could not open the network settings: {e}"));
    #[cfg(not(windows))]
    Err("Network settings can only be opened from here on Windows".into())
}

#[tauri::command]
fn window_action(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "toggle_maximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? { window.unmaximize() }
            else { window.maximize() }
        }
        "start_dragging" => window.start_dragging(),
        "toggle_fullscreen" => {
            let full = window.is_fullscreen().map_err(|e| e.to_string())?;
            window.set_fullscreen(!full)
        }
        "exit_fullscreen" => window.set_fullscreen(false),
        "close" => window.close(),
        _ => return Err("Unknown window action".into()),
    };
    result.map_err(|e| e.to_string())
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    // A second launch only brings the running window forward; two copies would share one queue.
    // A copy with its own test data shares nothing, so it may run beside the installed app.
    if std::env::var_os("DEVILOAD_TEST_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_autostart::Builder::new().arg("--minimized").build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(CloseToTray::default())
        .manage(convert::Converter::default())
        .manage(power::AfterDownloads::default())
        .manage(PendingUpdate::default())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
                window.set_icon(tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?)?;
            }
            // Started with Windows: stay in the tray until the user opens the window.
            if !std::env::args().any(|arg| arg == "--minimized") {
                if let Some(window) = app.get_webview_window("main") { window.show()?; }
            }
            let open = tauri::menu::MenuItem::with_id(app, "tray-open", "Open Deviload", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "tray-quit", "Quit Deviload", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&open, &quit])?;
            app.manage(TrayItems { open: open.clone(), quit: quit.clone() });
            tauri::tray::TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().ok_or("tray icon is missing")?.clone())
                .tooltip("Deviload")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            // Debug builds can use disposable state for native UI checks.
            let dir = if cfg!(debug_assertions) {
                std::env::var_os("DEVILOAD_TEST_DATA_DIR").map(PathBuf::from)
                    .filter(|p| p.is_absolute()).unwrap_or(app.path().app_data_dir()?)
            } else { app.path().app_data_dir()? };
            fs::create_dir_all(&dir)?;
            *PROXY.lock().unwrap() = stored_proxy(&dir);
            if let Ok(profile) = youtube_profile(app.handle()) {
                let marker = profile.with_extension("delete");
                if marker.exists() && fs::remove_dir_all(&profile).map_or_else(|_| !profile.exists(), |_| true) {
                    let _ = fs::remove_file(marker);
                }
            }
            let queue = dir.join("queue.json");
            let mut data = if queue.exists() {
                match serde_json::from_slice::<Snapshot>(&fs::read(&queue)?) {
                    Ok(d) => d,
                    Err(e) => {
                        let backup = dir.join(format!("queue-corrupt-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis()));
                        fs::copy(&queue, backup)?;
                        Snapshot { warning: format!("The damaged queue was saved separately: {e}"), ..Snapshot::default() }
                    }
                }
            } else { Snapshot::default() };
            data.parallel = data.parallel.clamp(1, 8);
            // Never restart downloads silently when the app is opened.
            for job in &mut data.jobs {
                if ["running", "cancelling", "pausing"].contains(&job.status.as_str()) || (job.status == "queued" && job.scheduled_at.is_none()) { job.status = "interrupted".into(); }
            }
            save(&dir, &data).map_err(std::io::Error::other)?;
            let engine = Engine { data: Arc::new(Mutex::new(data)), dir, shutdown: Arc::new(AtomicBool::new(false)) };
            app.manage(engine.clone());
            app.manage(share::ShareState::default());
            watch::start(app.handle().clone());
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                if engine.shutdown.load(Ordering::Relaxed) { break; }
                // While yt-dlp waits to be replaced, no new download starts.
                let updating = heal::engine_update_pending(now_seconds());
                let (id, busy, active) = {
                    let mut d = engine.data.lock().unwrap();
                    let active = d.jobs.iter().filter(|j| ["running", "cancelling", "pausing"].contains(&j.status.as_str())).count();
                    let waiting = d.jobs.iter().any(|j| ready_to_run(j, now_seconds()));
                    let id = if active < d.parallel && !updating {
                        if let Some(j) = d.jobs.iter_mut().find(|j| ready_to_run(j, now_seconds())) {
                            j.status = "running".into(); j.scheduled_at = None; j.archived = 0; let id = j.id; engine.persist(&mut d); Some(id)
                        } else { None }
                    } else { None };
                    (id, active > 0 || waiting || updating, active)
                };
                if updating && active == 0 { heal::update_engine_when_idle(|| update_engine().map(|_| ()), now_seconds()); }
                power::observe(&handle, busy);
                if let Some(id) = id {
                    let worker = engine.clone(); thread::spawn(move || worker.run_job(id));
                }
                thread::sleep(Duration::from_millis(150));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.state::<CloseToTray>().0.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![set_close_to_tray, set_tray_labels, open_network_settings, update_ytdlp, open_releases, window_action, snapshot, diagnostics, common_folders, open_youtube, youtube_sign_out, ytdlp_info, ui_store, save_ui_store, save_ui_project, set_proxy, find_legacy, import_legacy, check_app_update, install_app_update, job_command, read_link_list, autostart_status, set_autostart, set_tray_state, watch::watch_list, watch::watch_add, watch::watch_remove, watch::watch_check, open_devil_cut, preflight_download, youtube_login_status, search_media, inspect_media, playlist_entries, enqueue, change_job, move_job, clear_finished, remove_job, remove_from_library, clear_library, reveal_download, reveal_file, open_downloads, set_default_folder, convert::open_converter, convert::convert_pending, convert::convert_probe, convert::convert_file, convert::convert_stop, power::set_after_downloads, power::cancel_power, set_media_server, check_media_server, editor_info, editor_frame, editor_thumbnails, editor_waveform, editor_render, editor_save_frame, media_source, audio_info, audio_save_tags, audio_normalize, find_duplicates, player_metadata, share::phone_start, share::phone_send, share::phone_status, share::phone_answer, share::phone_stop, share::phone_forget])
        .build(tauri::generate_context!()).expect("failed to start Deviload")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event { app.state::<Engine>().stop(); }
        });
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    #[test]
    fn legacy_import_moves_history_settings_and_archive() {
        let legacy = tempfile::tempdir().unwrap();
        let data_dir = tempfile::tempdir().unwrap();
        let old = legacy.path();
        let video = old.join("Clip [abc].mkv");
        let song = old.join("Song.mp3");
        fs::write(&video, b"v").unwrap();
        fs::write(&song, b"a").unwrap();
        assert!(import_legacy_into(old, &mut Snapshot::default(), data_dir.path()).is_err());
        fs::write(old.join("YT-Downloader.ps1"), "").unwrap();
        // PowerShell 5.1 writes UTF-8 with a byte order mark.
        let history = serde_json::json!([
            {"title": "Song", "url": "https://www.youtube.com/watch?v=song", "path": song, "time": "01.09.2026 10:00", "thumb": ""},
            {"title": "Clip", "url": "", "path": video, "time": "31.08.2026 09:00", "thumb": ""},
            {"title": "Gone", "url": "https://example.com/x", "path": old.join("missing.mp4"), "time": "", "thumb": ""},
        ]);
        fs::write(old.join("history.json"), format!("\u{feff}{history}")).unwrap();
        fs::write(old.join("ui-settings.json"), format!("\u{feff}{}", serde_json::json!({
            "folder": old, "quality": 4, "cookies": 2, "playlist": false, "splitChapters": true, "sponsorblock": true,
            "subsOn": true, "parallel": 2, "rate": 3, "archive": true, "lang": "ru"}))).unwrap();
        fs::write(old.join("download-archive.txt"), "youtube song\nyoutube clip\nbroken\nyoutube song\n").unwrap();
        fs::write(data_dir.path().join("archive-mp3.txt"), "youtube clip\n").unwrap();
        let mut data = Snapshot::default();
        let result = import_legacy_into(old, &mut data, data_dir.path()).unwrap();
        assert_eq!(result, LegacyImport { files: 2, settings: true, archive: 1, language: "ru".into() });
        assert_eq!(data.options.folder, old.to_string_lossy());
        assert_eq!((data.options.quality.as_str(), data.options.rate_mbps, data.parallel), ("mp3", 5, 3));
        assert!(data.options.split_chapters && data.options.sponsorblock && data.options.subtitles);
        assert!(data.options.cookies.is_empty() && data.options.cookies_browser.is_empty());
        assert_eq!(data.jobs.len(), 2);
        assert_eq!((data.jobs[0].file.as_str(), data.jobs[0].url.as_str(), data.jobs[0].options.quality.as_str()), (video.to_str().unwrap(), "", "best"));
        assert_eq!((data.jobs[1].url.as_str(), data.jobs[1].options.quality.as_str(), data.jobs[1].status.as_str()), ("https://www.youtube.com/watch?v=song", "mp3", "done"));
        assert_eq!(fs::read_to_string(data_dir.path().join("archive-mp3.txt")).unwrap(), "youtube clip\nyoutube song\n");
        // A second import adds nothing new.
        assert_eq!(import_legacy_into(old, &mut data, data_dir.path()).unwrap().files, 0);
        assert_eq!(data.jobs.len(), 2);
    }
    #[test]
    fn queue_and_library_forget_files_independently() {
        let dir = tempfile::tempdir().unwrap();
        let job = |id: u64, status: &str| Job { id, url: String::new(), options: Options::default(), status: status.into(),
            percent: 0.0, speed: String::new(), file: format!("file{id}.mp4"), log: vec![], scheduled_at: None, auto_retry: false,
            retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], pid: None, hidden_in_queue: false, hidden_in_library: false };
        let engine = Engine { dir: dir.path().into(), data: Arc::new(Mutex::new(Snapshot {
            jobs: vec![job(1, "done"), job(2, "done"), job(3, "error"), job(4, "running")], ..Snapshot::default() })),
            shutdown: Arc::new(AtomicBool::new(false)) };
        let ids = |engine: &Engine| engine.data.lock().unwrap().jobs.iter().map(|j| j.id).collect::<Vec<_>>();
        // Leaving the queue keeps a finished file in the library; a failed task just goes.
        change_records(&engine, |jobs| { for j in jobs.iter_mut().filter(|j| [1, 3].contains(&j.id)) { j.hidden_in_queue = true; } Ok(()) }).unwrap();
        assert_eq!(ids(&engine), [1, 2, 4]);
        assert!(engine.data.lock().unwrap().jobs[0].hidden_in_queue);
        // Leaving the library too removes the record for good.
        change_records(&engine, |jobs| { jobs[0].hidden_in_library = true; Ok(()) }).unwrap();
        assert_eq!(ids(&engine), [2, 4]);
        // Hidden only in the library, it stays in the queue.
        change_records(&engine, |jobs| { jobs[0].hidden_in_library = true; Ok(()) }).unwrap();
        assert_eq!(ids(&engine), [2, 4]);
        let saved: Snapshot = serde_json::from_slice(&fs::read(dir.path().join("queue.json")).unwrap()).unwrap();
        assert!(saved.jobs[0].hidden_in_library && !saved.jobs[0].hidden_in_queue);
        // A running task refuses to be removed.
        let error = change_records(&engine, |jobs| {
            let running = jobs.iter_mut().find(|j| j.id == 4).unwrap();
            if !REMOVABLE.contains(&running.status.as_str()) { return Err("busy".into()); }
            Ok(())
        });
        assert!(error.is_err());
        assert_eq!(ids(&engine), [2, 4]);
    }
    #[test]
    fn the_tray_badge_sits_in_the_corner() {
        let (width, height) = (32u32, 32u32);
        let mut pixels = vec![7u8; (width * height * 4) as usize];
        draw_badge(&mut pixels, width, height, [255, 176, 64]);
        let at = |x: u32, y: u32| &pixels[((y * width + x) * 4) as usize..((y * width + x) * 4 + 4) as usize];
        assert_eq!(at(24, 24), [255, 176, 64, 255]);
        assert_eq!(at(4, 4), [7, 7, 7, 7], "the rest of the icon is untouched");
    }
    #[test]
    fn commands_quote_what_a_shell_would_split() {
        assert_eq!(quote_arg("--no-playlist"), "--no-playlist");
        assert_eq!(quote_arg("C:\\My Videos"), "\"C:\\My Videos\"");
        assert_eq!(quote_arg("a&b"), "\"a&b\"");
        assert_eq!(quote_arg(""), "\"\"");
        assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
    }
    #[test]
    fn proxy_is_read_from_the_store_and_passed_first() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(stored_proxy(dir.path()), "");
        fs::write(dir.path().join("library.json"), r#"{"network":{"proxy":"socks5://127.0.0.1:1080"}}"#).unwrap();
        assert_eq!(stored_proxy(dir.path()), "socks5://127.0.0.1:1080");
        fs::write(dir.path().join("library.json"), r#"{"network":{"proxy":"not a proxy"}}"#).unwrap();
        assert_eq!(stored_proxy(dir.path()), "");
        let args: Vec<_> = ytdlp_command_with(Path::new("yt-dlp"), "http://proxy:8080").get_args()
            .map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["--encoding", "utf-8", "--proxy", "http://proxy:8080"]);
        assert_eq!(ytdlp_command_with(Path::new("yt-dlp"), "").get_args().count(), 2);
    }
    #[test]
    fn cookie_export_keeps_only_youtube_and_google_domains() {
        let auth = tauri::webview::Cookie::build(("SID", "secret"))
            .domain(".youtube.com").path("/").secure(true).build();
        let unrelated = tauri::webview::Cookie::build(("SID", "other"))
            .domain(".example.com").path("/").build();
        let content = cookie_file_content(&[auth, unrelated.clone()]).unwrap();
        assert!(content.contains(".youtube.com\tTRUE\t/\tTRUE"), "{content}");
        assert!(content.contains("\tSID\tsecret"));
        assert!(!content.contains("example.com"));
        assert!(cookie_file_content(&[unrelated]).is_none());
    }
    #[test]
    fn preflight_rejects_unwritable_destination_and_missing_urls() {
        let dir = tempfile::tempdir().unwrap();
        let options = Options { folder: dir.path().join("downloads").to_string_lossy().into(), ..Options::default() };
        assert!(check_preflight("", &options, None, &[]).is_err());
        let result = check_preflight("https://example.com/video", &options, None, &[]).unwrap();
        assert!(result.available_bytes.is_some());
        assert!(Path::new(&options.folder).is_dir());
        let occupied = dir.path().join("occupied");
        fs::write(&occupied, b"file").unwrap();
        let invalid_folder = Options { folder: occupied.to_string_lossy().into(), ..options.clone() };
        let invalid = check_preflight("https://example.com/video", &invalid_folder, None, &[]).unwrap();
        assert!(!invalid.ready);
        assert!(!invalid.blockers.is_empty());
        let huge = check_preflight("https://example.com/video", &options, Some(u64::MAX), &[]).unwrap();
        assert!(!huge.ready);
        let duplicate = Job { id: 1, url: "https://example.com/video".into(), options: options.clone(),
            status: "done".into(), percent: 100.0, speed: String::new(), file: String::new(),
            log: vec![], scheduled_at: None, auto_retry: false, retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], pid: None, hidden_in_queue: false, hidden_in_library: false };
        let report = check_preflight("https://example.com/video", &options, None, &[duplicate]).unwrap();
        assert!(report.warnings.iter().any(|warning| warning.contains("history")));
    }
    #[test]
    fn duplicate_comparison_checks_every_byte() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.bin");
        let b = dir.path().join("b.bin");
        let c = dir.path().join("c.bin");
        let mut bytes = vec![7u8; 150_000];
        fs::write(&a, &bytes).unwrap();
        fs::write(&b, &bytes).unwrap();
        bytes[90_000] = 8;
        fs::write(&c, &bytes).unwrap();
        assert!(same_content(&a, &b).unwrap());
        assert!(!same_content(&a, &c).unwrap());
    }
    #[test]
    fn queue_save_replaces_existing_file_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let mut data = Snapshot::default();
        save(dir.path(), &data).unwrap();
        data.parallel = 3;
        save(dir.path(), &data).unwrap();
        let saved: Snapshot = serde_json::from_slice(&fs::read(dir.path().join("queue.json")).unwrap()).unwrap();
        assert_eq!(saved.parallel, 3);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    #[ignore = "requires yt-dlp, FFmpeg and Deno; uses a generated local fixture only"]
    fn local_media_download_and_wav_conversion() {
        use std::io::Read;
        let dir = tempfile::tempdir().unwrap();
        let fixture = dir.path().join("fixture.mp4");
        let result = command(&binary("ffmpeg").unwrap()).args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        ]).arg(&fixture).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        let bytes = fs::read(fixture).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let finished = Arc::new(AtomicBool::new(false));
        let flag = finished.clone();
        let server = thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                if let Ok((mut stream, _)) = listener.accept() {
                    // Accepted sockets inherit non-blocking mode on Windows; a read before the request arrives would drop it.
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut req = [0u8; 4096];
                    if let Ok(n) = stream.read(&mut req) {
                        let request = String::from_utf8_lossy(&req[..n]);
                        let range = request.lines().find_map(|line| line.strip_prefix("Range: bytes="))
                            .and_then(|value| value.split_once('-'))
                            .and_then(|(start,end)| {
                                let start = start.parse::<usize>().ok()?;
                                let end = if end.is_empty() { bytes.len() - 1 } else { end.parse::<usize>().ok()? };
                                (start < bytes.len()).then_some((start,end.min(bytes.len() - 1)))
                            });
                        let (start,end) = range.unwrap_or((0,bytes.len() - 1));
                        let status = if range.is_some() { "206 Partial Content" } else { "200 OK" };
                        let content_range = if range.is_some() { format!("Content-Range: bytes {start}-{end}/{}\r\n", bytes.len()) } else { String::new() };
                        let headers = format!("HTTP/1.1 {status}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\n{content_range}Content-Length: {}\r\nConnection: close\r\n\r\n", end - start + 1);
                        let _ = stream.write_all(headers.as_bytes());
                        if !request.starts_with("HEAD ") { let _ = stream.write_all(&bytes[start..=end]); }
                    }
                } else { thread::sleep(Duration::from_millis(10)); }
            }
        });
        let job = Job { id: 1, url: format!("http://127.0.0.1:{port}/fixture.mp4"),
            options: Options { folder: dir.path().join("downloads").to_string_lossy().into(), quality: "wav".into(), archive: false, ..Options::default() },
            status: "running".into(), percent: 0.0, speed: String::new(), file: String::new(), log: vec![], scheduled_at: None, auto_retry: false, retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], pid: None, hidden_in_queue: false, hidden_in_library: false };
        let engine = Engine { dir: dir.path().into(), data: Arc::new(Mutex::new(Snapshot { jobs: vec![job.clone()], ..Snapshot::default() })), shutdown: Arc::new(AtomicBool::new(false)) };
        engine.run_job(1);
        let mut mobile_job = job.clone();
        mobile_job.id = 2;
        mobile_job.options = Options { folder: dir.path().join("downloads").to_string_lossy().into(),
            quality: "720".into(), profile: "mobile".into(), archive: false, ..Options::default() };
        engine.data.lock().unwrap().jobs.push(mobile_job);
        engine.run_job(2);
        let mut clip_job = job.clone();
        clip_job.id = 3;
        clip_job.options = Options { folder: dir.path().join("downloads").to_string_lossy().into(),
            quality: "720".into(), clip_start: Some(0.2), clip_end: Some(0.7),
            archive: false, ..Options::default() };
        engine.data.lock().unwrap().jobs.push(clip_job.clone());
        engine.run_job(3);
        let mut gif_job = clip_job;
        gif_job.id = 4;
        gif_job.options.clip_format = "gif".into();
        engine.data.lock().unwrap().jobs.push(gif_job);
        engine.run_job(4);
        finished.store(true, Ordering::Relaxed);
        server.join().unwrap();
        let data = engine.data.lock().unwrap();
        let result = &data.jobs[0];
        assert_eq!(result.status, "done", "{:?}", result.log);
        assert!(result.file.ends_with(".wav"), "{:?}", result);
        assert!(Path::new(&result.file).is_file());
        assert!(fs::metadata(&result.file).unwrap().len() > 1000);
        let mobile = &data.jobs[1];
        assert_eq!(mobile.status, "done", "{:?}", mobile.log);
        assert!(mobile.file.ends_with(".mp4"), "{:?}", mobile);
        let clip = &data.jobs[2];
        assert_eq!(clip.status, "done", "{:?}", clip.log);
        assert!(Path::new(&clip.file).is_file());
        let gif = &data.jobs[3];
        assert_eq!(gif.status, "done", "{:?}", gif.log);
        assert!(gif.file.ends_with(".gif"), "{:?}", gif);
        assert!(Path::new(&gif.file).is_file());
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe; uses only a generated local video"]
    fn local_editor_creates_clip_and_gif() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("sample.mp4");
        let ffmpeg = binary("ffmpeg").unwrap();
        let generated = command(&ffmpeg).args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=12:d=2",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        ]).arg(&source).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
        fs::write(dir.path().join("sample.en.vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n").unwrap();
        let metadata = read_player_metadata(&source).unwrap();
        assert!(metadata.subtitles.as_deref().unwrap_or("").starts_with("data:text/vtt;base64,"));
        assert_eq!(metadata.subtitle_language.as_deref(), Some("en"));
        let still = save_frame(&source, 0.5).unwrap();
        assert_eq!(still.extension().and_then(|value| value.to_str()), Some("png"));
        let probed = || probe_source(&source).unwrap();
        let clip = |start: f64, end: f64, look: ClipLook| ProjectClip { job_id: 1, start, end, look };
        let render = |project: &ProjectExport, name: &str, music: Option<&Source>| {
            let output = dir.path().join(name);
            let sources: Vec<Source> = project.clips.iter().map(|_| probed()).collect();
            let pieces: Vec<Source> = project.audio.iter().map(|_| probed()).collect();
            render_project(&sources, project, music, &pieces, &output, &|_| {}).map(|_| output)
        };
        // Two clips, the second twice as fast with a caption and fades, on a vertical canvas.
        let styled = ClipLook { speed: 2.0, fade_in: true, fade_out: true, rotate: 90, flip: true, brightness: 0.1,
            caption: "\u{41f}\u{440}\u{438}\u{432}\u{435}\u{442} \u{b7} test".into(), caption_style: "box".into(), ..ClipLook::default() };
        let vertical = ProjectExport { clips: vec![clip(0.2, 0.8, ClipLook::default()), clip(0.0, 2.0, styled)],
            canvas: "9:16".into(), fit: "blur".into(), quality: 480, ..ProjectExport::default() };
        let shares = Mutex::new(Vec::new());
        let sources = vec![probed(), probed()];
        let video = dir.path().join("vertical.mp4");
        render_project(&sources, &vertical, None, &[], &video, &|share| shares.lock().unwrap().push(share)).unwrap();
        assert!((video_duration(&video).unwrap() - 1.6).abs() < 0.25, "{}", video_duration(&video).unwrap());
        assert_eq!(probe_source(&video).unwrap().width, 480);
        assert_eq!(probe_source(&video).unwrap().height, 854);
        assert_eq!(shares.lock().unwrap().last().copied(), Some(1.0));
        // Transitions overlap the clips: 1.0 + 1.0 + 1.0 seconds with two half-second transitions.
        let enter = |transition: &str| ClipLook { transition: transition.into(), ..ClipLook::default() };
        let blended = ProjectExport { clips: vec![clip(0.0, 1.0, enter("fade")), clip(0.5, 1.5, enter("fade")), clip(1.0, 2.0, enter("slideleft"))],
            quality: 480, ..ProjectExport::default() };
        let joined = render(&blended, "blended.mp4", None).unwrap();
        assert!((video_duration(&joined).unwrap() - 2.0).abs() < 0.25, "{}", video_duration(&joined).unwrap());
        assert!(media_has_audio(&joined).unwrap());
        let mixed_cuts = ProjectExport { clips: vec![clip(0.0, 1.0, ClipLook::default()), clip(0.0, 1.0, ClipLook::default()), clip(0.0, 1.0, enter("fadeblack"))],
            quality: 480, ..ProjectExport::default() };
        assert!((video_duration(&render(&mixed_cuts, "mixed.mp4", None).unwrap()).unwrap() - 2.5).abs() < 0.25);
        let gif_cuts = ProjectExport { format: "gif".into(), ..mixed_cuts };
        assert!(fs::metadata(render(&gif_cuts, "mixed.gif", None).unwrap()).unwrap().len() > 1000);
        assert!(ClipLook { transition: "spin".into(), ..ClipLook::default() }.validate().is_err());
        // Music under a muted clip, a GIF and an MP3.
        let music_file = dir.path().join("tone.mp3");
        let tone = command(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-c:a", "libmp3lame"])
            .arg(&music_file).output().unwrap();
        assert!(tone.status.success());
        let music = Source { path: music_file, duration: 1.0, has_audio: true, width: 0, height: 0 };
        let with_music = ProjectExport { clips: vec![clip(0.0, 2.0, ClipLook { volume: 0.0, ..ClipLook::default() })],
            music: Some(ProjectMusic { job_id: 3, volume: 0.5 }), quality: 480, ..ProjectExport::default() };
        let mixed = render(&with_music, "music.mp4", Some(&music)).unwrap();
        assert!(media_has_audio(&mixed).unwrap());
        assert!((video_duration(&mixed).unwrap() - 2.0).abs() < 0.25);
        let gif = render(&ProjectExport { clips: vec![clip(0.3, 1.0, ClipLook::default())], canvas: "source".into(),
            format: "gif".into(), quality: 480, ..ProjectExport::default() }, "clip.gif", None).unwrap();
        assert!(fs::metadata(gif).unwrap().len() > 1000);
        let audio = render(&ProjectExport { clips: vec![clip(0.2, 0.8, ClipLook::default())], format: "mp3".into(),
            ..ProjectExport::default() }, "clip.mp3", None).unwrap();
        assert!(media_has_audio(&audio).unwrap());
        // Sound taken off a muted clip plays half a second later over the music; the result keeps the video length.
        let piece = |at: f64| ProjectAudio { job_id: 1, start: 0.0, end: 1.0, at, speed: 1.0, volume: 0.8, fade_in: true, fade_out: false };
        let detached = ProjectExport { clips: vec![clip(0.0, 2.0, ClipLook { volume: 0.0, ..ClipLook::default() })],
            audio: vec![piece(0.5), piece(5.0)], music: Some(ProjectMusic { job_id: 3, volume: 0.5 }), quality: 480, ..ProjectExport::default() };
        let moved = render(&detached, "detached.mp4", Some(&music)).unwrap();
        assert!(media_has_audio(&moved).unwrap());
        assert!((video_duration(&moved).unwrap() - 2.0).abs() < 0.25, "{}", video_duration(&moved).unwrap());
        let moved_audio = render(&ProjectExport { format: "mp3".into(), music: None, ..detached.clone() }, "detached.mp3", None).unwrap();
        assert!((video_duration(&moved_audio).unwrap() - 2.0).abs() < 0.25, "{}", video_duration(&moved_audio).unwrap());
        let outside = ProjectExport { audio: vec![ProjectAudio { end: 9.0, ..piece(0.0) }], ..detached.clone() };
        assert!(render(&outside, "bad-sound.mp4", Some(&music)).is_err());
        // Invalid input is rejected before FFmpeg runs.
        assert!(render(&ProjectExport { clips: vec![clip(1.5, 3.0, ClipLook::default())], ..ProjectExport::default() }, "bad.mp4", None).is_err());
        assert!(ClipLook { speed: 4.0, ..ClipLook::default() }.validate().is_err());
        assert!(ClipLook { rotate: 45, ..ClipLook::default() }.validate().is_err());
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe; uses only generated local audio"]
    fn local_audio_tags_and_normalization() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("tone.mp3");
        let ffmpeg = binary("ffmpeg").unwrap();
        let generated = command(&ffmpeg).args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame",
        ]).arg(&source).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
        let tagged = save_audio_tags(&source, AudioTags {
            title: "Test title".into(), artist: "Test artist".into(),
            album: "Test album".into(), track: "2".into(),
        }).unwrap();
        let info = read_audio_info(&tagged).unwrap();
        assert_eq!(info.title, "Test title");
        assert_eq!(info.artist, "Test artist");
        assert_eq!(info.album, "Test album");
        assert_eq!(info.track, "2");
        assert!(source.is_file());
        let normalized = normalize_audio(&tagged).unwrap();
        assert!(normalized.is_file());
        assert!(fs::metadata(&normalized).unwrap().len() > 1000);
        assert!((read_audio_info(&normalized).unwrap().duration.unwrap() - 2.0).abs() < 0.2);
        assert!(checked_tag("bad\nline").is_err());
    }

    #[test]
    fn scheduled_jobs_wait_and_transient_errors_retry() {
        let mut job = Job { id: 1, url: "https://example.com".into(), options: Options::default(),
            status: "queued".into(), percent: 0.0, speed: String::new(), file: String::new(),
            log: vec![], scheduled_at: Some(200), auto_retry: true, retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], pid: None, hidden_in_queue: false, hidden_in_library: false };
        assert!(!ready_to_run(&job, 199));
        assert!(ready_to_run(&job, 200));
        job.status = "paused".into();
        assert!(!ready_to_run(&job, 300));
        let old = serde_json::json!({"id":1,"url":"https://example.com","options":job.options,
            "status":"queued","percent":0,"speed":"","file":"","log":[]});
        let restored: Job = serde_json::from_value(old).unwrap();
        assert!(ready_to_run(&restored, 0));
        assert!(!restored.auto_retry);
        assert!(transient_download_error(&["ERROR: HTTP Error 503: Service Unavailable".into()]));
        assert!(!transient_download_error(&["ERROR: Sign in to confirm your age".into()]));
        job.status = "error".into(); job.log = vec!["ERROR: HTTP Error 503: Service Unavailable".into()];
        assert!(schedule_retry(&mut job));
        assert_eq!(job.status, "queued");
        assert_eq!(job.retry_attempts, 1);
        assert!(job.scheduled_at.unwrap() > now_seconds());
        job.retry_attempts = 2;
        assert!(!schedule_retry(&mut job));
    }}
