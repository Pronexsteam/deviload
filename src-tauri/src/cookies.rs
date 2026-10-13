use std::{fs, io::Read, path::Path};

pub fn validate_file(path: &Path, now: u64) -> Result<usize, String> {
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
    validate_text(&text, now)
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
}
