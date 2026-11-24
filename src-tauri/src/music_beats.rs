// The beat grid of a stretch of a song, for DJ transitions: its tempo, where one beat falls and how steady the
// beat is. ffmpeg decodes the stretch to a low mono rate; onsets give the tempo and the phase of the beats.
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

const RATE: f64 = 11025.0;
const HOP: usize = 128;
const WINDOW: usize = 256;

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
pub struct BeatGrid {
    pub bpm: f64,
    // A beat, in seconds from the start of the song.
    pub first: f64,
    // How far the beat stands out: about 1 for no beat, 2 and more for a steady one.
    pub confidence: f64,
}

fn onsets(samples: &[f32]) -> Vec<f64> {
    if samples.len() < WINDOW * 4 { return vec![]; }
    let frames = (samples.len() - WINDOW) / HOP;
    let loud: Vec<f64> = (0..frames).map(|k| {
        let energy: f64 = samples[k * HOP..k * HOP + WINDOW].iter().map(|s| (*s as f64) * (*s as f64)).sum();
        (1.0 + 100.0 * energy / WINDOW as f64).ln()
    }).collect();
    let rise: Vec<f64> = (0..frames).map(|k| if k == 0 { 0.0 } else { (loud[k] - loud[k - 1]).max(0.0) }).collect();
    // Only what rises above its neighbourhood counts, so a loud chorus does not look like a beat everywhere.
    (0..frames).map(|k| {
        let from = k.saturating_sub(8);
        let to = (k + 8).min(frames - 1);
        let mean = rise[from..=to].iter().sum::<f64>() / (to - from + 1) as f64;
        (rise[k] - mean).max(0.0)
    }).collect()
}

fn at(o: &[f64], position: f64) -> f64 {
    let i = position.floor() as usize;
    if i + 1 >= o.len() { return 0.0; }
    let f = position - i as f64;
    o[i] * (1.0 - f) + o[i + 1] * f
}

// The best phase for a period and the mean onset strength on the beats there.
fn comb(o: &[f64], period: f64) -> (f64, f64) {
    let mut best = (0.0, 0.0);
    let mut phase = 0.0;
    while phase < period {
        let (mut sum, mut beats, mut position) = (0.0, 0.0, phase);
        while position < o.len() as f64 - 1.0 {
            // A beat is a short moment; the frame either side still counts a little.
            sum += at(o, position) + 0.5 * (at(o, (position - 1.0).max(0.0)) + at(o, position + 1.0));
            beats += 1.0;
            position += period;
        }
        let score = if beats > 0.0 { sum / beats } else { 0.0 };
        if score > best.1 { best = (phase, score); }
        phase += 0.25;
    }
    best
}

pub fn beat_grid(samples: &[f32], from: f64) -> Option<BeatGrid> {
    let o = onsets(samples);
    let fps = RATE / HOP as f64;
    if o.len() < (fps * 6.0) as usize { return None; }
    let mean = o.iter().sum::<f64>() / o.len() as f64;
    if mean <= 1e-9 { return None; }
    // Tempo from the autocorrelation between 80 and 170 beats a minute.
    let (short, long) = ((fps * 60.0 / 170.0).floor() as usize, (fps * 60.0 / 80.0).ceil() as usize);
    let mut lag = (0, f64::MIN);
    for l in short..=long.min(o.len() / 3) {
        let sum: f64 = (0..o.len() - l).map(|k| o[k] * o[k + l]).sum::<f64>() / (o.len() - l) as f64;
        if sum > lag.1 { lag = (l, sum); }
    }
    if lag.0 == 0 { return None; }
    // A finer search around it: the period whose beats line up with the most onsets.
    let rough = lag.0 as f64;
    let mut best = (rough, 0.0, 0.0);
    let mut period = rough * 0.97;
    while period <= rough * 1.03 {
        let (phase, score) = comb(&o, period);
        if score > best.2 { best = (period, phase, score); }
        period += rough * 0.001;
    }
    let (period, phase, score) = best;
    Some(BeatGrid {
        bpm: (fps * 60.0 / period * 100.0).round() / 100.0,
        first: from + (phase * HOP as f64 + WINDOW as f64 / 2.0) / RATE,
        confidence: (score / (mean * 2.0)).min(20.0),
    })
}

// Only the music player's own sources: its loopback relays and local files.
fn source(url: &str) -> Result<(String, &'static str), String> {
    if url.starts_with("http://127.0.0.1:") { return Ok((url.to_owned(), "http,tcp")); }
    let encoded = url.strip_prefix("http://asset.localhost/").or_else(|| url.strip_prefix("asset://localhost/"))
        .ok_or("This source cannot be analysed")?;
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(byte) = hex { decoded.push(byte); i += 3; continue; }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    let path = PathBuf::from(String::from_utf8(decoded).map_err(|_| "This source cannot be analysed")?);
    if !path.is_file() { return Err("This source cannot be analysed".into()); }
    Ok((path.to_string_lossy().into_owned(), "file"))
}

fn decode(url: &str, from: f64, length: f64) -> Result<Vec<f32>, String> {
    let (input, protocols) = source(url)?;
    let mut child = crate::command(&crate::binary("ffmpeg")?)
        .args(["-v", "error", "-nostdin", "-protocol_whitelist", protocols, "-ss", &format!("{from:.3}"), "-t", &format!("{length:.3}"), "-i"])
        .arg(&input)
        .args(["-vn", "-ac", "1", "-ar", "11025", "-f", "f32le", "pipe:1"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| "Could not analyse the song")?;
    let mut stdout = child.stdout.take().ok_or("Could not analyse the song")?;
    let reader = std::thread::spawn(move || { let mut bytes = vec![]; let _ = stdout.read_to_end(&mut bytes); bytes });
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
        if started.elapsed() > Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Analysing the song took too long".into());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let bytes = reader.join().map_err(|_| "Could not analyse the song")?;
    Ok(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

#[tauri::command]
pub async fn music_beat_grid(url: String, from: f64, length: f64) -> Result<Option<BeatGrid>, String> {
    if !from.is_finite() || from < 0.0 || !length.is_finite() || !(4.0..=90.0).contains(&length) {
        return Err("This source cannot be analysed".into());
    }
    tauri::async_runtime::spawn_blocking(move || decode(&url, from, length).map(|samples| beat_grid(&samples, from)))
        .await.map_err(|_| "Could not analyse the song")?
}

#[cfg(test)]
mod tests {
    use super::*;
    // A kick every beat on a quiet bed of noise, starting [offset] seconds in.
    fn clicks(bpm: f64, offset: f64, seconds: f64) -> Vec<f32> {
        let mut seed = 7u32;
        let mut noise = || { seed = seed.wrapping_mul(1103515245).wrapping_add(12345); ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.02 };
        let total = (seconds * RATE) as usize;
        let mut out: Vec<f32> = (0..total).map(|_| noise()).collect();
        let mut beat = offset;
        while beat < seconds {
            let start = (beat * RATE) as usize;
            for i in 0..900.min(total.saturating_sub(start)) {
                out[start + i] += (i as f32 * 0.07).sin() * 0.8 * (-(i as f32) / 250.0).exp();
            }
            beat += 60.0 / bpm;
        }
        out
    }
    #[test]
    fn finds_the_tempo_and_where_the_beats_fall() {
        for (bpm, offset) in [(128.0, 0.37), (96.0, 0.12), (150.0, 0.2)] {
            let grid = beat_grid(&clicks(bpm, offset, 30.0), 100.0).unwrap();
            assert!((grid.bpm - bpm).abs() < 0.6, "{bpm}: {grid:?}");
            let period = 60.0 / bpm;
            let phase = ((grid.first - 100.0 - offset) / period).rem_euclid(1.0);
            assert!(phase.min(1.0 - phase) * period < 0.03, "{bpm}: {grid:?}");
            assert!(grid.confidence > 2.0, "{bpm}: {grid:?}");
        }
    }
    #[test]
    fn noise_has_no_steady_beat() {
        let mut seed = 3u32;
        let noise: Vec<f32> = (0..(20.0 * RATE) as usize).map(|_| { seed = seed.wrapping_mul(1103515245).wrapping_add(12345); ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.3 }).collect();
        assert!(beat_grid(&noise, 0.0).map_or(true, |grid| grid.confidence < 2.0));
        assert!(beat_grid(&[0.0; 4000], 0.0).is_none());
    }
    #[test]
    fn only_player_sources_are_read() {
        assert!(source("https://example.com/a.mp3").is_err());
        assert!(source("file:///C:/a.mp3").is_err());
        assert_eq!(source("http://127.0.0.1:4321/abc").unwrap().1, "http,tcp");
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a b.mp3");
        std::fs::write(&file, b"x").unwrap();
        let encoded: String = file.to_string_lossy().bytes().map(|b| if b.is_ascii_alphanumeric() || b == b'.' { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
        assert_eq!(source(&format!("http://asset.localhost/{encoded}")).unwrap().0, file.to_string_lossy());
        assert!(source("http://asset.localhost/C%3A%5Cmissing.mp3").is_err());
    }
}
