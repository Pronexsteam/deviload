// Local development bridge using the same guest catalog and playback code as Tauri.
#[cfg(debug_assertions)]
fn main() {
    use std::io::{BufRead, Write};
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
        std::thread::spawn(move || {
        let args = &value["args"];
        let result = match value["command"].as_str() {
            Some("music_import_spotify_playlist") => deviload_lib::preview_spotify_playlist(args["link"].as_str().unwrap_or("")),
            Some("music_catalog") => deviload_lib::preview_music_catalog(args["kind"].as_str().unwrap_or(""), args["value"].as_str().unwrap_or(""), args["language"].as_str().unwrap_or("en"), "", args["filter"].as_str().unwrap_or("all"), args["continuation"].as_str().unwrap_or("")).and_then(|v| serde_json::to_value(v).map_err(|_| "Invalid response".to_owned())),
            Some("music_cancel_stream") => { deviload_lib::preview_music_cancel_stream(); Ok(serde_json::Value::Null) },
            Some("music_stream") => deviload_lib::preview_music_stream_request(args["id"].as_str().unwrap_or(""), "", args["refresh"].as_bool().unwrap_or(false), args["preload"].as_bool().unwrap_or(false)).and_then(|v| serde_json::to_value(v).map_err(|_| "Invalid response".to_owned())),
            Some("music_prepare") => { deviload_lib::preview_music_prepare(); Ok(serde_json::Value::Null) },
            Some("music_cache") => tauri::async_runtime::block_on(deviload_lib::preview_music_cache(args["clear"].as_bool(),args["limit"].as_u64())),
            Some("music_engine_update") => tauri::async_runtime::block_on(deviload_lib::preview_music_engine_update()),
            Some("music_lyrics") => deviload_lib::preview_music_lyrics(args["title"].as_str().unwrap_or(""), args["artist"].as_str().unwrap_or(""), args["duration"].as_f64().unwrap_or(0.0), ""),
            _ => Err("Unknown preview command".into()),
        };
        let response = match result { Ok(data) => serde_json::json!({"id":value["id"],"data":data}), Err(error) => serde_json::json!({"id":value["id"],"error":error}) };
        println!("{response}");
        let _ = std::io::stdout().flush();
        });
    }
}

#[cfg(not(debug_assertions))]
fn main() { eprintln!("The music preview is only available in development builds."); }
