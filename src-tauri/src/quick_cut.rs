//! A separate, keyframe-aligned stream-copy export. The rendered editor path is unchanged.
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, fs, io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, thread, time::{Duration, Instant, SystemTime}};
use tauri::Emitter;

const CANCELLED: &str = "Lossless trim was cancelled.";
const MAX_PROBE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Default)]
pub struct QuickCut { inner: Arc<Inner> }
#[derive(Default)]
struct Inner { control: Mutex<()>, busy: AtomicBool, stop: AtomicBool, pid: Mutex<Option<u32>>, sources: Mutex<HashMap<PathBuf, Source>> }
struct Operation(QuickCut);
impl Drop for Operation { fn drop(&mut self) { *self.0.inner.pid.lock().unwrap() = None; self.0.inner.busy.store(false, Ordering::Release); } }
impl QuickCut {
    fn begin(&self) -> Result<Operation, String> {
        let _control = self.inner.control.lock().unwrap();
        if self.inner.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() { return Err("A lossless trim is already running.".into()); }
        self.inner.stop.store(false, Ordering::Release);
        Ok(Operation(self.clone()))
    }
    fn check(&self) -> Result<(), String> { if self.inner.stop.load(Ordering::Acquire) { Err(CANCELLED.into()) } else { Ok(()) } }
    fn cancel(&self) {
        let _control = self.inner.control.lock().unwrap();
        self.inner.stop.store(true, Ordering::Release);
        if let Some(pid) = *self.inner.pid.lock().unwrap() { super::kill_tree(pid); }
    }
}

#[derive(Clone)]
struct Source { path: PathBuf, bytes: u64, modified: Option<SystemTime>, duration: f64,
    codec: String, frame_rate: String, container: String, keyframes: Vec<f64>, chapters: Vec<Value> }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutPlan { pub requested_start: f64, pub requested_end: f64, pub start: f64, pub end: f64,
    pub source_duration: f64, pub container: String, pub codec: String, pub frame_rate: String }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutResult { path: String, plan: CutPlan, duration: f64 }

fn number(value: &Value) -> Option<f64> { value.as_f64().or_else(|| value.as_str().and_then(|s| s.parse().ok())).filter(|n| n.is_finite()) }
fn container(path: &Path) -> Result<String, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["mp4", "mov", "mkv", "webm"].contains(&ext.as_str()) { return Err("Lossless trim supports MP4, MOV, MKV and WebM source files.".into()); }
    Ok(ext)
}

// Child output is bounded; both pipes are drained, and cancellation/timeouts always reap the child.
fn execute(state: &QuickCut, mut command: Command, timeout: Duration, progress: Option<(&dyn Fn(f64), f64)>) -> Result<Vec<u8>, String> {
    state.check()?;
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("Could not start the lossless trim tool: {e}"))?;
    *state.inner.pid.lock().unwrap() = Some(child.id());
    let overflow = Arc::new(AtomicBool::new(false));
    let output_overflow = overflow.clone();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (updates, incoming) = mpsc::channel();
    let report = progress.is_some();
    let output = thread::spawn(move || {
        if report {
            let mut count = 0usize;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                count += line.len();
                if count > MAX_PROBE_BYTES { output_overflow.store(true, Ordering::Release); break; }
                if let Some(value) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()).filter(|n| n.is_finite()) { let _ = updates.send(value / 1_000_000.0); }
            }
            Vec::new()
        } else {
            let mut bytes = Vec::new();
            let _ = stdout.take(MAX_PROBE_BYTES as u64 + 1).read_to_end(&mut bytes);
            if bytes.len() > MAX_PROBE_BYTES { output_overflow.store(true, Ordering::Release); }
            bytes
        }
    });
    let errors = thread::spawn(move || {
        let mut tail = Vec::new(); let mut reader = stderr; let mut chunk = [0u8; 4096];
        while let Ok(count) = reader.read(&mut chunk) { if count == 0 { break; } tail.extend_from_slice(&chunk[..count]); if tail.len() > 8192 { tail.drain(..tail.len() - 8192); } }
        String::from_utf8_lossy(&tail).into_owned()
    });
    let deadline = Instant::now() + timeout;
    let mut failure = None;
    let status = loop {
        if let Some((callback, seconds)) = progress { for position in incoming.try_iter() { callback((position / seconds).clamp(0.0, 0.99)); } }
        if state.inner.stop.load(Ordering::Acquire) { failure = Some(CANCELLED.to_owned()); }
        else if overflow.load(Ordering::Acquire) { failure = Some("The source has too many keyframes for lossless trim.".into()); }
        else if Instant::now() >= deadline { failure = Some("Lossless trim timed out. Try a shorter source file.".into()); }
        if failure.is_some() { super::kill_tree(child.id()); let _ = child.kill(); break child.wait(); }
        match child.try_wait() { Ok(Some(status)) => break Ok(status), Ok(None) => thread::sleep(Duration::from_millis(20)), Err(e) => { let _ = child.kill(); let _ = child.wait(); break Err(e); } }
    };
    *state.inner.pid.lock().unwrap() = None;
    let bytes = output.join().unwrap_or_default(); let detail = errors.join().unwrap_or_default();
    if let Some((callback, seconds)) = progress { for position in incoming.try_iter() { callback((position / seconds).clamp(0.0, 0.99)); } }
    state.check()?;
    if let Some(failure) = failure { return Err(failure); }
    if overflow.load(Ordering::Acquire) { return Err("The source has too many keyframes for lossless trim.".into()); }
    if !status.map_err(|e| e.to_string())?.success() {
        return Err(format!("Could not copy this source without re-encoding: {}", detail.trim().chars().take(600).collect::<String>()));
    }
    Ok(bytes)
}

fn metadata(state: &QuickCut, path: &Path) -> Result<Value, String> {
    let mut cmd = super::command(&super::binary("ffprobe")?);
    cmd.args(["-v", "error", "-show_entries", "format=duration,start_time,format_name:stream=index,codec_type,codec_name,avg_frame_rate,start_time:stream_disposition=attached_pic:chapter=start_time,end_time:chapter_tags", "-show_chapters", "-of", "json"]).arg(path);
    serde_json::from_slice(&execute(state, cmd, Duration::from_secs(30), None)?).map_err(|_| "Could not read the source video information.".into())
}

fn inspect(state: &QuickCut, path: &Path) -> Result<Source, String> {
    let path = path.canonicalize().map_err(|_| "The source file was not found.")?;
    let stat = fs::metadata(&path).map_err(|e| e.to_string())?;
    if let Some(source) = state.inner.sources.lock().unwrap().get(&path).filter(|s| s.bytes == stat.len() && s.modified == stat.modified().ok()) { return Ok(source.clone()); }
    let container = container(&path)?;
    let value = metadata(state, &path)?;
    let duration = number(&value["format"]["duration"]).filter(|n| *n >= 0.1 && *n <= 7.0 * 24.0 * 3600.0).ok_or("Could not read a finite source duration.")?;
    let origin = number(&value["format"]["start_time"]).unwrap_or(0.0);
    let videos: Vec<_> = value["streams"].as_array().into_iter().flatten().filter(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_u64() != Some(1)).collect();
    if videos.len() > 1 { return Err("Lossless trim supports one video track. Use the normal export for this source.".into()); }
    let video = videos.first().ok_or("The source has no video track.")?;
    let video_index = video["index"].as_u64().ok_or("Could not read the source video information.")?;
    let mut cmd = super::command(&super::binary("ffprobe")?);
    cmd.args(["-v", "error", "-skip_frame", "nokey", "-select_streams", &video_index.to_string(), "-show_frames", "-show_entries", "frame=best_effort_timestamp_time,key_frame", "-of", "json"]).arg(&path);
    let frames: Value = serde_json::from_slice(&execute(state, cmd, Duration::from_secs(120), None)?).map_err(|_| "Could not read the video keyframes.")?;
    let mut keyframes: Vec<f64> = frames["frames"].as_array().ok_or("Could not read the video keyframes.")?.iter()
        .filter(|frame| frame["key_frame"].as_u64() == Some(1)).filter_map(|frame| number(&frame["best_effort_timestamp_time"]))
        .map(|at| at - origin).filter(|at| *at >= -0.05 && *at < duration).map(|at| at.max(0.0)).collect();
    keyframes.sort_by(f64::total_cmp); keyframes.dedup_by(|a, b| (*a - *b).abs() < 0.000_001);
    if keyframes.is_empty() { return Err("This source has no readable video keyframes.".into()); }
    let source = Source { path: path.clone(), bytes: stat.len(), modified: stat.modified().ok(), duration,
        codec: video["codec_name"].as_str().unwrap_or("video").to_owned(), frame_rate: video["avg_frame_rate"].as_str().unwrap_or("").to_owned(), container, keyframes,
        chapters: value["chapters"].as_array().cloned().unwrap_or_default() };
    let mut cache = state.inner.sources.lock().unwrap();
    if cache.len() >= 4 { cache.clear(); } cache.insert(path, source.clone());
    Ok(source)
}

fn plan(source: &Source, start: f64, end: f64) -> Result<CutPlan, String> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end - start < 0.1 - 1e-9 || end > source.duration + 0.001 {
        return Err("Keep at least 0.1 seconds within the source duration.".into());
    }
    let first = source.keyframes.iter().copied().take_while(|at| *at <= start + 0.000_001).last().ok_or("The selected start is before the first readable keyframe.")?;
    let last = source.keyframes.iter().copied().find(|at| *at >= end - 0.000_001).unwrap_or(source.duration);
    Ok(CutPlan { requested_start: start, requested_end: end.min(source.duration), start: first, end: last,
        source_duration: source.duration, container: source.container.clone(), codec: source.codec.clone(), frame_rate: source.frame_rate.clone() })
}

fn output_path(source: &Source, folder: &str) -> Result<PathBuf, String> {
    let base = super::export_base(&source.path, folder)?;
    let stem = base.file_stem().unwrap_or_default().to_string_lossy();
    let dir = base.parent().ok_or("The export folder was not found.")?;
    for index in 0..10_000 {
        let suffix = if index == 0 { String::new() } else { format!(" ({index})") };
        let target = dir.join(format!("{stem} - Lossless{suffix}.{}", source.container));
        if !target.exists() { return Ok(target); }
    }
    Err("Could not choose an unused output filename.".into())
}

fn chapter_metadata(source: &Source, plan: &CutPlan) -> Result<tempfile::NamedTempFile, String> {
    fn escape(value: &str) -> String {
        let mut result=String::new();for c in value.chars(){if matches!(c,'\\'|'='|';'|'#'|'\n'|'\r'){result.push('\\');}result.push(c);}result
    }
    let mut text=String::from(";FFMETADATA1\n");
    for chapter in &source.chapters {
        let Some(first)=number(&chapter["start_time"]) else{continue;};let Some(last)=number(&chapter["end_time"]) else{continue;};
        let start=(first-plan.start).max(0.0);let end=(last-plan.start).min(plan.end-plan.start);
        if end<=start {continue;}
        text.push_str(&format!("[CHAPTER]\nTIMEBASE=1/1000000\nSTART={}\nEND={}\n",(start*1_000_000.0).round()as u64,(end*1_000_000.0).round()as u64));
        if let Some(tags)=chapter["tags"].as_object(){for (key,value)in tags{if let Some(value)=value.as_str(){text.push_str(&format!("{}={}\n",escape(key),escape(value)));}}}
    }
    let mut file=tempfile::Builder::new().prefix("deviload-chapters-").suffix(".ffmeta").tempfile().map_err(|_|"Could not prepare the trimmed chapters.")?;
    file.write_all(text.as_bytes()).map_err(|_|"Could not prepare the trimmed chapters.")?;file.flush().map_err(|_|"Could not prepare the trimmed chapters.")?;Ok(file)
}

fn validate_copy(saved: &Value, planned: &CutPlan) -> Result<f64, String> {
    let duration=number(&saved["format"]["duration"]).filter(|n|*n>0.0).ok_or("The copied video is empty.")?;
    let video=saved["streams"].as_array().and_then(|s|s.iter().find(|s|s["codec_type"]=="video"&&s["disposition"]["attached_pic"].as_u64()!=Some(1))).ok_or("The copied video is empty.")?;
    let start=number(&video["start_time"]).unwrap_or(0.0);
    // B-frame/audio preroll is normal, but a long subtitle packet must not create a blank lead or an extended tail.
    if number(&saved["format"]["start_time"]).unwrap_or(0.0) < -0.05||!(-0.05..=0.35).contains(&start)||(duration-(planned.end-planned.start)).abs()>0.35 {
        return Err("Copied audio or subtitle packets extend outside this cut. Pick another range or use the normal export.".into());
    }
    if saved["chapters"].as_array().into_iter().flatten().any(|c|match(number(&c["start_time"]),number(&c["end_time"])){(Some(a),Some(b))=>a<0.0||b<=a||b>duration+0.05,_=>true}) {
        return Err("Could not preserve the trimmed chapter timing. Use the normal export.".into());
    }
    Ok(duration)
}

fn export(state: &QuickCut, source: &Source, plan: CutPlan, folder: &str, progress: &dyn Fn(f64)) -> Result<CutResult, String> {
    state.check()?;
    let output = output_path(source, folder)?;
    // A unique temporary file is the only path FFmpeg may replace. persist_noclobber never replaces a user's file.
    let part = tempfile::Builder::new().prefix(".deviload-lossless-").suffix(".part").tempfile_in(output.parent().unwrap()).map_err(|e| e.to_string())?.into_temp_path();
    let mut cmd = super::command(&super::binary("ffmpeg")?);
    let muxer = match source.container.as_str() { "mkv" => "matroska", "mov" => "mov", "webm" => "webm", _ => "mp4" };
    // Raw source chapter/data streams would retain stale timestamps. Regenerate clipped chapter metadata instead.
    let chapters = chapter_metadata(source,&plan)?;
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-progress", "pipe:1", "-nostats", "-y", "-ss", &format!("{:.9}", plan.start), "-i"])
        .arg(&source.path).args(["-f","ffmetadata","-i"]).arg(chapters.path())
        .args(["-t", &format!("{:.9}", plan.end - plan.start), "-map", "0:v", "-map", "0:a?", "-map", "0:s?", "-map", "0:t?", "-map_metadata", "0", "-map_chapters", "1", "-c", "copy", "-avoid_negative_ts", "disabled", "-f", muxer]).arg(part.as_os_str());
    execute(state, cmd, Duration::from_secs(600), Some((progress, plan.end - plan.start)))?;
    state.check()?;
    let saved = metadata(state, &part)?;
    let duration = validate_copy(&saved,&plan)?;
    // Recheck immediately before publishing so cancellation never exposes an unfinished result.
    state.check()?;
    part.persist_noclobber(&output).map_err(|_| "Could not save the lossless copy. No existing file was replaced.")?;
    progress(1.0);
    Ok(CutResult { path: output.to_string_lossy().into_owned(), plan, duration })
}

fn allowed(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "devilcut" { Ok(()) } else { Err("Open Devil Cut to use lossless trim.".into()) } }

#[tauri::command]
pub async fn quick_cut_plan(window: tauri::WebviewWindow, id: u64, start: f64, end: f64, engine: tauri::State<'_, super::Engine>, state: tauri::State<'_, QuickCut>) -> Result<CutPlan, String> {
    allowed(&window)?; let path = super::completed_video(&engine, id)?; let state = state.inner().clone(); let operation = state.begin()?;
    tauri::async_runtime::spawn_blocking(move || { let _operation = operation; let source = inspect(&state, &path)?; plan(&source, start, end) }).await.map_err(|_| "Could not inspect the source keyframes.".to_owned())?
}

#[tauri::command]
pub async fn quick_cut_export(window: tauri::WebviewWindow, id: u64, start: f64, end: f64, folder: String, engine: tauri::State<'_, super::Engine>, state: tauri::State<'_, QuickCut>) -> Result<CutResult, String> {
    allowed(&window)?; let path = super::completed_video(&engine, id)?; let state = state.inner().clone(); let operation = state.begin()?;
    tauri::async_runtime::spawn_blocking(move || { let _operation = operation; let source = inspect(&state, &path)?; let planned = plan(&source, start, end)?;
        export(&state, &source, planned, &folder, &|share| { let _ = window.emit("quick-cut-progress", share); }) }).await.map_err(|_| "Could not save the lossless copy.".to_owned())?
}

#[tauri::command]
pub fn quick_cut_stop(window: tauri::WebviewWindow, state: tauri::State<'_, QuickCut>) -> Result<(), String> { allowed(&window)?; state.cancel(); Ok(()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn fake() -> Source { Source { path: PathBuf::from("video.mp4"), bytes: 0, modified: None, duration: 10.0,
        codec: "h264".into(), frame_rate: "25/1".into(), container: "mp4".into(), keyframes: vec![0.0, 2.0, 4.0, 6.0, 8.0], chapters:vec![] } }
    #[test]
    fn requested_range_snaps_outward_to_real_keyframes_and_validates_finite_bounds() {
        let source = fake(); let p = plan(&source, 2.45, 5.1).unwrap(); assert_eq!((p.start, p.end), (2.0, 6.0));
        assert_eq!((plan(&source, 2.0, 4.0).unwrap().start, plan(&source, 2.0, 4.0).unwrap().end), (2.0, 4.0));
        assert_eq!(plan(&source, 8.5, 10.0).unwrap().end, 10.0);
        for (a,b) in [(f64::NAN, 2.0), (1.0,f64::INFINITY), (-1.0,3.0), (1.0,1.01), (9.0,11.0)] { assert!(plan(&source,a,b).is_err()); }
        assert!(container(Path::new("video.ts")).is_err());
    }
    #[test]
    fn operation_guard_rejects_overlap_and_releases_after_cancel() {
        let state = QuickCut::default(); let operation = state.begin().unwrap(); assert!(state.begin().is_err()); state.cancel(); assert_eq!(state.check().unwrap_err(), CANCELLED);
        drop(operation); let _next = state.begin().unwrap(); assert!(state.check().is_ok());
    }
    #[test]
    fn copied_packet_overshoot_and_invalid_chapters_are_rejected_before_publication() {
        let planned=plan(&fake(),2.45,5.1).unwrap();
        let mut saved=serde_json::json!({"format":{"duration":"4.08","start_time":"0"},"streams":[{"codec_type":"video","start_time":"0"}],"chapters":[{"start_time":"0","end_time":"4"}]});
        assert!(validate_copy(&saved,&planned).is_ok());
        saved["format"]["duration"]=serde_json::json!("6");assert!(validate_copy(&saved,&planned).is_err());
        saved["format"]["duration"]=serde_json::json!("4.08");saved["chapters"][0]["end_time"]=serde_json::json!("0");assert!(validate_copy(&saved,&planned).is_err());
    }

    fn probe_test(path: &Path, arguments: &[&str]) -> Value {
        let output = super::super::command(&super::super::binary("ffprobe").unwrap()).args(["-v", "error"]).args(arguments).args(["-of", "json"]).arg(path).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr)); serde_json::from_slice(&output.stdout).unwrap()
    }
    fn fixture(dir: &Path) -> PathBuf {
        let captions = dir.join("captions.srt"); let tags = dir.join("chapters.txt"); let source = dir.join("source.mp4");
        fs::write(&captions, "1\n00:00:01,000 --> 00:00:07,000\nOriginal subtitle\n").unwrap();
        fs::write(&tags, ";FFMETADATA1\ntitle=Original title\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=Before\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2000\nEND=5000\ntitle=Middle\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=5000\nEND=8000\ntitle=After\n").unwrap();
        let generated = super::super::command(&super::super::binary("ffmpeg").unwrap()).args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=8",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-f", "lavfi", "-i", "sine=frequency=660:duration=8", "-i"])
            .arg(&captions).args(["-f", "ffmetadata", "-i"]).arg(&tags)
            .args(["-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-map", "3:s:0", "-map_metadata", "4", "-map_chapters", "4", "-t", "8",
                "-c:v", "libx264", "-g", "50", "-keyint_min", "50", "-sc_threshold", "0", "-bf", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:s", "mov_text"])
            .arg(&source).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr)); source
    }
    #[test]
    fn real_non_keyframe_trim_preserves_codecs_fps_tracks_chapters_and_source_and_cleans_cancelled_output() {
        let dir = tempfile::tempdir().unwrap(); let path = fixture(dir.path()); let original = fs::read(&path).unwrap();
        let state = QuickCut::default(); let operation = state.begin().unwrap(); let source = inspect(&state, &path).unwrap();
        let planned = plan(&source, 2.45, 5.1).unwrap(); assert_eq!((planned.start,planned.end), (2.0,6.0));
        let occupied = dir.path().join("source - Lossless.mp4"); fs::write(&occupied,b"existing user file").unwrap();
        let result = export(&state,&source,planned,"",&|_|{}).unwrap(); let output = Path::new(&result.path);
        assert_ne!(output, path); assert_ne!(output, occupied); assert_eq!(fs::read(&occupied).unwrap(),b"existing user file");
        assert_eq!(fs::read(&path).unwrap(),original);
        let info = probe_test(output,&["-show_streams","-show_format","-show_chapters"]);
        let streams = info["streams"].as_array().unwrap(); let video = streams.iter().find(|s|s["codec_type"]=="video").unwrap();
        assert_eq!(video["codec_name"], "h264"); assert_eq!(video["avg_frame_rate"], "25/1");
        assert_eq!(streams.iter().filter(|s|s["codec_type"]=="audio"&&s["codec_name"]=="aac").count(),2);
        assert_eq!(streams.iter().filter(|s|s["codec_type"]=="subtitle"&&s["codec_name"]=="mov_text").count(),1);
        assert_eq!(info["format"]["tags"]["title"],"Original title");
        assert!((3.9..=4.35).contains(&result.duration),"{}",result.duration);
        let chapters = info["chapters"].as_array().unwrap(); assert!(!chapters.is_empty());
        for chapter in chapters { let start=number(&chapter["start_time"]).unwrap();let end=number(&chapter["end_time"]).unwrap();assert!(start>=0.0&&end>start&&end<=result.duration+0.05,"{chapter}"); }
        let packets=probe_test(output,&["-select_streams","v:0","-show_packets","-show_entries","packet=pts_time,dts_time,flags","-read_intervals","%+#1"]);
        let first=&packets["packets"][0]; assert!(first["flags"].as_str().unwrap().contains('K')); assert!(number(&first["pts_time"]).unwrap()>=-0.001);
        let decoded=super::super::command(&super::super::binary("ffmpeg").unwrap()).args(["-v","error","-i"]).arg(output).args(["-map","0:v:0","-f","null","-"]).output().unwrap();
        assert!(decoded.status.success(),"{}",String::from_utf8_lossy(&decoded.stderr)); assert!(decoded.stderr.is_empty(),"{}",String::from_utf8_lossy(&decoded.stderr));
        drop(operation);
        let _operation=state.begin().unwrap();let before=fs::read_dir(dir.path()).unwrap().count();
        let cancelled=export(&state,&source,plan(&source,1.1,3.1).unwrap(),"",&|share|if share>0.0{state.cancel();});
        assert_eq!(cancelled.unwrap_err(),CANCELLED);assert_eq!(fs::read_dir(dir.path()).unwrap().count(),before);assert_eq!(fs::read(&path).unwrap(),original);
        assert!(state.inner.pid.lock().unwrap().is_none());
    }
    #[test]
    fn cancelling_a_running_ffmpeg_process_reaps_it() {
        let state=QuickCut::default();let _operation=state.begin().unwrap();let control=state.clone();
        let cancel=thread::spawn(move||{for _ in 0..5000{let running=control.inner.pid.lock().unwrap().is_some();if running{control.cancel();return;}thread::sleep(Duration::from_millis(2));}panic!("FFmpeg did not start");});
        let mut cmd=super::super::command(&super::super::binary("ffmpeg").unwrap());cmd.args(["-v","error","-re","-f","lavfi","-i","sine=duration=4","-f","null","-"]);
        let started=Instant::now();assert_eq!(execute(&state,cmd,Duration::from_secs(10),None).unwrap_err(),CANCELLED);cancel.join().unwrap();
        assert!(started.elapsed()<Duration::from_secs(12));assert!(state.inner.pid.lock().unwrap().is_none());
    }
}
