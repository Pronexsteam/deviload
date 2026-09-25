// The converter: a video or audio file from the disk becomes MP4, MP3 or a GIF,
// or a video squeezed under a size limit for messengers and mail. The source file
// is never changed; results are written next to it under a new name.
use super::{binary, command, ffmpeg_command, kill_tree, run_ffmpeg_tracked};
use serde::{Deserialize, Serialize};
use std::{
    fs, path::{Path, PathBuf}, process::Command,
    sync::{Mutex, atomic::{AtomicBool, Ordering}},
};
use tauri::{Emitter, Manager};

const MEDIA: [&str; 24] = ["mp4", "mkv", "webm", "mov", "m4v", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "3gp", "gif",
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff", "aif", "mka"];
const MAX_FILES: usize = 100;
const MAX_GIF_SECONDS: f64 = 60.0;

#[derive(Default)]
pub struct Converter {
    // The running FFmpeg; zero while a conversion is being prepared.
    pid: Mutex<Option<u32>>,
    stop: AtomicBool,
    // Files handed over by the main window before the converter window finished loading.
    pending: Mutex<Vec<String>>,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile { path: String, name: String, bytes: u64, duration: f64, video: bool, audio: bool, error: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversion { path: String, preset: String, #[serde(default)] megabytes: u32 }

fn probe(path: &Path) -> Result<MediaFile, String> {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !MEDIA.contains(&extension.as_str()) { return Err("This file type is not supported".into()); }
    let meta = fs::metadata(path).map_err(|_| "The file was not found".to_string())?;
    if !meta.is_file() { return Err("The file was not found".into()); }
    let output = command(&binary("ffprobe")?)
        .args(["-v", "error", "-show_entries", "stream=codec_type:stream_disposition=attached_pic:format=duration", "-of", "json"])
        .arg(path).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("FFprobe could not read the file".into()); }
    let info: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let streams = info["streams"].as_array().cloned().unwrap_or_default();
    // Cover art inside an audio file is a still picture, not a video.
    let video = streams.iter().any(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64() != Some(1));
    let audio = streams.iter().any(|s| s["codec_type"] == "audio");
    let duration = info["format"]["duration"].as_str().and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
    let Some(duration) = duration.filter(|_| video || audio) else { return Err("This is not a video or an audio file".into()) };
    Ok(MediaFile { path: path.to_string_lossy().into(), name: file_name(path), bytes: meta.len(), duration, video, audio, error: String::new() })
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

fn run(state: &Converter, cmd: Command, seconds: f64, output: Option<&Path>, progress: &dyn Fn(f64)) -> Result<(), String> {
    if state.stop.load(Ordering::Relaxed) { return Err("The conversion was stopped".into()); }
    // Its own process group, so stopping takes FFmpeg down with everything it started.
    #[cfg(unix)]
    let cmd = {
        use std::os::unix::process::CommandExt;
        let mut cmd = cmd;
        cmd.process_group(0);
        cmd
    };
    let result = run_ffmpeg_tracked(cmd, seconds, progress, &|pid| { *state.pid.lock().unwrap() = Some(pid); });
    let stopped = state.stop.load(Ordering::Relaxed);
    if result.is_err() || stopped {
        if let Some(output) = output { let _ = fs::remove_file(output); }
    }
    if stopped { return Err("The conversion was stopped".into()); }
    result.map_err(|detail| format!("FFmpeg could not convert the file: {detail}"))
}

fn convert(state: &Converter, job: &Conversion, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let source = PathBuf::from(&job.path);
    let file = probe(&source)?;
    let seconds = file.duration;
    match job.preset.as_str() {
        "mp3" => {
            if !file.audio { return Err("This file has no sound".into()); }
            let output = output_path(&source, "MP3", "mp3")?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source).args(["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "320k", "-map_metadata", "0"]).arg(&output);
            run(state, cmd, seconds, Some(&output), progress)?;
            Ok(output)
        }
        "mp4" => {
            if !file.video { return Err("This file has no picture. Pick MP3 for sound".into()); }
            let output = output_path(&source, "MP4", "mp4")?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source).args(["-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart"]).arg(&output);
            run(state, cmd, seconds, Some(&output), progress)?;
            Ok(output)
        }
        "gif" => {
            if !file.video { return Err("This file has no picture. Pick MP3 for sound".into()); }
            if seconds > MAX_GIF_SECONDS + 0.5 { return Err("A GIF can be up to 60 seconds. Trim the video in Devil Cut first".into()); }
            let output = output_path(&source, "GIF", "gif")?;
            let mut cmd = ffmpeg_command()?;
            cmd.arg("-i").arg(&source).args(["-vf", "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                "-an", "-loop", "0"]).arg(&output);
            run(state, cmd, seconds, Some(&output), progress)?;
            Ok(output)
        }
        "size" => squeeze_to_size(state, &source, &file, job.megabytes, progress),
        _ => Err("Unknown conversion".into()),
    }
}

fn squeeze_to_size(state: &Converter, source: &Path, file: &MediaFile, megabytes: u32, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    if !(1..=4000).contains(&megabytes) { return Err("Pick a size from 1 to 4000 MB".into()); }
    let limit = megabytes as u64 * 1_000_000;
    if file.bytes <= limit { return Err("The file is already smaller than this size".into()); }
    let label = format!("{megabytes} MB");
    let total = budget_kbps(megabytes, file.duration);
    if !file.video {
        let kbps = total.floor().min(320.0);
        if kbps < 32.0 { return Err("The audio is too long for this size. Pick a bigger size".into()); }
        let output = output_path(source, &label, "mp3")?;
        let mut cmd = ffmpeg_command()?;
        cmd.arg("-i").arg(source).args(["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", &format!("{kbps}k"), "-map_metadata", "0"]).arg(&output);
        run(state, cmd, file.duration, Some(&output), progress)?;
        return Ok(output);
    }
    let (mut video_kbps, audio_kbps, height) = squeeze(total, file.audio)?;
    let scale = format!("scale=-2:'min({height},ih)'");
    // Two passes: the first measures the video, the second spends the budget where it is needed.
    let logs = tempfile::tempdir().map_err(|e| e.to_string())?;
    let log = logs.path().join("pass");
    let mut first = ffmpeg_command()?;
    first.arg("-i").arg(source).args(["-map", "0:v:0", "-vf", &scale, "-c:v", "libx264", "-preset", "medium",
        "-b:v", &format!("{video_kbps}k"), "-pass", "1", "-passlogfile"]).arg(&log).args(["-an", "-f", "null", "-"]);
    run(state, first, file.duration, None, &|share| progress(share * 0.5))?;
    let output = output_path(source, &label, "mp4")?;
    for attempt in 0..2 {
        let mut second = ffmpeg_command()?;
        second.arg("-i").arg(source).args(["-map", "0:v:0", "-map", "0:a:0?", "-vf", &scale, "-c:v", "libx264", "-preset", "medium",
            "-b:v", &format!("{video_kbps}k"), "-pass", "2", "-passlogfile"]).arg(&log)
            .args(["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", &format!("{audio_kbps}k"), "-movflags", "+faststart"]).arg(&output);
        run(state, second, file.duration, Some(&output), &|share| progress(0.5 + share * 0.5))?;
        let bytes = fs::metadata(&output).map(|meta| meta.len()).unwrap_or(0);
        if bytes <= limit { return Ok(output); }
        let _ = fs::remove_file(&output);
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
        .title("Converter · Deviload")
        .inner_size(920.0, 700.0)
        .min_inner_size(720.0, 540.0)
        .theme(Some(tauri::Theme::Dark))
        .build().map_err(|e| format!("Could not open the converter: {e}"))?;
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) { let _ = window.set_icon(icon); }
    Ok(())
}

#[tauri::command]
pub fn convert_pending(state: tauri::State<'_, Converter>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

// Files that cannot be converted come back with `error` set, so the window can say why.
#[tauri::command]
pub async fn convert_probe(paths: Vec<String>) -> Result<Vec<MediaFile>, String> {
    if paths.len() > MAX_FILES { return Err("Add up to 100 files at a time".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        paths.iter().map(|path| {
            let path = Path::new(path);
            probe(path).unwrap_or_else(|error| MediaFile { path: path.to_string_lossy().into(), name: file_name(path), error, ..MediaFile::default() })
        }).collect()
    }).await.map_err(|e| e.to_string())
}

// One file at a time; progress goes out as the "convert-progress" event from 0 to 1.
#[tauri::command]
pub async fn convert_file(job: Conversion, app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Converter>();
        {
            let mut pid = state.pid.lock().unwrap();
            if pid.is_some() { return Err("Another file is being converted".into()); }
            *pid = Some(0);
        }
        state.stop.store(false, Ordering::Relaxed);
        let result = convert(&state, &job, &|share| { let _ = app.emit_to("converter", "convert-progress", share); });
        *state.pid.lock().unwrap() = None;
        result.map(|path| path.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn convert_stop(state: tauri::State<'_, Converter>) {
    state.stop.store(true, Ordering::Relaxed);
    if let Some(pid) = *state.pid.lock().unwrap() {
        if pid > 0 { kill_tree(pid); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let job = |preset: &str, megabytes: u32| Conversion { path: source.to_string_lossy().into(), preset: preset.into(), megabytes };
        let mp3 = convert(&state, &job("mp3", 0), &|_| {}).unwrap();
        assert!(!probe(&mp3).unwrap().video);
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
