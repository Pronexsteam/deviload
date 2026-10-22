// Queue recovery is local to a website. A rate-limited host must not stop other
// sites, and a wall-clock change must not turn ten minutes into an endless wait.
use serde::{Deserialize, Serialize};
use std::{sync::OnceLock, time::{Instant, SystemTime, UNIX_EPOCH}};

pub const RATE_LIMIT_WAIT: u64 = 10 * 60;
pub const ATTEMPT_STARTED: &str = "Deviload: starting download attempt";
const MAX_HOSTS: usize = 128;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCooldown {
    pub host: String,
    pub observed_at: u64,
    pub until: u64,
}

// Anchored UTC is convenient to persist, while elapsed time is monotonic. User
// schedules continue to use real UTC elsewhere; only cooldowns use this clock.
pub fn clock() -> u64 {
    static ANCHOR: OnceLock<(u64, Instant)> = OnceLock::new();
    let (utc, started) = ANCHOR.get_or_init(|| (
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(), Instant::now(),
    ));
    utc.saturating_add(started.elapsed().as_secs())
}

pub fn host_key(address: &str) -> Option<String> {
    let url = url::Url::parse(address).ok()?;
    if !matches!(url.scheme(), "http" | "https") { return None; }
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    let belongs = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    Some(if belongs("youtube.com") || host == "youtu.be" { "youtube.com".into() }
        else if belongs("facebook.com") || belongs("fb.com") || host == "fb.watch" { "facebook.com".into() }
        else if belongs("twitter.com") || belongs("x.com") { "x.com".into() }
        else if belongs("instagram.com") { "instagram.com".into() }
        else if belongs("tiktok.com") { "tiktok.com".into() }
        else { host })
}

// Called once when loading persisted state. Clock rollback is capped at the
// original (at most ten-minute) delay; expired, malformed and excess records go.
pub fn restore(records: &mut Vec<HostCooldown>, utc_now: u64, clock_now: u64) {
    let mut clean: Vec<HostCooldown> = Vec::new();
    for record in records.drain(..) {
        if clean.len() >= MAX_HOSTS { break; }
        if record.host.len() > 253 || host_key(&format!("https://{}/", record.host)).as_deref() != Some(record.host.as_str()) { continue; }
        let duration = record.until.saturating_sub(record.observed_at).min(RATE_LIMIT_WAIT);
        let remaining = if utc_now < record.observed_at { duration }
            else { record.until.saturating_sub(utc_now).min(duration) };
        if remaining == 0 { continue; }
        let until = clock_now.saturating_add(remaining);
        if let Some(existing) = clean.iter_mut().find(|item| item.host == record.host) {
            existing.until = existing.until.min(until);
        } else { clean.push(HostCooldown { host: record.host, observed_at: clock_now, until }); }
    }
    *records = clean;
}

pub fn defer_host(records: &mut Vec<HostCooldown>, address: &str, now: u64) -> Option<u64> {
    records.retain(|record| record.until > now);
    let host = host_key(address)?;
    // Concurrent failures do not keep extending an already active cooldown.
    if let Some(existing) = records.iter().find(|record| record.host == host) { return Some(existing.until); }
    if records.len() >= MAX_HOSTS {
        let oldest = records.iter().enumerate().min_by_key(|(_, record)| record.until).map(|(index, _)| index)?;
        records.remove(oldest);
    }
    let until = now.saturating_add(RATE_LIMIT_WAIT);
    records.push(HostCooldown { host, observed_at: now, until });
    Some(until)
}

pub fn remaining(records: &[HostCooldown], address: &str, now: u64) -> u64 {
    let Some(host) = host_key(address) else { return 0 };
    records.iter().filter(|record| record.host == host).map(|record| record.until.saturating_sub(now)).max().unwrap_or(0)
}

// The frontend uses real UTC for its countdown, even if the system clock changed
// while the app was open. The internal deadlines above stay monotonic.
pub fn public_records(records: &[HostCooldown], clock_now: u64, utc_now: u64) -> Vec<HostCooldown> {
    records.iter().filter_map(|record| {
        let left = record.until.saturating_sub(clock_now).min(RATE_LIMIT_WAIT);
        (left > 0).then(|| HostCooldown { host: record.host.clone(),
            observed_at: utc_now.saturating_sub(clock_now.saturating_sub(record.observed_at).min(RATE_LIMIT_WAIT)),
            until: utc_now.saturating_add(left) })
    }).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind { RateLimited, Authentication, Unavailable, Unsupported, Permission, Network, Other }

pub fn attempt_detail(log: &[String]) -> String {
    let start = log.iter().rposition(|line| line == ATTEMPT_STARTED).map_or(0, |index| index + 1);
    log[start..].iter().rev().take(30).rev().cloned().collect::<Vec<_>>().join(" ").to_ascii_lowercase()
}

pub fn classify(log: &[String]) -> FailureKind {
    let detail = attempt_detail(log);
    let has = |words: &[&str]| words.iter().any(|word| detail.contains(word));
    if has(&["http error 429", "http status 429", "429 client error", "429 too many requests", "too many requests", "rate limit exceeded", "rate-limit exceeded", "this gallery is limiting requests"]) { FailureKind::RateLimited }
    else if has(&["sign in", "login required", "log in to", "authentication", "--cookies", "empty media response", "members-only", "join this channel", "private video", "confirm your age"]) { FailureKind::Authentication }
    else if has(&["copyright", "video unavailable", "not available in your country", "has been removed", "no longer available"]) { FailureKind::Unavailable }
    else if has(&["unsupported url", "unsupported site"]) { FailureKind::Unsupported }
    else if has(&["permission denied", "access is denied", "no space left", "disk full"]) { FailureKind::Permission }
    else if has(&["timed out", "timeout", "connection reset", "connection refused", "temporary failure", "network is unreachable", "http error 502", "http error 503", "http error 504"]) { FailureKind::Network }
    else { FailureKind::Other }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn related_hosts_share_one_cooldown_without_cooling_other_sites() {
        let mut records = vec![];
        assert_eq!(defer_host(&mut records, "https://youtu.be/a", 100), Some(700));
        assert_eq!(defer_host(&mut records, "https://music.youtube.com/watch?v=b", 200), Some(700));
        assert_eq!(remaining(&records, "https://www.youtube.com/watch?v=c", 300), 400);
        assert_eq!(remaining(&records, "https://vimeo.com/c", 300), 0);
        assert_eq!(remaining(&records, "https://notyoutube.com/c", 300), 0);
        assert_eq!(remaining(&records, "https://youtu.be/a", 700), 0);
        assert_eq!(records.len(), 1);
    }
    #[test]
    fn persisted_deadlines_expire_and_clock_rollback_cannot_create_an_unbounded_wait() {
        let mut records = vec![HostCooldown { host: "youtube.com".into(), observed_at: 1000, until: 1600 },
            HostCooldown { host: "vimeo.com".into(), observed_at: 0, until: u64::MAX },
            HostCooldown { host: "bad/path".into(), observed_at: 1000, until: 1600 }];
        restore(&mut records, 1200, 1200);
        assert_eq!(remaining(&records, "https://youtube.com/a", 1200), 400);
        assert!(records.iter().all(|record| record.until <= 1800));
        assert_eq!(records.len(), 2);
        restore(&mut records, 500, 500);
        assert!(records.iter().all(|record| record.until <= 1100));
        restore(&mut records, 2000, 2000);
        assert!(records.is_empty());
    }
    #[test]
    fn public_countdown_uses_remaining_time_after_a_wall_clock_jump() {
        let mut records = vec![];
        defer_host(&mut records, "https://example.com/a", 1000);
        assert_eq!(public_records(&records, 1100, 50_000)[0].until, 50_500);
        assert_eq!(public_records(&records, 1100, 500)[0].until, 1000);
        assert!(public_records(&records, 1600, 500).is_empty());
    }
    #[test]
    fn cooldown_storage_is_bounded_and_does_not_include_url_secrets() {
        let mut records = vec![];
        for number in 0..200 { defer_host(&mut records, &format!("https://user:secret@host{number}.example/a?token=secret"), 10); }
        assert_eq!(records.len(), MAX_HOSTS);
        assert!(!serde_json::to_string(&records).unwrap().contains("secret"));
    }
    #[test]
    fn only_the_current_attempt_classifies_and_terminal_errors_do_not_become_network_retries() {
        let old = vec!["ERROR: HTTP Error 429: Too Many Requests".into(), ATTEMPT_STARTED.into(), "ERROR: HTTP Error 503: Service Unavailable".into()];
        assert_eq!(classify(&old), FailureKind::Network);
        for (line, expected) in [
            ("ERROR: HTTP Error 429; please report this issue", FailureKind::RateLimited),
            ("This gallery is limiting requests. Wait before retrying.", FailureKind::RateLimited),
            ("Login required; HTTP Error 503", FailureKind::Authentication),
            ("Unsupported URL; timeout", FailureKind::Unsupported),
            ("No space left on device; timeout", FailureKind::Permission),
            ("Video unavailable; timeout", FailureKind::Unavailable),
        ] { assert_eq!(classify(&[line.into()]), expected); }
    }
}
