use super::{model::Options, watch, Engine, STORE_LOCK};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};

const LIMIT: usize = 2_000_000;
const OPTION_KEYS: &[&str] = &["folder", "quality", "profile", "playlist", "splitChapters", "subtitles", "sponsorblock", "archive", "rateMbps", "folderRule", "nameRule", "container", "audioLanguage", "subtitleLanguages", "subtitleAuto"];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Backup {
    format: String, version: u32, options: Value, parallel: usize,
    default_folder: String, profiles: Vec<Value>, preferences: Value, watches: Vec<Source>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Source { url: String, title: String, kind: String, options: Value, seen: Vec<String> }

fn portable_options(value: &Value) -> Value {
    let mut output = serde_json::Map::new();
    for key in OPTION_KEYS { if let Some(value) = value.get(key) { output.insert((*key).into(), value.clone()); } }
    Value::Object(output)
}

fn preferences(value: &Value) -> Value {
    let mut output = serde_json::Map::new();
    for (key, allowed) in [
        ("deviload-lang", vec!["en", "ru", "es"]),
        ("deviload-theme", vec!["classic", "glass-light", "matte-black", "glass-black", "midnight"]),
        ("deviload-tray", vec!["true", "false"]),
        ("deviload-os-notify", vec!["true", "false"]),
        ("deviload-ytdlp-auto", vec!["true", "false"]),
        ("deviload-clipboard", vec!["true", "false"]),
        ("deviload-library-view", vec!["large", "small", "list"]),
        ("deviload-library-sort", vec!["new", "old", "name", "size", "duration"]),
    ] {
        if let Some(text) = value[key].as_str().filter(|text| allowed.contains(text)) { output.insert(key.into(), json!(text)); }
    }
    output.into()
}

fn options(value: &Value, fallback: &str, reset: &mut usize) -> Result<Options, String> {
    if !value.is_object() || OPTION_KEYS.iter().filter(|key| !["audioLanguage","subtitleLanguages","subtitleAuto"].contains(key)).any(|key| value.get(key).is_none()) { return Err("Invalid settings backup".into()); }
    let mut base = serde_json::to_value(Options::default()).unwrap();
    for (key, value) in portable_options(value).as_object().unwrap() { base[key] = value.clone(); }
    let mut options: Options = serde_json::from_value(base).map_err(|_| "Invalid settings backup")?;
    if !Path::new(&options.folder).is_absolute() || !Path::new(&options.folder).is_dir() {
        options.folder = fallback.into(); *reset += 1;
    }
    options.validate()?;
    Ok(options)
}

fn safe_url(raw: &str) -> Result<String, String> {
    let mut url = url::Url::parse(raw).map_err(|_| "Invalid settings backup")?;
    if !["http", "https"].contains(&url.scheme()) || !url.username().is_empty() || url.password().is_some() { return Err("Invalid settings backup".into()); }
    let pairs: Vec<_> = url.query_pairs().filter(|(key, _)| !["token", "access_token", "auth", "password", "key", "signature", "sig"].contains(&key.to_lowercase().as_str())).map(|(k,v)| (k.into_owned(),v.into_owned())).collect();
    url.set_query(None); url.set_fragment(None);
    if !pairs.is_empty() { url.query_pairs_mut().extend_pairs(pairs); }
    Ok(url.into())
}

fn clean_profile(value: &Value) -> Result<Value, String> {
    let name = value["name"].as_str().map(str::trim).filter(|name| !name.is_empty() && name.chars().count() <= 60).ok_or("Invalid settings backup")?;
    let fallback = super::model::download_dir().to_string_lossy().into_owned();
    let mut raw = portable_options(&value["options"]); raw["folder"] = json!(fallback);
    let cleaned = options(&raw, &fallback, &mut 0)?;
    let parallel = value["options"]["parallel"].as_u64().filter(|p| [1,2,3,4,6,8].contains(p)).ok_or("Invalid settings backup")?;
    let retry = value["options"]["autoRetry"].as_bool().ok_or("Invalid settings backup")?;
    let mut output = portable_options(&serde_json::to_value(cleaned).unwrap());
    output.as_object_mut().unwrap().remove("folder"); output["parallel"] = json!(parallel); output["autoRetry"] = json!(retry);
    Ok(json!({"name":name,"options":output}))
}

fn checked(text: &str) -> Result<(Backup, usize), String> {
    if text.len() > LIMIT { return Err("Settings backup is too large".into()); }
    let mut backup: Backup = serde_json::from_str(text).map_err(|_| "Invalid settings backup")?;
    if backup.format != "deviload-settings" || backup.version != 1 { return Err("Unsupported settings backup".into()); }
    if backup.profiles.len() > 32 || backup.watches.len() > 50 || ![1,2,3,4,6,8].contains(&backup.parallel) { return Err("Invalid settings backup".into()); }
    let fallback = super::model::download_dir().to_string_lossy().into_owned();
    let mut reset = 0;
    backup.options = portable_options(&serde_json::to_value(options(&backup.options, &fallback, &mut reset)?).unwrap());
    if !backup.default_folder.is_empty() && (!Path::new(&backup.default_folder).is_absolute() || !Path::new(&backup.default_folder).is_dir()) { backup.default_folder = fallback.clone(); reset += 1; }
    backup.preferences = preferences(&backup.preferences);
    backup.profiles = backup.profiles.iter().map(clean_profile).collect::<Result<_,_>>()?;
    let mut names = std::collections::HashSet::new();
    if backup.profiles.iter().any(|profile| !names.insert(profile["name"].as_str().unwrap().to_lowercase())) { return Err("Invalid settings backup".into()); }
    let mut urls = std::collections::HashSet::new();
    for source in &mut backup.watches {
        if source.url.len() > 8192 || source.title.len() > 1000 || !["", "artist"].contains(&source.kind.as_str()) || source.seen.len() > 3000 || source.seen.iter().any(|id| id.len() > 512) { return Err("Invalid settings backup".into()); }
        source.url = safe_url(&source.url)?;
        if !urls.insert(source.url.clone()) { return Err("Invalid settings backup".into()); }
        source.options = portable_options(&serde_json::to_value(options(&source.options, &fallback, &mut reset)?).unwrap());
    }
    Ok((backup, reset))
}

#[tauri::command]
pub(super) fn settings_backup_data(current: Value, parallel: usize, prefs: Value, engine: tauri::State<Engine>) -> Result<String, String> {
    let _watches = watch::WATCH_LOCK.lock().unwrap();
    let _store = STORE_LOCK.lock().unwrap();
    let data = engine.data.lock().unwrap();
    let store = super::read_store(&engine.dir);
    let sources = watch::load(&engine.dir).into_iter().map(|watch| Source {
        url:watch.url, title:watch.title, kind:watch.kind, seen:watch.seen,
        options:portable_options(&serde_json::to_value(watch.options).unwrap()),
    }).collect();
    let backup = Backup {format:"deviload-settings".into(),version:1,options:portable_options(&current),parallel,
        default_folder:data.default_folder.clone(), profiles:store.get("downloadProfiles").and_then(|v| v["items"].as_array()).cloned().unwrap_or_default(), preferences:preferences(&prefs), watches:sources};
    let (cleaned, _) = checked(&serde_json::to_string(&backup).map_err(|e| e.to_string())?)?;
    serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())
}

#[tauri::command]
pub(super) fn inspect_settings_backup(text: String) -> Result<Value, String> {
    let (backup, reset) = checked(&text)?;
    Ok(json!({"profiles":backup.profiles.len(),"watches":backup.watches.len(),"foldersReset":reset}))
}

// Stage all three documents before replacing any. A failed replacement restores earlier documents.
fn replace_documents(dir: &Path, documents: &[(&str, Vec<u8>)]) -> Result<(), String> {
    let mut staged = Vec::new();
    let mut originals = Vec::new();
    for (name, bytes) in documents {
        let path = dir.join(name);
        originals.push(match fs::read(&path) { Ok(bytes) => Some(bytes), Err(e) if e.kind() == std::io::ErrorKind::NotFound => None, Err(e) => return Err(e.to_string()) });
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?; file.as_file().sync_all().map_err(|e| e.to_string())?;
        staged.push(file);
    }
    for (index, file) in staged.into_iter().enumerate() {
        if let Err(error) = file.persist(dir.join(documents[index].0)) {
            for previous in 0..index {
                let path = dir.join(documents[previous].0);
                let rollback = if let Some(bytes) = &originals[previous] { fs::write(path, bytes) } else { fs::remove_file(path) };
                if let Err(rollback) = rollback { return Err(format!("{error}; rollback: {rollback}")); }
            }
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub(super) fn restore_settings_backup(text: String, engine: tauri::State<Engine>) -> Result<Value, String> {
    restore(&text, &engine)
}

fn restore(text: &str, engine: &Engine) -> Result<Value, String> {
    let (backup, _) = checked(&text)?;
    let _watches = watch::WATCH_LOCK.lock().unwrap();
    let _store = STORE_LOCK.lock().unwrap();
    let mut data = engine.data.lock().unwrap();
    let mut next = data.clone();
    let mut settings = options(&backup.options, &data.options.folder, &mut 0)?;
    settings.cookies = data.options.cookies.clone(); settings.cookies_browser = data.options.cookies_browser.clone(); settings.cookies_account = data.options.cookies_account;
    next.options = settings; next.parallel = backup.parallel; next.default_folder = backup.default_folder;
    let previous = watch::load(&engine.dir);
    let first_id = previous.iter().map(|w| w.id).max().unwrap_or(0).max(super::now_seconds()) + 1;
    let mut sources = Vec::new();
    for (index, source) in backup.watches.into_iter().enumerate() {
        let mut settings = options(&source.options, &next.options.folder, &mut 0)?;
        settings.cookies_account = true;
        let mut seen = source.seen;
        if let Some(old) = previous.iter().find(|w| w.url == source.url) {
            settings.cookies = old.options.cookies.clone(); settings.cookies_browser = old.options.cookies_browser.clone(); settings.cookies_account = old.options.cookies_account;
            let imported = seen; seen = old.seen.clone(); seen.extend(imported);
        }
        let mut unique = std::collections::HashSet::new(); seen.retain(|id| unique.insert(id.clone())); seen.truncate(3000);
        sources.push(watch::Watch {id:first_id + index as u64,url:source.url,title:source.title,kind:source.kind,options:settings,seen,
            checked_at:super::now_seconds(),queued:0,error:String::new()});
    }
    let mut store = super::read_store(&engine.dir);
    store.insert("downloadProfiles".into(), json!({"items":backup.profiles}));
    replace_documents(&engine.dir, &[("queue.json",serde_json::to_vec_pretty(&next).unwrap()),("library.json",serde_json::to_vec_pretty(&store).unwrap()),("watches.json",serde_json::to_vec_pretty(&sources).unwrap())])?;
    *data = next;
    Ok(backup.preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_backups_keep_languages_but_not_link_specific_audio_or_estimates() {
        let dir=tempfile::tempdir().unwrap();
        let mut value:Value=serde_json::from_str(&sample(dir.path())).unwrap();
        value["options"]["audioLanguage"]=json!("ja");value["options"]["subtitleLanguages"]=json!(["ja","es-419"]);value["options"]["subtitleAuto"]=json!(false);
        value["options"]["audioFormatId"]=json!("140");value["options"]["sourceSize"]=json!({"url":"https://private.example.com/a","bytes":100});
        let (backup,_)=checked(&value.to_string()).unwrap();
        assert_eq!(backup.options["audioLanguage"],"ja");assert_eq!(backup.options["subtitleLanguages"],json!(["ja","es-419"]));
        assert_eq!(backup.options["subtitleAuto"],false);assert!(backup.options.get("audioFormatId").is_none());assert!(backup.options.get("sourceSize").is_none());
        for key in ["audioLanguage","subtitleLanguages","subtitleAuto"] { value["options"].as_object_mut().unwrap().remove(key); }
        assert!(checked(&value.to_string()).is_ok());
    }

    fn sample(folder: &Path) -> String {
        let settings = Options {folder:folder.to_string_lossy().into(), ..Options::default()};
        serde_json::to_string(&Backup {format:"deviload-settings".into(),version:1,options:serde_json::to_value(settings).unwrap(),parallel:2,
            default_folder:String::new(),profiles:vec![],preferences:json!({"deviload-lang":"es","password":"private"}),watches:vec![]}).unwrap()
    }

    #[test]
    fn theme_preferences_round_trip_without_changing_backup_version_or_requiring_a_theme() {
        let dir = tempfile::tempdir().unwrap();
        let original = sample(dir.path());
        let (legacy, _) = checked(&original).unwrap();
        assert_eq!(legacy.version, 1);
        assert!(legacy.preferences.get("deviload-theme").is_none());
        assert_eq!(legacy.preferences["deviload-lang"], "es");
        for theme in ["classic", "glass-light", "matte-black", "glass-black", "midnight"] {
            let mut value: Value = serde_json::from_str(&original).unwrap();
            value["preferences"]["deviload-theme"] = json!(theme);
            let (backup, _) = checked(&value.to_string()).unwrap();
            let (round_trip, _) = checked(&serde_json::to_string(&backup).unwrap()).unwrap();
            assert_eq!(round_trip.version, 1);
            assert_eq!(round_trip.preferences["deviload-theme"], theme);
            assert_eq!(round_trip.preferences["deviload-lang"], "es");
            assert!(round_trip.preferences.get("password").is_none());
        }
    }

    #[test]
    fn invalid_theme_preferences_are_dropped_without_rejecting_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        for theme in [json!("unknown"), json!("Glass-Light"), json!(" glass-light"),
            json!("glass-black; background:url(https://example.com)"), json!("<script>alert(1)</script>"),
            json!(null), json!(true), json!(1), json!(["glass-light"]), json!({"theme":"glass-light"})] {
            let mut value: Value = serde_json::from_str(&sample(dir.path())).unwrap();
            value["preferences"]["deviload-theme"] = theme;
            let (backup, _) = checked(&value.to_string()).unwrap();
            assert!(backup.preferences.get("deviload-theme").is_none());
            assert_eq!(backup.preferences["deviload-lang"], "es");
        }
    }

    #[test]
    fn backup_strips_credentials_and_rejects_invalid_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let mut value: Value = serde_json::from_str(&sample(dir.path())).unwrap();
        value["options"]["cookies"] = json!("secret-cookie-file");
        value["options"]["cookiesBrowser"] = json!("chrome");
        value["options"]["token"] = json!("secret-token");
        let (backup, _) = checked(&value.to_string()).unwrap();
        let text = serde_json::to_string(&backup).unwrap();
        assert!(!text.contains("secret") && !text.contains("password") && !text.contains("cookies"));
        value["parallel"] = json!(100);
        assert!(checked(&value.to_string()).is_err());
        value["parallel"] = json!(2); value["version"] = json!(99);
        assert!(checked(&value.to_string()).is_err());
        assert!(checked(&"x".repeat(LIMIT + 1)).is_err());
    }

    #[test]
    fn missing_folders_fall_back_and_authenticated_urls_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut value: Value = serde_json::from_str(&sample(dir.path())).unwrap();
        value["options"]["folder"] = json!(dir.path().join("missing").to_string_lossy());
        assert_eq!(checked(&value.to_string()).unwrap().1, 1);
        assert!(safe_url("https://user:secret@example.com/videos").is_err());
        assert_eq!(safe_url("https://example.com/videos?token=secret&list=abc").unwrap(), "https://example.com/videos?list=abc");
    }

    #[test]
    fn restore_preserves_unrelated_store_and_account_settings() {
        let dir = tempfile::tempdir().unwrap();
        let mut data = super::super::Snapshot::default(); data.options.cookies_browser = "firefox".into(); data.next_id = 42;
        let engine = Engine {data:std::sync::Arc::new(std::sync::Mutex::new(data)),dir:dir.path().into(),shutdown:std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))};
        fs::write(dir.path().join("library.json"), br#"{"projects":{"keep":{}},"network":{"proxy":"local-secret"}}"#).unwrap();
        let mut backup: Value = serde_json::from_str(&sample(dir.path())).unwrap();
        backup["preferences"]["deviload-theme"] = json!("glass-black");
        let prefs = restore(&backup.to_string(), &engine).unwrap();
        assert_eq!(prefs["deviload-lang"], "es");
        assert_eq!(prefs["deviload-theme"], "glass-black");
        let store = super::super::read_store(dir.path());
        assert!(store["projects"].get("keep").is_some()); assert_eq!(store["network"]["proxy"], "local-secret");
        let data = engine.data.lock().unwrap(); assert_eq!(data.next_id, 42); assert_eq!(data.options.cookies_browser,"firefox");
    }

    #[test]
    fn invalid_destination_leaves_existing_documents_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("queue.json"), b"original").unwrap();
        fs::create_dir(dir.path().join("library.json")).unwrap();
        assert!(replace_documents(dir.path(), &[("queue.json",b"replacement".to_vec()),("library.json",b"new".to_vec())]).is_err());
        assert_eq!(fs::read(dir.path().join("queue.json")).unwrap(), b"original");
    }
}

#[tauri::command]
pub(super) async fn export_settings_backup(app: tauri::AppHandle, text: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let (backup, _) = checked(&text)?;
    let bytes = serde_json::to_vec_pretty(&backup).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().add_filter("Settings backup", &["json"]).set_file_name("deviload-settings.json").blocking_save_file() else { return Ok(false); };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("Choose a local folder")?).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?; file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?; Ok(true)
    }).await.map_err(|e| e.to_string())?
}
