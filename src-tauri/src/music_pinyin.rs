// Pinyin with tone marks for the Chinese characters of a song's lyrics, so lines in Chinese can be read in Latin
// letters under the original. Lyrics in Japanese never come here: a Chinese reading of kanji would be wrong.
use pinyin::ToPinyin;

fn is_han(c: char) -> bool {
    matches!(c as u32, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff)
}

fn readings(text: &str) -> Vec<(String, String)> {
    let mut seen = std::collections::HashSet::new();
    text.chars()
        .filter(|c| is_han(*c) && seen.insert(*c))
        .take(6000)
        .filter_map(|c| c.to_pinyin().map(|reading| (c.to_string(), reading.with_tone().to_string())))
        .collect()
}

// Each distinct character once, with its most common reading.
#[tauri::command]
pub fn music_pinyin(text: String) -> Vec<(String, String)> {
    readings(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_characters_get_their_pinyin_once_and_other_text_is_ignored() {
        let found = readings("\u{6211}\u{7231}\u{4f60} love \u{6211}");
        assert_eq!(found, vec![
            ("\u{6211}".to_string(), "w\u{01d2}".to_string()),
            ("\u{7231}".to_string(), "\u{00e0}i".to_string()),
            ("\u{4f60}".to_string(), "n\u{01d0}".to_string()),
        ]);
    }
}
