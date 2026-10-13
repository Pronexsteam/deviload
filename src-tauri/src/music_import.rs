use serde::Serialize;
use std::{fs::File, io::{Cursor, Read}, path::PathBuf};
use tauri_plugin_dialog::DialogExt;

const TOO_LARGE: &str = "Music import is too large (100 MB archive, 50 MB text, 100 files maximum).";
const READ_ERROR: &str = "Could not read the selected music export.";
const INVALID_ZIP: &str = "This ZIP archive is damaged or incomplete.";
const UNSUPPORTED_ZIP: &str = "This ZIP archive is encrypted or uses unsupported compression.";
const INVALID_TEXT: &str = "Music export must contain UTF-8 text.";
const UNSUPPORTED_FILE: &str = "Choose a Spotify or YouTube Music export (.zip, .json or .csv).";
const NO_MUSIC: &str = "No supported music export files were found in this archive.";

#[derive(Serialize, Debug)]
pub struct MusicImportFile { pub name: String, pub text: String }

#[derive(Clone, Copy)]
struct Limits { input: usize, text: usize, files: usize, entries: usize }
const LIMITS: Limits = Limits { input: 100 * 1024 * 1024, text: 50 * 1024 * 1024, files: 100, entries: 1000 };

#[derive(Default)]
struct Budget { input: usize, text: usize, entries: usize }

fn basename(name: &str) -> String {
    name.replace('\\', "/").rsplit('/').next().unwrap_or("").chars().filter(|c| !c.is_control()).take(240).collect()
}

fn music_entry(name: &str) -> bool {
    let path = name.replace('\\', "/").to_lowercase();
    let base = basename(&path);
    if !base.ends_with(".json") && !base.ends_with(".csv") { return false; }
    let spotify = base.ends_with(".json") && (base == "yourlibrary.json" || base.starts_with("playlist") || base.starts_with("streaminghistory") || base.starts_with("streaming_history_audio"));
    let google = path.contains("music-library") || path.contains("music library") || path.contains("/playlists/") || base == "liked-music.csv";
    spotify || google
}

fn bounded_read(reader: impl Read, maximum: usize, failure: &'static str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(maximum as u64 + 1).read_to_end(&mut bytes).map_err(|_| failure)?;
    if bytes.len() > maximum { return Err(TOO_LARGE.into()); }
    Ok(bytes)
}

fn append_text(name: String, bytes: Vec<u8>, output: &mut Vec<MusicImportFile>, budget: &mut Budget, limits: Limits) -> Result<(), String> {
    if output.len() >= limits.files || bytes.len() > limits.text.saturating_sub(budget.text) { return Err(TOO_LARGE.into()); }
    let text = String::from_utf8(bytes).map_err(|_| INVALID_TEXT)?;
    budget.text += text.len();
    output.push(MusicImportFile { name, text });
    Ok(())
}

fn read_zip(bytes: Vec<u8>, output: &mut Vec<MusicImportFile>, budget: &mut Budget, limits: Limits) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| INVALID_ZIP)?;
    if archive.len() > limits.entries.saturating_sub(budget.entries) { return Err(TOO_LARGE.into()); }
    budget.entries += archive.len();
    let before = output.len();
    for index in 0..archive.len() {
        // Check metadata of all entries, but never read unrelated account data.
        let raw = archive.by_index_raw(index).map_err(|_| INVALID_ZIP)?;
        if raw.encrypted() || !matches!(raw.compression(), zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated) {
            return Err(UNSUPPORTED_ZIP.into());
        }
        if raw.is_dir() || !music_entry(raw.name()) { continue; }
        if raw.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err(UNSUPPORTED_ZIP.into()); }
        if output.len() >= limits.files || raw.size() > limits.text.saturating_sub(budget.text) as u64 { return Err(TOO_LARGE.into()); }
        let name = basename(raw.name());
        let expected = raw.size();
        drop(raw);
        let entry = archive.by_index(index).map_err(|_| INVALID_ZIP)?;
        // Bound actual decompression rather than trusting the ZIP size fields.
        let text = bounded_read(entry, limits.text.saturating_sub(budget.text), INVALID_ZIP)?;
        if text.len() as u64 != expected { return Err(INVALID_ZIP.into()); }
        append_text(name, text, output, budget, limits)?;
    }
    if before == output.len() { return Err(NO_MUSIC.into()); }
    Ok(())
}

fn read_paths(paths: Vec<PathBuf>, limits: Limits) -> Result<Vec<MusicImportFile>, String> {
    if paths.len() > limits.files { return Err(TOO_LARGE.into()); }
    let mut output = Vec::new();
    let mut budget = Budget::default();
    for path in paths {
        let extension = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if !["zip", "json", "csv"].contains(&extension.as_str()) { return Err(UNSUPPORTED_FILE.into()); }
        let file = File::open(&path).map_err(|_| READ_ERROR)?;
        let metadata = file.metadata().map_err(|_| READ_ERROR)?;
        if !metadata.is_file() { return Err(READ_ERROR.into()); }
        let remaining = limits.input.saturating_sub(budget.input);
        if metadata.len() > remaining as u64 { return Err(TOO_LARGE.into()); }
        let bytes = bounded_read(file, remaining, READ_ERROR)?;
        budget.input += bytes.len();
        if extension == "zip" { read_zip(bytes, &mut output, &mut budget, limits)?; }
        else {
            let name = path.file_name().and_then(|x| x.to_str()).map(basename).ok_or(READ_ERROR)?;
            append_text(name, bytes, &mut output, &mut budget, limits)?;
        }
    }
    Ok(output)
}

#[tauri::command]
pub async fn read_music_import(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Vec<MusicImportFile>, String> {
    if window.label() != "main" { return Err("Music import is only available in the main window.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(files) = app.dialog().file().add_filter("Spotify / YouTube Music", &["zip", "json", "csv"]).blocking_pick_files() else { return Ok(Vec::new()); };
        let paths = files.into_iter().map(|file| file.into_path().map_err(|_| READ_ERROR.to_owned())).collect::<Result<Vec<_>, _>>()?;
        read_paths(paths, LIMITS)
    }).await.map_err(|_| READ_ERROR.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn archive(entries: &[(&str, &[u8])], compression: zip::CompressionMethod) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer.start_file(*name, SimpleFileOptions::default().compression_method(compression)).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn unzip(bytes: Vec<u8>, limits: Limits) -> Result<Vec<MusicImportFile>, String> {
        let mut output = Vec::new();
        read_zip(bytes, &mut output, &mut Budget::default(), limits)?;
        Ok(output)
    }
    #[test]
    fn imports_only_music_text_and_never_exposes_archive_paths() {
        let bytes = archive(&[("../../YourLibrary.json", br#"{"tracks":[]}"#), ("Takeout/YouTube and YouTube Music/playlists/Likes.csv", b"Video ID\nabcdefghijk"), ("Userdata.json", b"private unrelated information")], zip::CompressionMethod::Deflated);
        let files = unzip(bytes, LIMITS).unwrap();
        assert_eq!(files.len(), 2); assert_eq!(files[0].name, "YourLibrary.json"); assert_eq!(files[1].name, "Likes.csv");
        assert!(!serde_json::to_string(&files).unwrap().contains("private unrelated"));
        assert!(!files.iter().any(|file| file.name.contains('/') || file.name.contains('\\')));
    }
    #[test]
    fn accepts_multiple_direct_exports_and_cancel_is_empty() {
        let root = tempfile::tempdir().unwrap(); let json = root.path().join("export.json"); let csv = root.path().join("export.csv");
        std::fs::write(&json, b"{}").unwrap(); std::fs::write(&csv, b"artist,title\nA,B").unwrap();
        let files = read_paths(vec![json, csv], LIMITS).unwrap(); assert_eq!(files.len(), 2); assert_eq!(files[0].name, "export.json");
        assert!(read_paths(vec![], LIMITS).unwrap().is_empty());
    }
    #[test]
    fn rejects_corrupt_crc_truncated_and_non_utf8_content() {
        let bytes = archive(&[("YourLibrary.json", b"unique audio export text")], zip::CompressionMethod::Stored);
        let mut corrupt = bytes.clone(); let at = corrupt.windows(6).position(|part| part == b"unique").unwrap(); corrupt[at] ^= 1;
        assert_eq!(unzip(corrupt, LIMITS).unwrap_err(), INVALID_ZIP);
        assert_eq!(unzip(bytes[..bytes.len()-10].to_vec(), LIMITS).unwrap_err(), INVALID_ZIP);
        assert_eq!(unzip(archive(&[("YourLibrary.json", &[255])], zip::CompressionMethod::Stored), LIMITS).unwrap_err(), INVALID_TEXT);
    }
    #[test]
    fn enforces_actual_decompression_and_aggregate_limits() {
        let bytes = archive(&[("YourLibrary.json", &vec![b'a'; 1024])], zip::CompressionMethod::Deflated);
        assert_eq!(unzip(bytes.clone(), Limits { text: 100, ..LIMITS }).unwrap_err(), TOO_LARGE);
        let mut forged = bytes;
        for index in 0..forged.len().saturating_sub(28) {
            if forged[index..].starts_with(b"PK\x03\x04") { forged[index+22..index+26].copy_from_slice(&16u32.to_le_bytes()); }
            if forged[index..].starts_with(b"PK\x01\x02") { forged[index+24..index+28].copy_from_slice(&16u32.to_le_bytes()); }
        }
        let error = unzip(forged, Limits { text: 100, ..LIMITS }).unwrap_err();
        assert!(error == TOO_LARGE || error == INVALID_ZIP);
        assert_eq!(bounded_read(&b"more than ten bytes"[..], 10, READ_ERROR).unwrap_err(), TOO_LARGE);
        let two = archive(&[("Playlist1.json", b"123456"), ("Playlist2.json", b"123456")], zip::CompressionMethod::Stored);
        assert_eq!(unzip(two.clone(), Limits { text: 10, ..LIMITS }).unwrap_err(), TOO_LARGE);
        assert_eq!(unzip(two.clone(), Limits { files: 1, ..LIMITS }).unwrap_err(), TOO_LARGE);
        assert_eq!(unzip(two, Limits { entries: 1, ..LIMITS }).unwrap_err(), TOO_LARGE);
        let root=tempfile::tempdir().unwrap(); let path=root.path().join("export.json"); std::fs::write(&path,b"123456").unwrap();
        assert_eq!(read_paths(vec![path.clone(),path], Limits { input: 10, ..LIMITS }).unwrap_err(), TOO_LARGE);
    }
    #[test]
    fn rejects_encrypted_unsupported_and_non_music_archives_without_leaking_contents() {
        let original = archive(&[("YourLibrary.json", b"secret account detail")], zip::CompressionMethod::Stored);
        for encrypted in [true,false] {
            let mut bytes=original.clone();
            for index in 0..bytes.len().saturating_sub(12) {
                if bytes[index..].starts_with(b"PK\x03\x04") { if encrypted { bytes[index+6] |= 1; } else { bytes[index+8]=99; } }
                if bytes[index..].starts_with(b"PK\x01\x02") { if encrypted { bytes[index+8] |= 1; } else { bytes[index+10]=99; } }
            }
            let error=unzip(bytes,LIMITS).unwrap_err(); assert!(error==UNSUPPORTED_ZIP || error==INVALID_ZIP); assert!(!error.contains("secret"));
        }
        assert_eq!(unzip(archive(&[("Userdata.json",b"private account detail")],zip::CompressionMethod::Stored),LIMITS).unwrap_err(),NO_MUSIC);
    }
}
