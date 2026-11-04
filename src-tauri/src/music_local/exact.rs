use super::{local_id,Entry};
use sha2::{Digest,Sha256};
use std::{fs::File,io::Read,path::{Path,PathBuf}};
use tauri::Manager;

const MISSING:&str="The selected local recording is unavailable.";
const CHANGED:&str="The local recording changed. Scan again and choose the exact copy.";

pub(super) fn indexed_source(dir: &Path, id: &str, expected: &str) -> Result<PathBuf, String> {
    super::load(dir)?;
    let entry = super::state().lock().map_err(|_| MISSING)?.index.entries.get(id).cloned().ok_or(MISSING)?;
    let verified = verify(&entry, expected);
    if verified.as_ref().err().is_some_and(|error| error == CHANGED) && entry.hash == expected {
        // An editor can preserve length and mtime. Force just this index entry
        // through the next requested scan, even when its cheap stamp matches.
        let mut state = super::state().lock().map_err(|_| MISSING)?;
        if let Some(stale) = state.index.entries.get_mut(id).filter(|e| !e.needs_scan && e.hash == entry.hash && e.path == entry.path) {
            stale.needs_scan = true;
            super::save(&state)?;
        }
    }
    verified
}

fn verify(entry: &Entry, expected: &str) -> Result<PathBuf, String> {
    if entry.hash != expected { return Err(CHANGED.into()); }
    let path = entry.path.canonicalize().map_err(|_| MISSING)?;
    let mut options = File::options();
    options.read(true);
    #[cfg(windows)] {
        // FILE_SHARE_READ prevents writes and replacement while hashing this open file.
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    let mut file = options.open(&path).map_err(|_| MISSING)?;
    #[cfg(unix)]
    let before = file.metadata().map_err(|_| MISSING)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|_| MISSING)?;
        if n == 0 { break; }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != expected { return Err(CHANGED.into()); }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        let after = path.metadata().map_err(|_| MISSING)?;
        if (before.dev(), before.ino(), before.ctime(), before.ctime_nsec()) != (after.dev(), after.ino(), after.ctime(), after.ctime_nsec()) {
            return Err(CHANGED.into());
        }
    }
    Ok(path)
}
#[tauri::command]
pub async fn music_local_exact(window:tauri::WebviewWindow,app:tauri::AppHandle,engine:tauri::State<'_,crate::Engine>,
    id:String,hash:String,play:bool)->Result<Option<String>,String>{
    if window.label()!="main"||!local_id(&id)||!local_id(&format!("local:{hash}")){return Err("Invalid local music track.".into());}
    let dir=engine.dir.clone();
    let path=tauri::async_runtime::spawn_blocking(move||indexed_source(&dir,&id,&hash)).await.map_err(|_|MISSING)??;
    if !play{return Ok(None);}
    app.asset_protocol_scope().allow_file(&path).map_err(|_|MISSING)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn replacing_same_path_and_editing_with_restored_mtime_cannot_reuse_approval(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("example.flac");
        std::fs::write(&path,b"exact copy").unwrap();
        let modified=path.metadata().unwrap().modified().unwrap();
        let hash=format!("{:x}",Sha256::digest(b"exact copy"));
        let entry=Entry{id:format!("local:{hash}"),hash:hash.clone(),path:path.clone(),..Default::default()};
        assert!(verify(&entry,&hash).is_ok());
        assert!(verify(&entry,&hash).is_ok());
        std::fs::write(&path,b"other take").unwrap();
        File::options().write(true).open(&path).unwrap().set_modified(modified).unwrap();
        assert_eq!(verify(&entry,&hash).unwrap_err(),CHANGED);
        let moved=dir.path().join("moved.flac");std::fs::rename(&path,&moved).unwrap();
        std::fs::write(&path,b"other take").unwrap();
        File::options().write(true).open(&path).unwrap().set_modified(modified).unwrap();
        assert_eq!(verify(&entry,&hash).unwrap_err(),CHANGED);
        std::fs::remove_file(&path).unwrap();assert_eq!(verify(&entry,&hash).unwrap_err(),MISSING);
    }
}
