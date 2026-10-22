// The converter: a video or audio file from the disk becomes MP4, MP3 or a GIF,
// or a video squeezed under a size limit for messengers and mail. The source file
// is never changed; results are written next to it under a new name.
use super::{binary, command, ffmpeg_command, write_to};
#[cfg(unix)]
use super::kill_tree;
use serde::{Deserialize, Serialize};
use std::{
    fs, io::{BufRead, BufReader, Read}, path::{Path, PathBuf}, process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, thread, time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const MEDIA: [&str; 24] = ["mp4", "mkv", "webm", "mov", "m4v", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "3gp", "gif",
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff", "aif", "mka"];
const MAX_FILES: usize = 100;
const MAX_GIF_SECONDS: f64 = 60.0;
const MAX_PROBE_BYTES: usize = 1024 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct Converter {
    // The running FFprobe or FFmpeg; zero between child processes.
    pid: Mutex<Option<u32>>,
    stop: AtomicBool,
    // Files handed over by the main window before the converter window finished loading.
    pending: Mutex<Vec<String>>,
}

struct Operation<'a>(&'a Converter);
impl Drop for Operation<'_> {
    fn drop(&mut self) { *self.0.pid.lock().unwrap() = None; }
}
fn begin(state: &Converter) -> Result<Operation<'_>, String> {
    let mut pid = state.pid.lock().unwrap();
    if pid.is_some() { return Err("Another file is being converted".into()); }
    state.stop.store(false, Ordering::Release);
    *pid = Some(0);
    Ok(Operation(state))
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    path: String, name: String, bytes: u64, duration: f64, video: bool, audio: bool,
    width: u32, height: u32, video_codec: String, audio_codec: String, error: String,
    video_index: u32, tracks: Vec<MediaTrack>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaTrack {
    index: u32, kind: String, codec: String, language: String, title: String,
    default: bool, channels: u32, width: u32, height: u32,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Conversion {
    path: String, preset: String, #[serde(default)] megabytes: u32, #[serde(default)] folder: String,
    #[serde(default)] resolution: String, #[serde(default)] quality: String,
    #[serde(default)] container: String, #[serde(default)] video_track: Option<u32>,
    // None preserves the old first-audio/no-subtitle contract. An explicit empty
    // list means omit that track type, never fall back to an unrelated stream.
    #[serde(default)] audio_tracks: Option<Vec<u32>>, #[serde(default)] subtitle_tracks: Option<Vec<u32>>,
}

#[derive(Debug)]
enum ProcessFailure { Stopped, Timeout, Overflow, Io }

fn terminate_child(child: &mut Child) {
    // These fixed FFprobe/FFmpeg commands do not launch external tools. Windows
    // Child::kill uses the owned process handle, so there is no taskkill process,
    // UI-dispatcher wait or PID-reuse race. Unix also ends the child's group.
    #[cfg(unix)] kill_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

// Only the conversion worker terminates/reaps children. Stop and window-close
// callbacks just publish the flag; this loop observes it even with silent stdout.
fn wait_child(child: &mut Child, state: Option<&Converter>, timeout: Option<Duration>, overflow: Option<&AtomicBool>, mut tick: impl FnMut()) -> Result<ExitStatus, ProcessFailure> {
    let deadline = timeout.map(|timeout| Instant::now() + timeout);
    loop {
        tick();
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {},
            Err(_) => { terminate_child(child); return Err(ProcessFailure::Io); }
        }
        let failure = if state.is_some_and(|state| state.stop.load(Ordering::Acquire)) { Some(ProcessFailure::Stopped) }
            else if overflow.is_some_and(|overflow| overflow.load(Ordering::Acquire)) { Some(ProcessFailure::Overflow) }
            else if deadline.is_some_and(|deadline| Instant::now() >= deadline) { Some(ProcessFailure::Timeout) }
            else { None };
        if let Some(failure) = failure { terminate_child(child); return Err(failure); }
        thread::sleep(Duration::from_millis(20));
    }
}

// FFprobe can stall on damaged media or a slow filesystem. Its output and
// lifetime are bounded, and an active conversion exposes its real child PID to
// Stop/Close just as FFmpeg does. The child is always killed/reaped on failure.
fn probe_process(state: Option<&Converter>, mut cmd: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let stopped = || state.is_some_and(|state| state.stop.load(Ordering::Acquire));
    if stopped() { return Err("The conversion was stopped".into()); }
    #[cfg(unix)] { use std::os::unix::process::CommandExt; cmd.process_group(0); }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|_| "FFprobe could not read the file".to_string())?;
    if let Some(state) = state { started(state, child.id()); }
    let stdout = child.stdout.take().unwrap();
    let overflow = Arc::new(AtomicBool::new(false));
    let output_overflow = overflow.clone();
    let output = thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(MAX_PROBE_BYTES as u64 + 1).read_to_end(&mut bytes);
        if bytes.len() > MAX_PROBE_BYTES { output_overflow.store(true, Ordering::Release); }
        result.map(|_| bytes)
    });
    let status = wait_child(&mut child, state, Some(timeout), Some(&overflow), || {});
    if let Some(state) = state { *state.pid.lock().unwrap() = Some(0); }
    let output = output.join().unwrap_or_else(|_| Err(std::io::Error::other("probe reader failed")));
    if stopped() { return Err("The conversion was stopped".into()); }
    let status = status.map_err(|failure| match failure {
        ProcessFailure::Stopped => "The conversion was stopped",
        ProcessFailure::Timeout => "Reading the media file timed out. Try copying it to a local folder.",
        ProcessFailure::Overflow => "The media file contains too much information to inspect safely.",
        ProcessFailure::Io => "FFprobe could not read the file",
    }.to_string())?;
    let bytes = output.map_err(|_| "FFprobe could not read the file".to_string())?;
    if overflow.load(Ordering::Acquire) || bytes.len() > MAX_PROBE_BYTES {
        return Err("The media file contains too much information to inspect safely.".into());
    }
    if !status.success() { return Err("FFprobe could not read the file".into()); }
    Ok(bytes)
}

fn probe(path: &Path) -> Result<MediaFile, String> { probe_with_state(path, None) }

fn probe_with_state(path: &Path, state: Option<&Converter>) -> Result<MediaFile, String> {
    if state.is_some_and(|state| state.stop.load(Ordering::Acquire)) { return Err("The conversion was stopped".into()); }
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !MEDIA.contains(&extension.as_str()) { return Err("This file type is not supported".into()); }
    let meta = fs::metadata(path).map_err(|_| "The file was not found".to_string())?;
    if !meta.is_file() { return Err("The file was not found".into()); }
    let mut cmd = command(&binary("ffprobe")?);
    cmd.args(["-v", "error", "-show_entries", "stream=index,codec_type,codec_name,width,height,channels:stream_disposition=attached_pic,default:stream_tags=rotate,language,title:stream_side_data=rotation:format=duration", "-of", "json"]).arg(path);
    let output = probe_process(state, cmd, PROBE_TIMEOUT)?;
    let info: serde_json::Value = serde_json::from_slice(&output).map_err(|_| "FFprobe could not read the file".to_string())?;
    let streams = info["streams"].as_array().cloned().unwrap_or_default();
    if streams.len() > 128 { return Err("This file has too many media tracks to inspect safely.".into()); }
    let tracks = streams.iter().filter(|s| s["disposition"]["attached_pic"].as_i64() != Some(1))
        .filter_map(|s| {
            let kind = s["codec_type"].as_str()?;
            if !["video", "audio", "subtitle"].contains(&kind) { return None; }
            Some(MediaTrack { index: u32::try_from(s["index"].as_u64()?).ok()?, kind:kind.into(),
                codec:s["codec_name"].as_str().unwrap_or("").chars().take(40).collect(),
                language:s["tags"]["language"].as_str().unwrap_or("").chars().take(32).collect(),
                title:s["tags"]["title"].as_str().unwrap_or("").chars().take(160).collect(),
                default:s["disposition"]["default"].as_i64() == Some(1),
                channels:s["channels"].as_u64().unwrap_or(0).min(64) as u32,
                width:s["width"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32,
                height:s["height"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32 })
        }).collect();
    // Cover art inside an audio file is a still picture, not a video.
    let video_stream = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64() != Some(1));
    let audio_stream = streams.iter().find(|s| s["codec_type"] == "audio");
    let video = video_stream.is_some();
    let audio = audio_stream.is_some();
    let duration = info["format"]["duration"].as_str().and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
    let Some(duration) = duration.filter(|_| video || audio) else { return Err("This is not a video or an audio file".into()) };
    let mut width = video_stream.and_then(|s| s["width"].as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32;
    let mut height = video_stream.and_then(|s| s["height"].as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32;
    let rotation = video_stream.and_then(|s| s["side_data_list"].as_array().and_then(|data| data.iter().find_map(|entry| entry["rotation"].as_f64()))
        .or_else(|| s["tags"]["rotate"].as_str().and_then(|text| text.parse::<f64>().ok()))).unwrap_or(0.0);
    // FFmpeg autorotates during conversion; show the upright source dimensions too.
    if rotation.is_finite() && (rotation.rem_euclid(180.0) - 90.0).abs() < 1.0 { std::mem::swap(&mut width, &mut height); }
    Ok(MediaFile { path: path.to_string_lossy().into(), name: file_name(path), bytes: meta.len(), duration, video, audio,
        width, height, video_codec: video_stream.and_then(|s| s["codec_name"].as_str()).unwrap_or("").into(),
        audio_codec: audio_stream.and_then(|s| s["codec_name"].as_str()).unwrap_or("").into(),
        video_index: video_stream.and_then(|s| s["index"].as_u64()).unwrap_or(0) as u32, tracks, error: String::new() })
}

fn file_name(path: &Path) -> String { path.file_name().unwrap_or_default().to_string_lossy().into() }

fn output_path(source: &Path, label: &str, extension: &str) -> Result<PathBuf, String> {
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    for index in 1..10000 {
        let number = if index == 1 { String::new() } else { format!(" {index}") };
        let path = source.with_file_name(format!("{stem} - {label}{number}.{extension}"));
        if !path.exists() { return Ok(path); }
    }
    Err("Could not pick a name for the new file".into())
}

// Unlike rename() on Unix, persist_noclobber never replaces a file that appeared
// after output_path checked it. TempPath removes an unfinished result on failure.
fn publish(part: &Path, output: &Path) -> Result<PathBuf, String> {
    let path = tempfile::TempPath::try_from_path(part).map_err(|e| format!("Could not save the file: {e}"))?;
    path.persist_noclobber(output).map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists { "The result filename is already used. Retry the conversion.".into() }
        else { format!("Could not save the file: {}", e.error) }
    })?;
    Ok(output.to_path_buf())
}

fn quality(value: &str) -> Result<(u8, u32), String> {
    match value {
        "" => Ok((20, 320)), // Keep old callers' MP4 and MP3 defaults.
        "balanced" => Ok((20, 192)), "high" => Ok((18, 320)), "smaller" => Ok((26, 128)),
        _ => Err("Unknown conversion quality".into()),
    }
}

fn resolution(value: &str) -> Result<Option<u32>, String> {
    match value {
        "" | "original" => Ok(None), "1080" => Ok(Some(1080)), "720" => Ok(Some(720)), "480" => Ok(Some(480)),
        _ => Err("Unknown output resolution".into()),
    }
}

// This is a ceiling, independent of compression. A portrait source turns the
// same box upright. FFmpeg keeps SAR to preserve display aspect when rounding.
fn scale_filter(value: &str, automatic: Option<u32>) -> Result<String, String> {
    let requested = resolution(value)?;
    let limit = match (requested, automatic) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) };
    let Some(short) = limit else { return Ok("scale=trunc(iw/2)*2:trunc(ih/2)*2".into()) };
    let long = match short { 1080 => 1920, 720 => 1280, 480 => 854, _ => 640 };
    let factor = format!("min(1,min(if(gte(iw,ih),{long},{short})/iw,if(gte(iw,ih),{short},{long})/ih))");
    Ok(format!("scale=w='max(2,trunc(iw*{factor}/2)*2)':h='max(2,trunc(ih*{factor}/2)*2)'"))
}

fn check_space(base: &Path, target_bytes: u64) -> Result<(), String> {
    if let Some(parent) = base.parent() {
        if let Ok(free) = fs2::available_space(parent) {
            // For CRF there is no truthful size estimate. Only require a small
            // working reserve; FFmpeg's disk-full error still cleans the part.
            if free < target_bytes.saturating_add(32 * 1024 * 1024) {
                return Err("Not enough free disk space for conversion. Choose another folder or free some space.".into());
            }
        }
    }
    Ok(())
}

fn cancel(state: &Converter) {
    let _control = state.pid.lock().unwrap();
    state.stop.store(true, Ordering::Release);
}

fn started(state: &Converter, child: u32) {
    let mut pid = state.pid.lock().unwrap();
    *pid = Some(child);
    // A Stop arriving between the pre-spawn check and registration remains set;
    // the owning worker observes it rather than running a second termination.
}

// Kilobits per second of a whole file that must stay under `megabytes`, keeping 5% for the container.
fn budget_kbps(megabytes: u32, seconds: f64) -> f64 { megabytes as f64 * 8000.0 * 0.95 / seconds }

// Video and audio rates for a size limit, and the height the picture is scaled down to.
fn squeeze(total_kbps: f64, audio: bool) -> Result<(f64, f64, u32), String> {
    let audio_kbps = if !audio { 0.0 } else if total_kbps < 500.0 { 64.0 } else { 128.0 };
    let video_kbps = (total_kbps - audio_kbps).floor();
    if video_kbps < 80.0 { return Err("The video is too long for this size. Pick a bigger size or trim it in Devil Cut first".into()); }
    let height = if video_kbps < 350.0 { 360 } else if video_kbps < 800.0 { 480 } else if video_kbps < 1800.0 { 720 } else { 1080 };
    Ok((video_kbps, audio_kbps, height))
}

fn run(state: &Converter, mut cmd: Command, seconds: f64, output: Option<&Path>, progress: &dyn Fn(f64)) -> Result<(), String> {
    if state.stop.load(Ordering::Relaxed) { return Err("The conversion was stopped".into()); }
    // Its own process group, so stopping takes FFmpeg down with everything it started.
    #[cfg(unix)] { use std::os::unix::process::CommandExt; cmd.process_group(0); }
    let result = (|| -> Result<(), String> {
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        started(state, child.id());
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let position = Arc::new(AtomicU64::new(f64::NAN.to_bits()));
        let observed = position.clone();
        let output_reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let value = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="));
                if let Some(micros) = value.and_then(|value| value.trim().parse::<f64>().ok()).filter(|value| value.is_finite()) {
                    observed.store(micros.to_bits(), Ordering::Release);
                }
            }
        });
        let error_reader = thread::spawn(move || {
            let mut tail = Vec::new(); let mut stderr = stderr; let mut chunk = [0u8; 4096];
            while let Ok(count) = stderr.read(&mut chunk) {
                if count == 0 { break; }
                tail.extend_from_slice(&chunk[..count]);
                if tail.len() > 8192 { tail.drain(..tail.len() - 8192); }
            }
            String::from_utf8_lossy(&tail).into_owned()
        });
        let mut previous = f64::NAN.to_bits();
        let status = wait_child(&mut child, Some(state), None, None, || {
            let bits = position.load(Ordering::Acquire);
            let micros = f64::from_bits(bits);
            if bits != previous && micros.is_finite() && seconds > 0.0 {
                previous = bits;
                progress((micros / 1_000_000.0 / seconds).clamp(0.0, 1.0));
            }
        });
        let _ = output_reader.join();
        let detail = error_reader.join().unwrap_or_default();
        match status {
            Err(ProcessFailure::Stopped) => Err("The conversion was stopped".into()),
            Err(_) => Err("Could not wait for FFmpeg".into()),
            Ok(status) if status.success() => { progress(1.0); Ok(()) },
            Ok(_) => Err(detail.trim().chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect()),
        }
    })();
    *state.pid.lock().unwrap() = Some(0);
    let stopped = state.stop.load(Ordering::Relaxed);
    if result.is_err() || stopped {
        if let Some(output) = output { let _ = fs::remove_file(output); }
    }
    if stopped { return Err("The conversion was stopped".into()); }
    result.map_err(|detail| format!("FFmpeg could not convert the file: {detail}"))
}

fn selected_tracks<'a>(file: &'a MediaFile, choice: &Option<Vec<u32>>, kind: &str) -> Result<Vec<&'a MediaTrack>, String> {
    let Some(indices) = choice else {
        return Ok(if kind == "audio" { file.tracks.iter().find(|track| track.kind == kind).into_iter().collect() } else { Vec::new() });
    };
    if indices.len() > 16 { return Err("Choose up to 16 tracks of each type.".into()); }
    let mut tracks = Vec::new();
    for index in indices {
        if tracks.iter().any(|track: &&MediaTrack| track.index == *index) { return Err("A media track was selected more than once.".into()); }
        tracks.push(file.tracks.iter().find(|track| track.index == *index && track.kind == kind)
            .ok_or("A selected media track is no longer available. Read the file again.")?);
    }
    Ok(tracks)
}

fn selected_video<'a>(file: &'a MediaFile, job: &Conversion) -> Result<Option<&'a MediaTrack>, String> {
    if let Some(index) = job.video_track {
        return file.tracks.iter().find(|track| track.index == index && track.kind == "video").map(Some)
            .ok_or_else(|| "A selected media track is no longer available. Read the file again.".into());
    }
    Ok(file.tracks.iter().find(|track| track.kind == "video"))
}

fn map_tracks(cmd: &mut Command, tracks: &[&MediaTrack]) {
    for track in tracks { cmd.args(["-map", &format!("0:{}", track.index)]); }
}

fn copy_compatible(container: &str, track: &MediaTrack) -> bool {
    match (container, track.kind.as_str()) {
        ("mkv", "subtitle") => ["subrip", "ass", "ssa", "webvtt", "dvd_subtitle", "hdmv_pgs_subtitle"].contains(&track.codec.as_str()),
        ("mkv", _) => true,
        ("mp4", "video") => ["h264", "hevc", "mpeg4", "av1"].contains(&track.codec.as_str()),
        ("mov", "video") => ["h264", "hevc", "mpeg4", "prores", "mjpeg"].contains(&track.codec.as_str()),
        ("mp4" | "mov", "audio") => ["aac", "mp3", "ac3", "eac3", "alac"].contains(&track.codec.as_str()) || (container == "mov" && track.codec.starts_with("pcm_")),
        ("mp4" | "mov", "subtitle") => track.codec == "mov_text",
        _ => false,
    }
}

fn text_subtitle(track: &MediaTrack) -> bool {
    ["mov_text", "subrip", "ass", "ssa", "webvtt", "text"].contains(&track.codec.as_str())
}

fn original_audio_extension(codec: &str) -> Result<&'static str, String> {
    match codec { "aac" => Ok("m4a"), "opus" => Ok("opus"), "flac" => Ok("flac"),
        _ => Err("Original audio extraction supports AAC, Opus and FLAC. Choose MP3 to convert this track.".into()) }
}

fn convert(state: &Converter, job: &Conversion, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let source = PathBuf::from(&job.path);
    let file = probe_with_state(&source, Some(state))?;
    let base = super::export_base(&source, &job.folder)?;
    let seconds = file.duration;
    let (crf, audio_kbps) = quality(&job.quality)?;
    let scale = scale_filter(&job.resolution, None)?;
    let video = selected_video(&file, job)?;
    let audio = selected_tracks(&file, &job.audio_tracks, "audio")?;
    let subtitles = selected_tracks(&file, &job.subtitle_tracks, "subtitle")?;
    if job.preset != "size" { check_space(&base, 0)?; }
    match job.preset.as_str() {
        "remux" => {
            let container = if job.container.is_empty() { "mkv" } else { job.container.as_str() };
            if !["mp4", "mkv", "mov"].contains(&container) { return Err("Choose MP4, MKV or MOV as the container.".into()); }
            let tracks: Vec<_> = video.into_iter().chain(audio.iter().copied()).chain(subtitles.iter().copied()).collect();
            if video.is_none() && audio.is_empty() { return Err("Select at least one video or audio track.".into()); }
            if tracks.iter().any(|track| !copy_compatible(container, track)) {
                return Err("A selected track cannot be copied into this container. Choose MKV, omit that track or convert to MP4.".into());
            }
            check_space(&base, file.bytes)?;
            let output = output_path(&base, "Remux", container)?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source); map_tracks(&mut cmd, &tracks);
            cmd.args(["-c", "copy", "-map_metadata", "0", "-map_chapters", "0"]);
            if container != "mkv" { cmd.args(["-movflags", "+faststart"]); }
            let part = write_to(&mut cmd, &output);
            run(state, cmd, seconds, Some(&part), progress)?;
            publish(&part, &output)
        }
        "audio" => {
            if audio.len() != 1 { return Err("Choose one audio track for extraction.".into()); }
            let extension = original_audio_extension(&audio[0].codec)?;
            check_space(&base, file.bytes)?;
            let output = output_path(&base, "Original audio", extension)?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source); map_tracks(&mut cmd, &audio);
            cmd.args(["-vn", "-sn", "-dn", "-c:a", "copy", "-map_metadata", "0"]);
            let part = write_to(&mut cmd, &output);
            run(state, cmd, seconds, Some(&part), progress)?;
            publish(&part, &output)
        }
        "mp3" => {
            if audio.is_empty() { return Err("This file has no sound".into()); }
            if audio.len() != 1 { return Err("Choose one audio track for extraction.".into()); }
            let output = output_path(&base, "MP3", "mp3")?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source); map_tracks(&mut cmd, &audio);
            cmd.args(["-vn", "-c:a", "libmp3lame", "-b:a", &format!("{audio_kbps}k"), "-map_metadata", "0"]);
            let part = write_to(&mut cmd, &output);
            run(state, cmd, seconds, Some(&part), progress)?;
            publish(&part, &output)
        }
        "mp4" => {
            let video = video.ok_or("This file has no picture. Pick MP3 for sound")?;
            if subtitles.iter().any(|track| !text_subtitle(track)) { return Err("MP4 conversion supports text subtitles. Use MKV remux for picture subtitles.".into()); }
            let output = output_path(&base, "MP4", "mp4")?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source); map_tracks(&mut cmd, &[video]); map_tracks(&mut cmd, &audio); map_tracks(&mut cmd, &subtitles);
            cmd.args(["-vf", &scale,
                "-c:v", "libx264", "-preset", "medium", "-crf", &crf.to_string(), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-c:s", "mov_text", "-movflags", "+faststart"]);
            let part = write_to(&mut cmd, &output);
            run(state, cmd, seconds, Some(&part), progress)?;
            publish(&part, &output)
        }
        "gif" => {
            let video = video.ok_or("This file has no picture. Pick MP3 for sound")?;
            if seconds > MAX_GIF_SECONDS + 0.5 { return Err("A GIF can be up to 60 seconds. Trim the video in Devil Cut first".into()); }
            let output = output_path(&base, "GIF", "gif")?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source).args(["-map", &format!("0:{}", video.index), "-vf", "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                "-an", "-loop", "0"]);
            let part = write_to(&mut cmd, &output);
            run(state, cmd, seconds, Some(&part), progress)?;
            publish(&part, &output)
        }
        "size" => squeeze_to_size(state, &source, &base, &file, job, progress),
        _ => Err("Unknown conversion".into()),
    }
}

fn squeeze_to_size(state: &Converter, source: &Path, base: &Path, file: &MediaFile, job: &Conversion, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let video = selected_video(file, job)?;
    let audio = selected_tracks(file, &job.audio_tracks, "audio")?;
    if audio.len() > 1 { return Err("Choose one audio track for a size limit.".into()); }
    if job.subtitle_tracks.as_ref().is_some_and(|tracks| !tracks.is_empty()) { return Err("Size-limited exports omit subtitles. Use MP4 conversion or remux to keep them.".into()); }
    let megabytes = job.megabytes;
    if !(1..=4000).contains(&megabytes) { return Err("Pick a size from 1 to 4000 MB".into()); }
    let limit = megabytes as u64 * 1_000_000;
    if file.bytes <= limit { return Err("The file is already smaller than this size".into()); }
    check_space(base, limit)?;
    let label = format!("{megabytes} MB");
    let total = budget_kbps(megabytes, file.duration);
    if video.is_none() {
        if audio.is_empty() { return Err("This file has no sound".into()); }
        let kbps = total.floor().min(320.0);
        if kbps < 32.0 { return Err("The audio is too long for this size. Pick a bigger size".into()); }
        let output = output_path(base, &label, "mp3")?;
        let mut cmd = ffmpeg_command()?;
        cmd.arg("-i").arg(source); map_tracks(&mut cmd, &audio);
        cmd.args(["-vn", "-c:a", "libmp3lame", "-b:a", &format!("{kbps}k"), "-map_metadata", "0"]);
        let part = write_to(&mut cmd, &output);
        run(state, cmd, file.duration, Some(&part), progress)?;
        if fs::metadata(&part).map(|meta| meta.len()).unwrap_or(u64::MAX) > limit {
            let _ = fs::remove_file(&part);
            return Err("Could not fit the audio into this size. Pick a bigger size".into());
        }
        return publish(&part, &output);
    }
    let video = video.unwrap();
    let (mut video_kbps, audio_kbps, height) = squeeze(total, !audio.is_empty())?;
    let scale = scale_filter(&job.resolution, Some(height))?;
    // Two passes: the first measures the video, the second spends the budget where it is needed.
    let logs = tempfile::tempdir().map_err(|e| e.to_string())?;
    let log = logs.path().join("pass");
    let mut first = ffmpeg_command()?;
    first.arg("-i").arg(source).args(["-map", &format!("0:{}", video.index), "-vf", &scale, "-c:v", "libx264", "-preset", "medium",
        "-b:v", &format!("{video_kbps}k"), "-pass", "1", "-passlogfile"]).arg(&log).args(["-an", "-f", "null", "-"]);
    run(state, first, file.duration, None, &|share| progress(share * 0.5))?;
    let output = output_path(base, &label, "mp4")?;
    for attempt in 0..2 {
        let mut second = ffmpeg_command()?;
        second.arg("-i").arg(source); map_tracks(&mut second, &[video]); map_tracks(&mut second, &audio);
        second.args(["-vf", &scale, "-c:v", "libx264", "-preset", "medium",
            "-b:v", &format!("{video_kbps}k"), "-pass", "2", "-passlogfile"]).arg(&log)
            .args(["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", &format!("{audio_kbps}k"), "-movflags", "+faststart"]);
        let part = write_to(&mut second, &output);
        run(state, second, file.duration, Some(&part), &|share| progress(0.5 + share * 0.5))?;
        let bytes = fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
        if bytes <= limit { return publish(&part, &output); }
        let _ = fs::remove_file(&part);
        // Rarely the encoder overshoots; one more try with a rate lowered by the miss.
        video_kbps = (video_kbps * limit as f64 / bytes as f64 * 0.93).floor();
        if attempt == 1 || video_kbps < 60.0 { break; }
    }
    Err("Could not fit the video into this size. Pick a bigger size".into())
}

// The converter lives in its own window, so files can be dropped on it without
// taking link drops away from the main window.
#[tauri::command]
pub async fn open_converter(app: tauri::AppHandle, files: Vec<String>, state: tauri::State<'_, Converter>) -> Result<(), String> {
    let files: Vec<String> = files.into_iter().take(MAX_FILES).collect();
    if let Some(window) = app.get_webview_window("converter") {
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
        if !files.is_empty() { app.emit_to("converter", "converter-add", files).map_err(|e| e.to_string())?; }
        return Ok(());
    }
    *state.pending.lock().unwrap() = files;
    let window = tauri::WebviewWindowBuilder::new(&app, "converter", tauri::WebviewUrl::App("converter.html".into()))
        .title("Devil Convert · Deviload")
        .inner_size(920.0, 700.0)
        .min_inner_size(720.0, 540.0)
        .theme(Some(tauri::Theme::Dark))
        .build().map_err(|e| format!("Could not open the converter: {e}"))?;
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) { let _ = window.set_icon(icon); }
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) { cancel(&handle.state::<Converter>()); }
    });
    Ok(())
}

#[tauri::command]
pub fn convert_pending(state: tauri::State<'_, Converter>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

// Files that cannot be converted come back with `error` set, so the window can say why.
#[tauri::command]
pub async fn convert_probe(paths: Vec<String>, app: tauri::AppHandle) -> Result<Vec<MediaFile>, String> {
    if paths.len() > MAX_FILES { return Err("Add up to 100 files at a time".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        paths.iter().map(|path| {
            let path = Path::new(path);
            let inspected = (|| {
                let mut file = probe(path)?;
                let canonical = path.canonicalize().map_err(|_| "The file was not found".to_string())?;
                app.asset_protocol_scope().allow_file(&canonical).map_err(|e| format!("Could not allow media preview: {e}"))?;
                file.path = canonical.to_string_lossy().into_owned();
                Ok::<_,String>(file)
            })();
            inspected.unwrap_or_else(|error| MediaFile { path: path.to_string_lossy().into(), name: file_name(path), error, ..MediaFile::default() })
        }).collect()
    }).await.map_err(|e| e.to_string())
}

// One file at a time; progress goes out as the "convert-progress" event from 0 to 1.
#[tauri::command]
pub async fn convert_file(job: Conversion, app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Converter>();
        let _operation = begin(&state)?;
        let result = convert(&state, &job, &|share| { let _ = app.emit_to("converter", "convert-progress", share); });
        let path = result?;
        let canonical = path.canonicalize().map_err(|_| "The file was not found".to_string())?;
        app.asset_protocol_scope().allow_file(&canonical).map_err(|e| format!("Could not allow media preview: {e}"))?;
        Ok(canonical.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn convert_stop(state: tauri::State<'_, Converter>) {
    cancel(&state);
}

#[cfg(test)]
mod tests {
    use super::*;

    // A controlled local child simulates an unresponsive/verbose probe without
    // malformed real media, network access, environment mutation or real sleeps
    // in the parent. The normal test suite invokes this with no fixture env.
    #[test]
    #[ignore = "helper child for the bounded probe tests"]
    fn probe_child_fixture() {
        use std::io::Write;
        let Ok(mode) = std::env::var("DEVILOAD_CONVERTER_PROBE_FIXTURE") else { return; };
        if let Ok(marker) = std::env::var("DEVILOAD_CONVERTER_PROBE_MARKER") { fs::write(marker, b"started").unwrap(); }
        if mode == "overflow" {
            let _ = std::io::stdout().write_all(&vec![b'x'; MAX_PROBE_BYTES + 4096]);
            let _ = std::io::stdout().flush();
        }
        if mode == "slow" || mode == "overflow" { thread::sleep(Duration::from_secs(10)); }
        println!("probe-fixture-complete");
    }

    fn probe_fixture(mode: &str, marker: Option<&Path>) -> Command {
        let mut cmd = command(&std::env::current_exe().unwrap());
        cmd.args(["--ignored", "--exact", "convert::tests::probe_child_fixture", "--nocapture"])
            .env("DEVILOAD_CONVERTER_PROBE_FIXTURE", mode);
        if let Some(marker) = marker { cmd.env("DEVILOAD_CONVERTER_PROBE_MARKER", marker); }
        cmd
    }

    #[test]
    fn probe_timeout_and_output_limit_reap_the_child() {
        let before = Instant::now();
        let error = probe_process(None, probe_fixture("slow", None), Duration::from_millis(120)).unwrap_err();
        assert!(error.contains("timed out"), "{error}");
        assert!(before.elapsed() < Duration::from_secs(4));
        let before = Instant::now();
        let error = probe_process(None, probe_fixture("overflow", None), Duration::from_secs(5)).unwrap_err();
        assert!(error.contains("too much information"), "{error}");
        assert!(before.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn active_probe_cancels_promptly_and_releases_the_converter_for_retry() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("probe-started");
        let state = Arc::new(Converter::default());
        let operation = begin(&state).unwrap();
        let stopping = state.clone();
        let child_marker = marker.clone();
        let stop = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !child_marker.exists() && Instant::now() < deadline { thread::sleep(Duration::from_millis(10)); }
            let requested = Instant::now();
            cancel(&stopping);
            (requested, requested.elapsed())
        });
        let before = Instant::now();
        let error = probe_process(Some(&state), probe_fixture("slow", Some(&marker)), Duration::from_secs(15)).unwrap_err();
        let completed = Instant::now();
        let (requested, callback_time) = stop.join().unwrap();
        assert!(marker.is_file(), "fixture must have registered a real running child before Stop");
        assert!(error.contains("stopped"), "{error}");
        let stop_time = completed.saturating_duration_since(requested);
        assert!(stop_time < Duration::from_secs(4), "startup={:?}, Stop callback={callback_time:?}, Stop to reap={stop_time:?}", requested.duration_since(before));
        assert!(callback_time < Duration::from_secs(1), "Stop callback must not terminate or wait for the child: {callback_time:?}");
        assert_eq!(*state.pid.lock().unwrap(), Some(0));
        assert!(state.stop.load(Ordering::Acquire));
        drop(operation);
        assert!(state.pid.lock().unwrap().is_none());
        let operation = begin(&state).unwrap();
        let result = probe_process(Some(&state), probe_fixture("complete", None), Duration::from_secs(5)).unwrap();
        assert!(String::from_utf8_lossy(&result).contains("probe-fixture-complete"));
        assert_eq!(*state.pid.lock().unwrap(), Some(0));
        assert!(!state.stop.load(Ordering::Acquire));
        drop(operation);
        assert!(state.pid.lock().unwrap().is_none());
    }

    #[test]
    fn silent_ffmpeg_worker_observes_stop_without_waiting_for_progress() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("render-started");
        let state = Arc::new(Converter::default());
        let operation = begin(&state).unwrap();
        let stopping = state.clone();
        let child_marker = marker.clone();
        let stop = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !child_marker.exists() && Instant::now() < deadline { thread::sleep(Duration::from_millis(10)); }
            let requested = Instant::now();
            cancel(&stopping);
            (requested, requested.elapsed())
        });
        let before = Instant::now();
        let error = run(&state, probe_fixture("slow", Some(&marker)), 30.0, None, &|_| {}).unwrap_err();
        let completed = Instant::now();
        let (requested, callback_time) = stop.join().unwrap();
        assert!(marker.is_file());
        assert!(error.contains("stopped"), "{error}");
        let stop_time = completed.saturating_duration_since(requested);
        assert!(stop_time < Duration::from_secs(4), "startup={:?}, Stop callback={callback_time:?}, Stop to reap={stop_time:?}", requested.duration_since(before));
        assert!(callback_time < Duration::from_secs(1), "Stop callback blocked: {callback_time:?}");
        assert_eq!(*state.pid.lock().unwrap(), Some(0));
        drop(operation);
        assert!(state.pid.lock().unwrap().is_none());
    }

    #[test]
    fn size_budget_scales_the_picture_down() {
        // Three minutes into 10 MB: about 420 kbit/s, so 480p with 64 kbit/s sound.
        let (video, audio, height) = squeeze(budget_kbps(10, 180.0), true).unwrap();
        assert_eq!((audio, height), (64.0, 480));
        assert!(video > 300.0 && video < 400.0, "{video}");
        // A short clip keeps its quality.
        assert_eq!(squeeze(budget_kbps(25, 30.0), true).unwrap().2, 1080);
        // An hour cannot fit into 10 MB.
        assert!(squeeze(budget_kbps(10, 3600.0), true).is_err());
    }

    #[test]
    fn outputs_never_replace_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("clip.mkv");
        fs::write(&source, b"x").unwrap();
        let first = output_path(&source, "MP3", "mp3").unwrap();
        assert_eq!(first.file_name().unwrap(), "clip - MP3.mp3");
        fs::write(&first, b"x").unwrap();
        assert_eq!(output_path(&source, "MP3", "mp3").unwrap().file_name().unwrap(), "clip - MP3 2.mp3");
        assert!(probe(&dir.path().join("notes.txt")).is_err());
    }

    #[test]
    fn conversion_settings_keep_legacy_callers_and_reject_invalid_values() {
        let old: Conversion = serde_json::from_str(r#"{"path":"sample.mp4","preset":"mp4"}"#).unwrap();
        assert_eq!(quality(&old.quality).unwrap(), (20, 320));
        assert_eq!(resolution(&old.resolution).unwrap(), None);
        assert_eq!(quality("balanced").unwrap(), (20, 192));
        assert_eq!(quality("high").unwrap(), (18, 320));
        assert_eq!(quality("smaller").unwrap(), (26, 128));
        assert!(quality("arbitrary").is_err());
        assert!(resolution("720;movie=other").is_err());
        assert!(scale_filter("720", Some(480)).unwrap().contains("854,480"));
        assert!(scale_filter("480", Some(1080)).unwrap().contains("854,480"));
        let state = Converter::default();
        let active = begin(&state).unwrap();
        assert!(begin(&state).is_err());
        cancel(&state);
        drop(active);
        let _next = begin(&state).unwrap();
        assert!(!state.stop.load(Ordering::Acquire));
    }

    #[test]
    fn publishing_never_clobbers_a_file_created_during_conversion() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("clip - MP4.mp4");
        let part = dir.path().join("part.mp4");
        fs::write(&part, b"new conversion").unwrap();
        fs::write(&output, b"existing file").unwrap();
        assert!(publish(&part, &output).is_err());
        assert_eq!(fs::read(&output).unwrap(), b"existing file");
        assert!(!part.exists());
        let fresh = dir.path().join("fresh.mp4");
        fs::write(&part, b"new conversion").unwrap();
        assert_eq!(publish(&part, &fresh).unwrap(), fresh);
        assert_eq!(fs::read(&fresh).unwrap(), b"new conversion");
        assert!(!part.exists());
    }

    fn generated_video(path: &Path, dimensions: &str, seconds: u32) {
        let generated = command(&binary("ffmpeg").unwrap()).args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", &format!("testsrc2=s={dimensions}:r=25:d={seconds}"),
            "-f", "lavfi", "-i", &format!("sine=frequency=440:duration={seconds}"), "-shortest", "-c:v", "libx264",
            "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac",
        ]).arg(path).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe; uses only generated local media"]
    fn converter_resolution_quality_rotation_and_no_upscale() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("landscape.mp4");
        generated_video(&source, "1920x1080", 2);
        let original = fs::read(&source).unwrap();
        let state = Converter::default();
        let job = |source: &Path, resolution: &str, quality: &str| Conversion {
            path: source.to_string_lossy().into(), preset: "mp4".into(), resolution: resolution.into(), quality: quality.into(), ..Conversion::default()
        };
        for (resolution, quality, expected) in [("720", "high", (1280, 720)), ("480", "smaller", (852, 480)), ("original", "balanced", (1920, 1080))] {
            let output = convert(&state, &job(&source, resolution, quality), &|_| {}).unwrap();
            let file = probe(&output).unwrap();
            assert_eq!((file.width, file.height), expected);
            assert_eq!(file.video_codec, "h264"); assert_eq!(file.audio_codec, "aac");
            assert!((file.duration - 2.0).abs() < 0.2);
        }
        let portrait = dir.path().join("portrait.mp4");
        let rotated = command(&binary("ffmpeg").unwrap()).args(["-hide_banner", "-loglevel", "error", "-display_rotation:v:0", "90", "-i"]).arg(&source)
            .args(["-c", "copy"]).arg(&portrait).output().unwrap();
        assert!(rotated.status.success(), "{}", String::from_utf8_lossy(&rotated.stderr));
        assert_eq!((probe(&portrait).unwrap().width, probe(&portrait).unwrap().height), (1080, 1920));
        let upright = convert(&state, &job(&portrait, "720", "balanced"), &|_| {}).unwrap();
        assert_eq!((probe(&upright).unwrap().width, probe(&upright).unwrap().height), (720, 1280));
        let small = dir.path().join("small.mp4"); generated_video(&small, "640x360", 1);
        let unchanged = convert(&state, &job(&small, "1080", "balanced"), &|_| {}).unwrap();
        assert_eq!((probe(&unchanged).unwrap().width, probe(&unchanged).unwrap().height), (640, 360));
        assert_eq!(fs::read(&source).unwrap(), original);
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".deviload.part")));
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe; uses only generated local media"]
    fn converter_cancel_cleanup_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let state = Converter::default();
        let part = dir.path().join("cancelled.mp4");
        let operation = begin(&state).unwrap();
        let mut cmd = ffmpeg_command().unwrap();
        cmd.args(["-re", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=30", "-an", "-c:v", "libx264", "-preset", "ultrafast"]).arg(&part);
        let result = run(&state, cmd, 30.0, Some(&part), &|share| { if share > 0.01 { cancel(&state); } });
        assert!(result.unwrap_err().contains("stopped"));
        assert!(!part.exists());
        drop(operation);
        assert!(state.pid.lock().unwrap().is_none());
        let source = dir.path().join("restart.mp4"); generated_video(&source, "320x180", 1);
        let operation = begin(&state).unwrap();
        let output = convert(&state, &Conversion { path: source.to_string_lossy().into(), preset: "mp4".into(), ..Conversion::default() }, &|_| {}).unwrap();
        assert!(probe(&output).unwrap().video);
        drop(operation);
        assert!(state.pid.lock().unwrap().is_none());
    }

    #[test]
    #[ignore = "requires FFmpeg; checks cancellation between reservation and child registration"]
    fn converter_cancel_before_child_registration() {
        use std::process::Stdio;
        let state = Converter::default();
        let _operation = begin(&state).unwrap();
        cancel(&state);
        let mut cmd = command(&binary("ffmpeg").unwrap());
        cmd.args(["-v", "error", "-re", "-f", "lavfi", "-i", "anullsrc", "-t", "30", "-f", "null", "-"])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(unix)] { use std::os::unix::process::CommandExt; cmd.process_group(0); }
        let mut child = cmd.spawn().unwrap();
        started(&state, child.id());
        assert_eq!(*state.pid.lock().unwrap(), Some(child.id()));
        assert!(matches!(wait_child(&mut child, Some(&state), None, None, || {}), Err(ProcessFailure::Stopped)));
    }

    fn packet_hash(path: &Path, stream: u32) -> String {
        let output = command(&binary("ffmpeg").unwrap()).args(["-v", "error", "-i"]).arg(path)
            .args(["-map", &format!("0:{stream}"), "-c", "copy", "-f", "hash", "-hash", "sha256", "-"]).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8(output.stdout).unwrap()
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe; generated multiple tracks, no network"]
    fn converter_lossless_remux_original_audio_and_track_selection() {
        let dir = tempfile::tempdir().unwrap();
        let subtitles = dir.path().join("captions.srt");
        fs::write(&subtitles,"1\n00:00:00,000 --> 00:00:01,500\nDeviload fixture\n").unwrap();
        let source = dir.path().join("multiple.mkv");
        let made = command(&binary("ffmpeg").unwrap()).args(["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=12:d=2",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-i"])
            .arg(&subtitles).args(["-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", "-c:a:0", "aac", "-c:a:1", "flac", "-c:s", "srt", "-metadata:s:a:0", "language=eng",
                "-metadata:s:a:1", "language=jpn", "-metadata:s:a:1", "title=Original track"]).arg(&source).output().unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        let original = fs::read(&source).unwrap();
        let file = probe(&source).unwrap();
        assert_eq!(file.tracks.len(),4);
        assert_eq!(file.tracks[2].language,"jpn");assert_eq!(file.tracks[2].title,"Original track");
        let state = Converter::default();
        let base = || Conversion { path:source.to_string_lossy().into(),preset:"remux".into(),container:"mkv".into(),
            audio_tracks:Some(vec![2]),subtitle_tracks:Some(vec![3]),..Conversion::default() };
        let copied = convert(&state,&base(),&|_| {}).unwrap();
        let copied_info = probe(&copied).unwrap();
        assert_eq!(copied_info.tracks.iter().map(|t|t.codec.as_str()).collect::<Vec<_>>(),["h264","flac","subrip"]);
        assert_eq!(packet_hash(&source,0),packet_hash(&copied,0));
        assert_eq!(packet_hash(&source,2),packet_hash(&copied,1));
        for container in ["mp4","mov"] {
            let job = Conversion { container:container.into(),audio_tracks:Some(vec![1]),subtitle_tracks:Some(vec![]),..base() };
            let output = convert(&state,&job,&|_| {}).unwrap();
            assert_eq!(output.extension().unwrap().to_string_lossy(),container);
            assert_eq!(probe(&output).unwrap().tracks.len(),2);
            assert_eq!(packet_hash(&source,1),packet_hash(&output,1));
        }
        for (index,extension,codec) in [(1,"m4a","aac"),(2,"flac","flac")] {
            let output = convert(&state,&Conversion { preset:"audio".into(),audio_tracks:Some(vec![index]),subtitle_tracks:None,..base() },&|_| {}).unwrap();
            let info = probe(&output).unwrap();
            assert_eq!(output.extension().unwrap().to_string_lossy(),extension);
            assert!(!info.video);assert_eq!(info.audio_codec,codec);assert_eq!(info.tracks.len(),1);
            assert_eq!(packet_hash(&source,index),packet_hash(&output,0));
        }
        let opus = dir.path().join("voice.opus");
        let made = command(&binary("ffmpeg").unwrap()).args(["-v","error","-f","lavfi","-i","sine=duration=1","-c:a","libopus"]).arg(&opus).output().unwrap();
        assert!(made.status.success());
        let copied = convert(&state,&Conversion {path:opus.to_string_lossy().into(),preset:"audio".into(),..Conversion::default()},&|_| {}).unwrap();
        assert_eq!(probe(&copied).unwrap().audio_codec,"opus");assert_eq!(packet_hash(&opus,0),packet_hash(&copied,0));
        let bad_container = convert(&state,&Conversion {container:"mp4".into(),..base()},&|_| {}).unwrap_err();
        assert!(bad_container.contains("cannot be copied"));
        assert!(convert(&state,&Conversion {audio_tracks:Some(vec![999]),..base()},&|_| {}).unwrap_err().contains("no longer available"));
        assert!(convert(&state,&Conversion {audio_tracks:Some(vec![1,1]),..base()},&|_| {}).unwrap_err().contains("more than once"));
        let encoded = convert(&state,&Conversion {preset:"mp4".into(),audio_tracks:Some(vec![]),..base()},&|_| {}).unwrap();
        let info = probe(&encoded).unwrap();
        assert!(!info.audio);assert!(info.tracks.iter().any(|track|track.codec == "mov_text"));
        assert_eq!(fs::read(&source).unwrap(),original);
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| !entry.unwrap().path().to_string_lossy().contains("deviload.part")));
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe; uses only generated local media"]
    fn local_converter_makes_every_format() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("sample.mp4");
        let generated = command(&binary("ffmpeg").unwrap()).args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=12",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-shortest", "-c:v", "libx264", "-b:v", "3M", "-pix_fmt", "yuv420p", "-c:a", "aac",
        ]).arg(&source).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
        let original = fs::read(&source).unwrap();
        let state = Converter::default();
        let job = |preset: &str, megabytes: u32| Conversion { path: source.to_string_lossy().into(), preset: preset.into(), megabytes, ..Conversion::default() };
        let mp3 = convert(&state, &job("mp3", 0), &|_| {}).unwrap();
        assert!(!probe(&mp3).unwrap().video);
        // With an export folder the result lands there, named after the source.
        let exports = tempfile::tempdir().unwrap();
        let moved = convert(&state, &Conversion { folder: exports.path().to_string_lossy().into(), ..job("mp3", 0) }, &|_| {}).unwrap();
        assert_eq!(moved.parent(), Some(exports.path()));
        assert!(moved.file_name().unwrap().to_string_lossy().starts_with(&*source.file_stem().unwrap().to_string_lossy()));
        let mp4 = convert(&state, &job("mp4", 0), &|_| {}).unwrap();
        assert!(probe(&mp4).unwrap().audio);
        let gif = convert(&state, &job("gif", 0), &|_| {}).unwrap();
        assert!(probe(&gif).unwrap().video);
        // The generated video is about 4.5 MB; squeeze it under 1 MB.
        let small = convert(&state, &job("size", 1), &|_| {}).unwrap();
        let bytes = fs::metadata(&small).unwrap().len();
        assert!(bytes <= 1_000_000 && bytes > 300_000, "{bytes}");
        assert!(convert(&state, &job("size", 4000), &|_| {}).is_err());
        // The source file is never touched.
        assert_eq!(fs::read(&source).unwrap(), original);
    }
}
