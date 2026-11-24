// Automatic backups of the Devil Music profile (likes, playlists, history and learned taste): one file a week
// in the app's own folder, the newest six kept, so a damaged or wiped library can be brought back.
use crate::music_profile::validate;
use crate::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const KEEP: usize = 6;
const PREFIX: &str = "devil-music-";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Copy {
    name: String,
    path: String,
    size: u64,
    // Seconds since 1970.
    saved_at: u64,
}

fn folder(engine: &Engine) -> PathBuf {
    engine.dir.join("music-backups")
}

// The calendar date of a moment, for the file name (proleptic Gregorian, UTC).
fn date(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn valid_name(name: &str) -> bool {
    name.starts_with(PREFIX) && name.ends_with(".json") && name.len() < 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

fn copies(dir: &Path) -> Vec<Copy> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let mut found: Vec<Copy> = entries.flatten().filter_map(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata().ok()?;
        if !valid_name(&name) || !meta.is_file() { return None; }
        let saved_at = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
        Some(Copy { path: entry.path().to_string_lossy().into_owned(), name, size: meta.len(), saved_at })
    }).collect();
    found.sort_by(|a, b| b.saved_at.cmp(&a.saved_at).then_with(|| b.name.cmp(&a.name)));
    found
}

fn write(dir: &Path, text: &str, now: u64) -> Result<Copy, String> {
    validate(text)?;
    std::fs::create_dir_all(dir).map_err(|_| "Could not save the music backup")?;
    let name = format!("{PREFIX}{}.json", date(now));
    let file = dir.join(&name);
    let temporary = dir.join(format!("{name}.part"));
    std::fs::write(&temporary, text).and_then(|_| std::fs::rename(&temporary, &file)).map_err(|_| {
        let _ = std::fs::remove_file(&temporary);
        "Could not save the music backup".to_string()
    })?;
    for old in copies(dir).into_iter().skip(KEEP) { let _ = std::fs::remove_file(old.path); }
    copies(dir).into_iter().find(|copy| copy.name == name).ok_or_else(|| "Could not save the music backup".to_string())
}

// Saves today's copy (a second one the same day replaces it) and drops the oldest beyond six.
#[tauri::command]
pub async fn music_backup_save(text: String, engine: tauri::State<'_, Engine>) -> Result<Copy, String> {
    if text.len() > 32 * 1024 * 1024 { return Err("Invalid music profile.".into()); }
    let dir = folder(&engine);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || write(&dir, &text, now)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn music_backup_list(engine: tauri::State<Engine>) -> Vec<Copy> {
    copies(&folder(&engine))
}

#[tauri::command]
pub fn music_backup_read(name: String, engine: tauri::State<Engine>) -> Result<String, String> {
    if !valid_name(&name) { return Err("Invalid music profile.".into()); }
    let file = folder(&engine).join(&name);
    let meta = std::fs::metadata(&file).map_err(|_| "This backup is no longer there")?;
    if meta.len() > 32 * 1024 * 1024 { return Err("Invalid music profile.".into()); }
    let text = std::fs::read_to_string(&file).map_err(|_| "This backup is no longer there")?;
    validate(&text)?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE: &str = r#"{"format":"devil-music-profile","version":3,"saved":{},"taste":{}}"#;

    #[test]
    fn dates_are_calendar_days() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(951_782_400), "2000-02-29");
        assert_eq!(date(1_795_313_063), "2026-11-22");
    }

    #[test]
    fn backups_are_checked_named_by_day_and_only_the_newest_six_stay() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write(dir.path(), "{}", 0).is_err(), "only a real music profile is saved");
        for day in 0..8u64 {
            let copy = write(dir.path(), PROFILE, 1_795_000_000 + day * 86_400).unwrap();
            assert!(valid_name(&copy.name));
            let file = std::fs::File::options().write(true).open(&copy.path).unwrap();
            file.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_795_000_000 + day * 86_400)).unwrap();
        }
        let left = copies(dir.path());
        assert_eq!(left.len(), KEEP);
        assert!(left[0].name > left[5].name, "newest first");
        assert!(!valid_name("../profile.json") && !valid_name("devil-music-x/../y.json"));
    }
}
