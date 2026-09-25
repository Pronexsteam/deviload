// Self-healing downloads: when yt-dlp fails in a way Deviload knows how to fix, the
// task is changed and queued again instead of ending in an error. Each fix is tried
// once per task, so a download never loops.
use crate::model::Job;
use std::{
    path::Path, sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

// Set when a task waits for a fresh yt-dlp; no new downloads start until it is done,
// because the executable cannot be replaced while it runs.
static UPDATE_WANTED: AtomicBool = AtomicBool::new(false);
static UPDATING: AtomicBool = AtomicBool::new(false);
static UPDATED_AT: AtomicU64 = AtomicU64::new(0);
static UPDATE_STARTED: AtomicU64 = AtomicU64::new(0);
const UPDATE_EVERY: u64 = 6 * 3600;
// An update that hangs (no network, say) must not hold the queue for good.
const UPDATE_GIVES_UP: u64 = 180;
const WAIT_AFTER_LIMIT: u64 = 600;

#[derive(Debug, PartialEq)]
pub enum Fix {
    // Retry with the account signed in through Deviload.
    SignIn,
    // Retry with the standard quality choice instead of an exact stream.
    AnyFormat,
    // Update yt-dlp, then retry.
    UpdateEngine,
    // YouTube asked to slow down: retry once, later.
    Wait,
}

impl Fix {
    fn key(&self) -> &'static str {
        match self { Fix::SignIn => "sign-in", Fix::AnyFormat => "format", Fix::UpdateEngine => "update", Fix::Wait => "wait" }
    }
}

fn recent(log: &[String]) -> String {
    log.iter().rev().take(30).rev().cloned().collect::<Vec<_>>().join(" ").to_ascii_lowercase()
}

// What to try for a failed task, if anything. `signed_in` tells whether a Deviload sign-in exists.
pub fn plan(job: &Job, signed_in: bool, now: u64) -> Option<Fix> {
    let log = recent(&job.log);
    let tried = |fix: &Fix| job.healed.iter().any(|key| key == fix.key());
    let has = |words: &[&str]| words.iter().any(|word| log.contains(word));
    let own_cookies = !job.options.cookies.is_empty() || !job.options.cookies_browser.is_empty();
    let fixes = [
        (has(&["sign in to confirm", "confirm your age", "login required", "members-only", "join this channel", "private video"])
            && signed_in && !own_cookies, Fix::SignIn),
        (has(&["requested format is not available"]) && !job.options.format_id.is_empty(), Fix::AnyFormat),
        (has(&["http error 429", "too many requests"]), Fix::Wait),
        (has(&["unable to extract", "signature extraction failed", "n challenge solving failed", "nsig extraction failed",
            "http error 403", "requested format is not available", "please report this issue", "po token"])
            && now.saturating_sub(UPDATED_AT.load(Ordering::Relaxed)) >= UPDATE_EVERY, Fix::UpdateEngine),
    ];
    fixes.into_iter().find(|(applies, fix)| *applies && !tried(fix)).map(|(_, fix)| fix)
}

// Changes the task for the fix and queues it again.
pub fn apply(job: &mut Job, fix: &Fix, cookies: &Path, now: u64) {
    job.healed.push(fix.key().into());
    let note = match fix {
        Fix::SignIn => { job.options.cookies = cookies.to_string_lossy().into_owned(); "YouTube asked to sign in; trying again with your account" }
        Fix::AnyFormat => { job.options.format_id.clear(); job.options.format_has_audio = false; "that stream is gone; trying again with the usual quality choice" }
        Fix::UpdateEngine => { UPDATE_WANTED.store(true, Ordering::Relaxed); "yt-dlp looks outdated; updating it and trying again" }
        Fix::Wait => { job.scheduled_at = Some(now + WAIT_AFTER_LIMIT); "YouTube asked to slow down; trying again in 10 minutes" }
    };
    job.status = "queued".into();
    job.percent = 0.0;
    job.speed.clear();
    job.file.clear();
    job.consume(&format!("Deviload: {note}"));
}

// True while new downloads must wait for yt-dlp to be replaced.
pub fn engine_update_pending(now: u64) -> bool {
    if UPDATING.load(Ordering::Relaxed) && now.saturating_sub(UPDATE_STARTED.load(Ordering::Relaxed)) > UPDATE_GIVES_UP {
        UPDATE_WANTED.store(false, Ordering::Relaxed);
        UPDATING.store(false, Ordering::Relaxed);
    }
    UPDATE_WANTED.load(Ordering::Relaxed) || UPDATING.load(Ordering::Relaxed)
}

// Called by the queue worker when nothing is downloading; runs the update once.
pub fn update_engine_when_idle(update: impl FnOnce() -> Result<(), String> + Send + 'static, now: u64) {
    if !UPDATE_WANTED.load(Ordering::Relaxed) || UPDATING.swap(true, Ordering::Relaxed) { return; }
    UPDATE_STARTED.store(now, Ordering::Relaxed);
    std::thread::spawn(move || {
        // A failed update still lets the task try once more with the old yt-dlp.
        let _ = update();
        UPDATED_AT.store(now, Ordering::Relaxed);
        UPDATE_WANTED.store(false, Ordering::Relaxed);
        UPDATING.store(false, Ordering::Relaxed);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Options;

    fn failed(lines: &[&str]) -> Job {
        Job { id: 1, url: "https://www.youtube.com/watch?v=x".into(), options: Options::default(), status: "running".into(), percent: 40.0,
            speed: "2.0".into(), file: String::new(), log: lines.iter().map(|line| line.to_string()).collect(), scheduled_at: None,
            auto_retry: false, retry_attempts: 0, archived: 0, healed: vec![], downloads: vec![], bytes: 0, duration: 0.0, channel: String::new(), pid: None, hidden_in_queue: false, hidden_in_library: false }
    }

    #[test]
    fn sign_in_is_used_once_and_only_when_it_exists() {
        let mut job = failed(&["ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies"]);
        assert_eq!(plan(&job, false, 0), None);
        assert_eq!(plan(&job, true, 0), Some(Fix::SignIn));
        apply(&mut job, &Fix::SignIn, Path::new("/data/youtube-cookies.txt"), 0);
        assert_eq!((job.status.as_str(), job.options.cookies.as_str()), ("queued", "/data/youtube-cookies.txt"));
        assert!(job.log.last().unwrap().starts_with("Deviload: "));
        // The same failure again: nothing more to try.
        job.log.push("ERROR: Sign in to confirm you're not a bot".into());
        assert_eq!(plan(&job, true, 0), None);
        // Cookies the user chose are left alone.
        let mut own = failed(&["Sign in to confirm your age"]);
        own.options.cookies_browser = "firefox".into();
        assert_eq!(plan(&own, true, 0), None);
    }

    #[test]
    fn a_missing_stream_falls_back_then_updates_the_engine() {
        let mut job = failed(&["ERROR: [youtube] x: Requested format is not available. Use --list-formats"]);
        job.options.format_id = "137".into();
        assert_eq!(plan(&job, false, UPDATE_EVERY), Some(Fix::AnyFormat));
        apply(&mut job, &Fix::AnyFormat, Path::new(""), 0);
        assert!(job.options.format_id.is_empty());
        assert_eq!(plan(&job, false, UPDATE_EVERY), Some(Fix::UpdateEngine));
        job.healed.push("update".into());
        assert_eq!(plan(&job, false, UPDATE_EVERY), None);
    }

    #[test]
    fn rate_limits_wait_and_unknown_errors_stay_errors() {
        let mut job = failed(&["ERROR: unable to download video data: HTTP Error 429: Too Many Requests"]);
        assert_eq!(plan(&job, true, 0), Some(Fix::Wait));
        apply(&mut job, &Fix::Wait, Path::new(""), 1000);
        assert_eq!(job.scheduled_at, Some(1000 + WAIT_AFTER_LIMIT));
        assert_eq!(plan(&failed(&["ERROR: Unsupported URL: https://example.com"]), true, UPDATE_EVERY), None);
        assert_eq!(plan(&failed(&["ERROR: [youtube] x: Video unavailable"]), true, UPDATE_EVERY), None);
    }
}
