// Finished downloads on the disk: which ones are gone, moving them to another folder while the library keeps
// them, and fetching a missing one again.
use crate::model::Job;
use crate::{allocate_id, plain_folder, save, Engine};
use serde::Serialize;
use std::path::{Path, PathBuf};

// Files yt-dlp keeps beside a download, which travel with it: subtitles (also "name.en.srt"), lyrics, covers
// and its notes.
const COMPANIONS: &[&str] = &["srt", "vtt", "ass", "ssa", "lrc", "jpg", "jpeg", "png", "webp", "info.json", "description", "nfo"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Missing {
    id: u64,
    // Whether the song or video can be fetched again on its own, without its whole playlist.
    refetch: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    moved: Vec<Moved>,
    failed: Vec<Failed>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Moved {
    id: u64,
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Failed {
    id: u64,
    error: String,
}

fn in_library(job: &Job) -> bool {
    job.status == "done" && !job.hidden_in_library && !job.file.is_empty()
}

// The address that brings back this one file: the task's own link, or for an item of a playlist the video
// that the download archive names (only YouTube keys can be turned back into a link).
fn item_url(jobs: &[Job], job: &Job) -> Option<String> {
    match job.library_parent {
        Some(parent) if parent != job.id => {
            let parent = jobs.iter().find(|j| j.id == parent)?;
            let key = parent.downloads.iter().find(|[_, file]| *file == job.file).map(|[key, _]| key.as_str())?;
            let video = key.strip_prefix("youtube ")?.trim();
            let valid = video.len() == 11 && video.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
            valid.then(|| format!("https://www.youtube.com/watch?v={video}"))
        }
        _ if job.downloads.len() > 1 => None,
        _ => (!job.url.is_empty()).then(|| job.url.clone()),
    }
}

fn missing_in(jobs: &[Job], exists: impl Fn(&Path) -> bool) -> Vec<Missing> {
    jobs.iter()
        .filter(|job| in_library(job) && !exists(Path::new(&job.file)))
        .map(|job| Missing { id: job.id, refetch: item_url(jobs, job).is_some() })
        .collect()
}

// Library files that are no longer where they were saved, for example moved or deleted by hand.
#[tauri::command]
pub async fn library_missing(engine: tauri::State<'_, Engine>) -> Result<Vec<Missing>, String> {
    let jobs = engine.data.lock().unwrap().jobs.clone();
    tauri::async_runtime::spawn_blocking(move || missing_in(&jobs, |path| path.is_file())).await.map_err(|e| e.to_string())
}

// A missing file is downloaded again as a new task, alone even if it came with a playlist, into the folder it
// was first saved to. The old entry leaves the library; the new one takes its place when it finishes.
#[tauri::command]
pub fn library_refetch(id: u64, engine: tauri::State<Engine>) -> Result<(), String> {
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    let job = d.jobs.iter().find(|j| j.id == id && in_library(j)).cloned().ok_or("Task not found")?;
    if Path::new(&job.file).is_file() { return Err("This file is still in the library".into()); }
    let url = item_url(&d.jobs, &job).ok_or("This item can only be downloaded again with its playlist")?;
    let mut next = Job { url, options: job.options.clone(), status: "queued".into(), ..Job::default() };
    next.options.playlist = false;
    next.options.playlist_items.clear();
    next.options.gallery_items.clear();
    next.options.archive = false;
    next.id = allocate_id(&mut d);
    d.jobs.push(next);
    if let Some(entry) = d.jobs.iter_mut().find(|j| j.id == id) { entry.hidden_in_library = true; }
    if let Err(error) = save(&engine.dir, &d) { *d = old; return Err(error); }
    Ok(())
}

// A file moved or renamed by hand is pointed out again; the library keeps its collection, tags and history.
#[tauri::command]
pub fn library_locate(id: u64, path: String, engine: tauri::State<Engine>) -> Result<String, String> {
    let file = PathBuf::from(path.trim());
    if !file.is_absolute() || !file.is_file() { return Err("The file is no longer at the saved path".into()); }
    let file = file.to_string_lossy().into_owned();
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    let from = d.jobs.iter().find(|j| j.id == id && in_library(j)).map(|j| j.file.clone()).ok_or("Task not found")?;
    repoint(&mut d.jobs, id, &from, &file);
    if let Err(error) = save(&engine.dir, &d) { *d = old; return Err(error); }
    Ok(file)
}

// The files beside a download that share its name, such as "Song.en.srt" or "Song.webp".
fn companions(file: &Path) -> Vec<PathBuf> {
    let (Some(dir), Some(stem), Some(name)) = (file.parent(), file.file_stem().and_then(|s| s.to_str()), file.file_name()) else {
        return vec![];
    };
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let prefix = format!("{stem}.");
    entries.flatten().take(5000).map(|entry| entry.path()).filter(|path| {
        let Some(other) = path.file_name().and_then(|s| s.to_str()) else { return false };
        path.file_name() != Some(name) && path.is_file() && other.starts_with(&prefix)
            && COMPANIONS.iter().any(|ext| other.len() > ext.len() && other.to_ascii_lowercase().ends_with(&format!(".{ext}")))
    }).collect()
}

// Rename when both folders are on one drive, otherwise copy and then delete the original. A failed copy
// leaves nothing half-written behind.
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if to.exists() { return Err("A file with this name is already in that folder".into()); }
    if std::fs::rename(from, to).is_ok() { return Ok(()); }
    if std::fs::copy(from, to).is_err() {
        let _ = std::fs::remove_file(to);
        return Err("Could not move the file".into());
    }
    if std::fs::remove_file(from).is_err() {
        let _ = std::fs::remove_file(to);
        return Err("Could not move the file".into());
    }
    Ok(())
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn move_one(from: &Path, folder: &Path) -> Result<Option<PathBuf>, String> {
    let name = from.file_name().ok_or("The file is no longer at the saved path")?;
    let to = folder.join(name);
    if !from.is_file() { return Err("The file is no longer at the saved path".into()); }
    if same_file(from.parent().unwrap_or(from), folder) { return Ok(None); }
    let extras = companions(from);
    move_file(from, &to)?;
    // Companions follow when they can; one that clashes with a file already there stays behind.
    for extra in extras {
        if let Some(extra_name) = extra.file_name() { let _ = move_file(&extra, &folder.join(extra_name)); }
    }
    Ok(Some(to))
}

// Points every record of a moved file at its new place: the file itself and the playlist that listed it.
fn repoint(jobs: &mut [Job], id: u64, from: &str, to: &str) {
    if let Some(job) = jobs.iter_mut().find(|j| j.id == id) { job.file = to.to_string(); }
    for job in jobs.iter_mut() {
        if job.file == from && job.status == "done" { job.file = to.to_string(); }
        for entry in job.downloads.iter_mut().filter(|entry| entry[1] == from) { entry[1] = to.to_string(); }
    }
}

// Moves finished downloads to another folder and keeps them in the library.
#[tauri::command]
pub async fn move_downloads(ids: Vec<u64>, folder: String, engine: tauri::State<'_, Engine>) -> Result<MoveReport, String> {
    let folder = plain_folder(&folder);
    if !folder.is_absolute() || !folder.is_dir() { return Err("Pick an existing folder".into()); }
    let plan: Vec<(u64, PathBuf)> = {
        let d = engine.data.lock().unwrap();
        ids.iter().take(10_000).filter_map(|id| d.jobs.iter().find(|j| j.id == *id && in_library(j)))
            .map(|job| (job.id, PathBuf::from(&job.file))).collect()
    };
    if plan.is_empty() { return Err("Task not found".into()); }
    let target = folder.clone();
    let mut report = tauri::async_runtime::spawn_blocking(move || {
        let mut report = MoveReport::default();
        for (id, from) in plan {
            match move_one(&from, &target) {
                Ok(Some(to)) => report.moved.push(Moved { id, from: from.to_string_lossy().into_owned(), to: to.to_string_lossy().into_owned() }),
                Ok(None) => {}
                Err(error) => report.failed.push(Failed { id, error }),
            }
        }
        report
    }).await.map_err(|e| e.to_string())?;
    if report.moved.is_empty() { return Ok(report); }
    let mut d = engine.data.lock().unwrap();
    let old = d.clone();
    for item in &report.moved { repoint(&mut d.jobs, item.id, &item.from, &item.to); }
    if let Err(error) = save(&engine.dir, &d) {
        *d = old;
        drop(d);
        // The records could not be saved, so the files go back where the library expects them.
        for item in report.moved.drain(..) {
            let _ = move_file(Path::new(&item.to), Path::new(&item.from));
            report.failed.push(Failed { id: item.id, error: error.clone() });
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn done(id: u64, file: &str, url: &str) -> Job {
        Job { id, file: file.into(), url: url.into(), status: "done".into(), ..Job::default() }
    }

    #[test]
    fn missing_files_are_listed_and_only_lone_items_can_be_fetched_again() {
        let mut parent = done(1, "/music/b.mp3", "https://www.youtube.com/playlist?list=PL1");
        parent.downloads = vec![["youtube dQw4w9WgXcQ".into(), "/music/a.mp3".into()], ["youtube aaaaaaaaaaa".into(), "/music/b.mp3".into()]];
        let mut child = done(2, "/music/a.mp3", "https://www.youtube.com/playlist?list=PL1");
        child.library_parent = Some(1);
        let mut other_site = done(3, "/music/c.mp3", "https://example.com/list");
        other_site.library_parent = Some(9);
        let lone = done(4, "/video/d.mp4", "https://www.youtube.com/watch?v=xyz");
        let mut hidden = done(5, "/video/e.mp4", "https://x");
        hidden.hidden_in_library = true;
        let present = done(6, "/video/here.mp4", "https://x");
        let jobs = vec![parent, child, other_site, lone, hidden, present];
        let found = missing_in(&jobs, |path| path == Path::new("/video/here.mp4"));
        assert_eq!(found, vec![
            Missing { id: 1, refetch: false },
            Missing { id: 2, refetch: true },
            Missing { id: 3, refetch: false },
            Missing { id: 4, refetch: true },
        ]);
        assert_eq!(item_url(&jobs, &jobs[1]).as_deref(), Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    }

    #[test]
    fn a_moved_download_takes_its_subtitles_and_cover_and_the_records_follow() {
        let root = tempfile::tempdir().unwrap();
        let (from_dir, to_dir) = (root.path().join("old"), root.path().join("new"));
        std::fs::create_dir_all(&from_dir).unwrap();
        std::fs::create_dir_all(&to_dir).unwrap();
        for name in ["Song.mp4", "Song.en.srt", "Song.webp", "Song (live).mp4", "Other.srt"] {
            std::fs::write(from_dir.join(name), name).unwrap();
        }
        let moved = move_one(&from_dir.join("Song.mp4"), &to_dir).unwrap().unwrap();
        assert_eq!(moved, to_dir.join("Song.mp4"));
        for name in ["Song.mp4", "Song.en.srt", "Song.webp"] { assert!(to_dir.join(name).is_file(), "{name} moved"); }
        for name in ["Song (live).mp4", "Other.srt"] { assert!(from_dir.join(name).is_file(), "{name} stayed"); }
        assert_eq!(move_one(&to_dir.join("Song.mp4"), &to_dir).unwrap(), None, "already in that folder");
        std::fs::write(from_dir.join("Song.mp4"), "again").unwrap();
        assert!(move_one(&from_dir.join("Song.mp4"), &to_dir).is_err(), "a file of that name is not overwritten");

        let (from, to) = (from_dir.join("Song.mp4").to_string_lossy().into_owned(), moved.to_string_lossy().into_owned());
        let mut parent = done(1, "/x/last.mp4", "u");
        parent.downloads = vec![["youtube a".into(), from.clone()]];
        let mut jobs = vec![parent, done(2, &from, "u")];
        repoint(&mut jobs, 2, &from, &to);
        assert_eq!(jobs[1].file, to);
        assert_eq!(jobs[0].downloads[0][1], to);
    }
}
