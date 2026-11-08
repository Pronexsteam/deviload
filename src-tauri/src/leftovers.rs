//! Files that earlier versions left behind and nothing uses any more.
use std::{fs, path::Path, time::{Duration, SystemTime}};

/// A folder this young may belong to an installer that is still running.
const SETTLED: Duration = Duration::from_secs(600);

/// The updater downloads every installer into its own folder in the temp directory
/// ("Deviload-2.9.0-updater-AbCdEf") and does not remove it after the update.
pub fn sweep_update_installers(temp: &Path, product: &str, now: SystemTime) -> usize {
    let Ok(entries) = fs::read_dir(temp) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(rest) = name.strip_prefix(product).and_then(|r| r.strip_prefix('-')) else { continue };
        let Some((version, _)) = rest.split_once("-updater-") else { continue };
        if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') { continue }
        if !entry.file_type().is_ok_and(|t| t.is_dir()) { continue }
        let settled = entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|m| now.duration_since(m).ok()).is_some_and(|age| age > SETTLED);
        if settled && fs::remove_dir_all(entry.path()).is_ok() { removed += 1 }
    }
    removed
}

/// Music engine folders older than the engine built into this version can no longer be chosen.
pub fn sweep_old_engines(root: &Path, current: u64) -> usize {
    let Ok(entries) = fs::read_dir(root) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(version) = name.to_str().and_then(|n| n.strip_prefix("engine-")).and_then(|v| v.parse::<u64>().ok()) else { continue };
        if version < current && entry.file_type().is_ok_and(|t| t.is_dir()) && fs::remove_dir_all(entry.path()).is_ok() { removed += 1 }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scratch(name: &str) -> std::path::PathBuf { let dir = std::env::temp_dir().join(format!("deviload-leftovers-{name}-{}", std::process::id())); let _ = fs::remove_dir_all(&dir); fs::create_dir_all(&dir).unwrap(); dir }

    #[test]
    fn only_settled_installer_folders_of_this_app_are_removed() {
        let temp = scratch("installers");
        for name in ["Deviload-2.9.0-updater-WkxJcj", "Deviload-2.10.0-updater-TFSbxA", "Deviload-notes", "Other-2.0.0-updater-abc", "Deviload-beta-updater-x"] { fs::create_dir_all(temp.join(name)).unwrap() }
        fs::write(temp.join("Deviload-2.8.0-updater-file"), b"").unwrap();
        let later = SystemTime::now() + Duration::from_secs(3600);
        assert_eq!(sweep_update_installers(&temp, "Deviload", SystemTime::now()), 0);
        assert_eq!(sweep_update_installers(&temp, "Deviload", later), 2);
        let mut left: Vec<_> = fs::read_dir(&temp).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["Deviload-2.8.0-updater-file", "Deviload-beta-updater-x", "Deviload-notes", "Other-2.0.0-updater-abc"]);
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn engines_older_than_the_built_in_one_are_removed() {
        let root = scratch("engines");
        for name in ["engine-1", "engine-2", "engine-3", "engine-x", "audio"] { fs::create_dir_all(root.join(name)).unwrap() }
        assert_eq!(sweep_old_engines(&root, 2), 1);
        assert!(!root.join("engine-1").exists());
        for kept in ["engine-2", "engine-3", "engine-x", "audio"] { assert!(root.join(kept).exists()) }
        let _ = fs::remove_dir_all(root);
    }
}
