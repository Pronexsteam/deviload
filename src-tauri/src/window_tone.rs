//! The colour Windows paints into a window before the page catches up, for example along the edge
//! while the window is being resized. Matching it to the theme keeps that edge from flashing black.

/// Parses `#rrggbb`.
pub(super) fn parse(color: &str) -> Option<(u8, u8, u8)> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) { return None; }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

#[tauri::command]
pub fn window_background(window: tauri::WebviewWindow, color: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    let (r, g, b) = parse(&color).ok_or("Invalid colour")?;
    window.set_background_color(Some(tauri::window::Color(r, g, b, 255))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::parse;
    #[test]
    fn only_six_digit_hex_colours_are_accepted() {
        assert_eq!(parse("#0b0c10"), Some((11, 12, 16)));
        assert_eq!(parse("#FFFFFF"), Some((255, 255, 255)));
        for bad in ["0b0c10", "#fff", "#12345g", "", "#1234567"] { assert_eq!(parse(bad), None); }
    }
}
