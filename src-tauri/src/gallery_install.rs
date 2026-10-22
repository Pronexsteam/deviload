// Optional, pinned upstream engine. Nothing is installed until the user asks.
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Seek, SeekFrom, Write}, path::Path, sync::Mutex, time::Duration};

const VERSION: &str = "1.32.17";
const MAX_BYTES: u64 = 32 * 1024 * 1024;
static INSTALLING: Mutex<()> = Mutex::new(());

fn asset() -> Result<(&'static str, &'static str), String> {
    if cfg!(all(target_os="windows",target_arch="x86_64")) {
        Ok(("gallery-dl.exe", "77c8f4c6808cf1044a54ec7187b548f5977f7c304d5432b63cf6cfdfe70ffc12"))
    } else if cfg!(all(target_os="linux",target_arch="x86_64")) {
        Ok(("gallery-dl.bin", "ccf4d304408a0d57ef78d4ad9221aaad964e36b57466109b48595a52377dcdcc"))
    } else { Err("Automatic gallery engine installation is available on Windows and Linux x64. Install gallery-dl in PATH on this platform.".into()) }
}

fn copy_verified(input: &mut impl Read, output: &mut fs::File, expected: &str) -> Result<(), String> {
    let mut total = 0u64; let mut digest = Sha256::new(); let mut buffer = [0; 65536];
    loop {
        let count = input.read(&mut buffer).map_err(|_| "The gallery engine download was interrupted. Try again.")?;
        if count == 0 { break; }
        total += count as u64;
        if total > MAX_BYTES { return Err("The gallery engine download exceeds its size limit.".into()); }
        digest.update(&buffer[..count]);
        output.write_all(&buffer[..count]).map_err(|_| "Could not save the gallery engine. Check disk space and folder permissions.")?;
    }
    if total == 0 || format!("{:x}",digest.finalize()) != expected {
        return Err("The gallery engine checksum did not match. Nothing was installed.".into());
    }
    output.sync_all().map_err(|_| "Could not save the gallery engine. Check disk space and folder permissions.".into())
}

fn prepare_verified(input: &mut impl Read, engines: &Path, checksum: &str,
    check: impl FnOnce(&Path) -> Result<(), String>) -> Result<tempfile::TempPath, String> {
    let mut temp = tempfile::Builder::new().prefix("gallery-install-").suffix(if cfg!(windows) {".exe"} else {""}).tempfile_in(engines)
        .map_err(|_| "Could not create the gallery engine download file.")?;
    copy_verified(input,temp.as_file_mut(),checksum)?;
    temp.as_file_mut().seek(SeekFrom::Start(0)).map_err(|_| "Could not inspect the gallery engine download.")?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(temp.path(),fs::Permissions::from_mode(0o755)).map_err(|_| "Could not make the gallery engine executable.")?; }
    // Close the writable handle before running a verified image (ETXTBSY on Unix).
    let path = temp.into_temp_path();
    check(&path)?;
    Ok(path)
}

fn publish_verified(path: tempfile::TempPath, target: &Path) -> Result<(), String> {
    // A concurrent/manual installation is always kept. On failure the owned
    // temporary path is dropped and removed, never renamed over the target.
    path.persist_noclobber(target).map_err(|_| "Could not install the gallery engine. An existing engine was kept.".to_owned())
}

pub fn install(dir: &Path) -> Result<crate::gallery::GalleryInfo, String> {
    let _guard = INSTALLING.try_lock().map_err(|_| "The gallery engine is already being installed.")?;
    let (name, checksum) = asset()?;
    let engines = dir.join("engines");
    fs::create_dir_all(&engines).map_err(|_| "Could not create the gallery engine folder.")?;
    let target = engines.join(if cfg!(windows) { "gallery-dl.exe" } else { "gallery-dl" });
    if target.is_file() {
        let file = fs::File::open(&target).map_err(|_| "Could not open the existing gallery engine.")?;
        if file.metadata().map_err(|_| "Could not inspect the existing gallery engine.")?.len() <= MAX_BYTES {
            // A file can grow after metadata was read. Bound the read as well,
            // so a concurrent writer cannot force an unbounded allocation.
            let mut bytes = Vec::new();file.take(MAX_BYTES+1).read_to_end(&mut bytes).map_err(|_| "Could not inspect the existing gallery engine.")?;
            if bytes.len() as u64 <= MAX_BYTES && format!("{:x}",Sha256::digest(&bytes)) == checksum { return Ok(crate::gallery::info(dir)); }
        }
        return Err("A different gallery engine is already installed. Keep it or remove it before installing this version.".into());
    }
    let mut builder = reqwest::blocking::Client::builder().https_only(true).connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::limited(3)).user_agent("Deviload optional engine installer");
    let proxy = crate::PROXY.lock().unwrap().clone();
    if !proxy.is_empty() { builder = builder.proxy(reqwest::Proxy::all(&proxy).map_err(|_| "The proxy settings are invalid.")?); }
    let client = builder.build().map_err(|_| "Could not prepare the gallery engine download.")?;
    let url = format!("https://codeberg.org/mikf/gallery-dl/releases/download/v{VERSION}/{name}");
    let mut response = client.get(url).send().and_then(|r|r.error_for_status()).map_err(|_| "Could not download the gallery engine. Check your connection or proxy.")?;
    if response.content_length().is_some_and(|n| n > MAX_BYTES) { return Err("The gallery engine download exceeds its size limit.".into()); }
    let path = prepare_verified(&mut response,&engines,checksum,|path| {
        let mut cmd = crate::command(path);cmd.args(["--config-ignore","--no-input","--version"]);
        let checked = crate::engine_update::output(&mut cmd,Duration::from_secs(5)).map_err(|_| "The downloaded gallery engine could not start.")?;
        if !checked.status.success() || String::from_utf8_lossy(&checked.stdout).trim() != VERSION {
            return Err("The downloaded gallery engine reported an unexpected version.".into());
        }
        Ok(())
    })?;
    let notice = format!("gallery-dl {VERSION}\nGPL-2.0-only; optional separate executable.\nSource: https://codeberg.org/mikf/gallery-dl/archive/v{VERSION}.tar.gz\nSHA-256: {checksum}\nLicense: https://codeberg.org/mikf/gallery-dl/src/tag/v{VERSION}/LICENSE\n");
    fs::write(engines.join(format!("gallery-dl-{VERSION}.SOURCE.txt")),notice).map_err(|_| "Could not save the gallery engine license notice.")?;
    fs::write(engines.join("gallery-dl.COPYING.GPLv2.txt"),include_str!("../../LICENSES/gallery-dl.COPYING.GPLv2.txt"))
        .map_err(|_| "Could not save the gallery engine license notice.")?;
    // publish without clobbering a concurrently installed engine
    publish_verified(path,&target)?;
    Ok(crate::gallery::info(dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn verifies_complete_bytes_and_rejects_partial_or_changed_downloads() {
        let mut file = tempfile::tempfile().unwrap();let bytes = b"verified engine bytes";
        let digest = format!("{:x}",Sha256::digest(bytes));
        copy_verified(&mut bytes.as_slice(),&mut file,&digest).unwrap();
        assert!(copy_verified(&mut b"partial".as_slice(),&mut file,&digest).is_err());
        assert!(copy_verified(&mut b"".as_slice(),&mut file,&digest).is_err());
        assert_eq!(file.metadata().unwrap().len(),bytes.len() as u64+7);
    }
    #[test] fn bounds_downloads_before_writing_excess_bytes() {
        let mut file = tempfile::tempfile().unwrap();let mut reader=std::io::repeat(0).take(MAX_BYTES+1);
        assert!(copy_verified(&mut reader,&mut file,"unused").unwrap_err().contains("size limit"));
        assert!(file.metadata().unwrap().len()<=MAX_BYTES);
    }
    #[test] fn verification_precedes_execution_and_failed_checks_leave_no_installed_or_temporary_engine() {
        let dir=tempfile::tempdir().unwrap();let bytes=b"verified offline fixture";let digest=format!("{:x}",Sha256::digest(bytes));
        let invoked=std::cell::Cell::new(false);
        assert!(prepare_verified(&mut b"changed bytes".as_slice(),dir.path(),&digest,|_| {invoked.set(true);Ok(())}).is_err());
        assert!(!invoked.get());assert_eq!(fs::read_dir(dir.path()).unwrap().count(),0);
        assert!(prepare_verified(&mut bytes.as_slice(),dir.path(),&digest,|path| {
            invoked.set(true);assert_eq!(fs::read(path).unwrap(),bytes);Err("invalid version fixture".into())
        }).unwrap_err().contains("invalid version"));
        assert!(invoked.get());assert_eq!(fs::read_dir(dir.path()).unwrap().count(),0);
    }
    #[test] fn atomic_publication_keeps_a_concurrent_engine_and_removes_the_rejected_temporary_file() {
        let dir=tempfile::tempdir().unwrap();let target=dir.path().join("gallery-dl");let bytes=b"verified offline fixture";
        let digest=format!("{:x}",Sha256::digest(bytes));
        let temp=prepare_verified(&mut bytes.as_slice(),dir.path(),&digest,|_| Ok(())).unwrap();let temporary=temp.to_path_buf();
        fs::write(&target,b"concurrent engine kept").unwrap();
        assert!(publish_verified(temp,&target).unwrap_err().contains("existing engine"));
        assert_eq!(fs::read(&target).unwrap(),b"concurrent engine kept");assert!(!temporary.exists());
        let other=dir.path().join("new-gallery-dl");
        let temp=prepare_verified(&mut bytes.as_slice(),dir.path(),&digest,|_| Ok(())).unwrap();
        publish_verified(temp,&other).unwrap();assert_eq!(fs::read(&other).unwrap(),bytes);
    }
}
