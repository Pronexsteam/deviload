use std::{fs, io::Read, path::Path};

pub fn validate_file(path: &Path, now: u64) -> Result<usize, String> {
    validate_text(&read_cookie_text(path)?, now)
}

// Checking a saved session must remain local and bounded. A valid cookie file
// with a live, known session cookie is still not proof that the site accepts it.
pub fn has_saved_session_file(path: &Path, hosts: &[&str], names: &[&str], now: u64) -> bool {
    read_cookie_text(path).is_ok_and(|text| {
        validate_text(&text, now).is_ok() && has_session(&text, hosts, names, now)
    })
}

fn has_session(text: &str, hosts: &[&str], names: &[&str], now: u64) -> bool {
    text.lines().any(|line| {
        let line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
        if line.starts_with('#') { return false; }
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() != 7 { return false; }
        let host = fields[0].trim_start_matches('.').to_ascii_lowercase();
        hosts.iter().any(|known| !known.is_empty() && (host == *known || host.ends_with(&format!(".{known}"))))
            && names.contains(&fields[5]) && !fields[6].trim().is_empty()
            && fields[4].parse::<u64>().is_ok_and(|expiry| expiry == 0 || expiry > now)
    })
}

fn read_cookie_text(path: &Path) -> Result<String, String> {
    if !path.is_absolute() { return Err("Enter the full path to cookies.txt".into()); }
    let metadata = fs::metadata(path).map_err(|_| "The cookies file could not be opened. Check its path and permissions.".to_string())?;
    if !metadata.is_file() {
        return Err("Choose a cookies.txt file, not a folder".into());
    }
    let file = fs::File::open(path).map_err(|_| "The cookies file could not be opened. Check its path and permissions.".to_string())?;
    let mut text = String::new();
    file.take(5 * 1024 * 1024 + 1).read_to_string(&mut text)
        .map_err(|_| "The cookies file must be UTF-8 text in Netscape format".to_string())?;
    if text.len() > 5 * 1024 * 1024 { return Err("The cookies file is too large (maximum 5 MB)".into()); }
    Ok(text)
}

fn validate_text(text: &str, now: u64) -> Result<usize, String> {
    if !text.lines().next().is_some_and(|line| line.starts_with("# Netscape HTTP Cookie File") || line.starts_with("# HTTP Cookie File")) {
        return Err("Export cookies in Netscape cookies.txt format, not JSON or HTML".into());
    }
    let mut active = 0;
    for (index, line) in text.lines().enumerate() {
        let line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
        if line.trim().is_empty() || line.starts_with('#') { continue; }
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() != 7 || fields[0].is_empty() || !fields[2].starts_with('/')
            || !["TRUE", "FALSE"].contains(&fields[1]) || !["TRUE", "FALSE"].contains(&fields[3])
            || fields[4].parse::<u64>().is_err() {
            return Err(format!("Invalid Netscape cookie on line {}. Export a fresh cookies.txt file.", index + 1));
        }
        let expires = fields[4].parse::<u64>().unwrap();
        if (expires == 0 || expires > now) && (!fields[5].is_empty() || !fields[6].is_empty()) { active += 1; }
    }
    if active == 0 { return Err("The cookies file has no unexpired cookies. Export a fresh file after signing in.".into()); }
    Ok(active)
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEADER: &str = "# Netscape HTTP Cookie File\n";

    #[test]
    fn accepts_http_only_session_and_unexpired_cookies() {
        let text = format!("{HEADER}#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest\r\n.example.com\tTRUE\t/\tFALSE\t201\ta\tb\n.example.com\tTRUE\t/\tFALSE\t100\ta\tb\n");
        assert_eq!(validate_text(&text, 200).unwrap(), 2);
    }

    #[test]
    fn rejects_wrong_formats_expired_and_malformed_files_without_exposing_values() {
        for text in ["[]".to_owned(), HEADER.to_owned(), format!("{HEADER}.youtube.com\tTRUE\t/\tTRUE\t100\tSID\tprivate"),
            format!("{HEADER}.youtube.com\tTRUE\t/\tTRUE\tnan\tSID\tprivate"), format!("{HEADER}private")] {
            let error = validate_text(&text, 100).unwrap_err();
            assert!(!error.contains("private"));
        }
    }

    #[test]
    fn checks_the_selected_file_before_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_file(&dir.path().join("missing.txt"), 0).is_err());
        assert!(validate_file(dir.path(), 0).is_err());
        assert!(validate_file(Path::new("cookies.txt"), 0).is_err());
        let path = dir.path().join("cookies.txt");
        fs::write(&path, format!("{HEADER}.youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest")).unwrap();
        assert_eq!(validate_file(&path, 0).unwrap(), 1);
    }

    #[test]
    fn saved_session_requires_the_right_domain_name_expiry_and_nonempty_value() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.txt");
        let hosts = ["youtube.com", "google.com"];
        let names = ["LOGIN_INFO", "SID", "__Secure-3PSID"];
        for (line, expected) in [
            (".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret", true),
            ("#HttpOnly_.accounts.google.com\tTRUE\t/\tTRUE\t201\t__Secure-3PSID\tsecret", true),
            (".YouTube.com\tTRUE\t/\tTRUE\t0\tLOGIN_INFO\tsecret", true),
            (".youtube.com.attacker.example\tTRUE\t/\tTRUE\t0\tSID\tsecret", false),
            (".notyoutube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret", false),
            (".example.com\tTRUE\t/\tTRUE\t0\tSID\tsecret", false),
            (".youtube.com\tTRUE\t/\tTRUE\t200\tSID\tsecret", false),
            (".youtube.com\tTRUE\t/\tTRUE\t199\tSID\tsecret", false),
            (".youtube.com\tTRUE\t/\tTRUE\t0\tPREF\tsecret", false),
            (".youtube.com\tTRUE\t/\tTRUE\t0\tSID\t", false),
            (".youtube.com\tTRUE\t/\tTRUE\t0\tSID\t ", false),
            (".youtube.com\tTRUE\t/\tTRUE\tnan\tSID\tsecret", false),
        ] {
            fs::write(&path, format!("{HEADER}{line}\n")).unwrap();
            assert_eq!(has_saved_session_file(&path, &hosts, &names, 200), expected);
        }
    }

    #[test]
    fn an_existing_session_file_is_not_enough_and_failures_do_not_disclose_cookies() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.txt");
        let hosts = ["youtube.com"];
        let names = ["SID"];
        assert!(!has_saved_session_file(&path, &hosts, &names, 200));
        assert!(!has_saved_session_file(dir.path(), &hosts, &names, 200));
        assert!(!has_saved_session_file(Path::new("session.txt"), &hosts, &names, 200));
        for text in [String::new(), "[]".into(), ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret".into(),
            format!("{HEADER}.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\nmalformed-secret\n"),
            "x".repeat(5 * 1024 * 1024 + 1)] {
            fs::write(&path, text).unwrap();
            assert!(!has_saved_session_file(&path, &hosts, &names, 200));
            assert!(!validate_file(&path, 200).unwrap_err().contains("secret"));
        }
    }
}
