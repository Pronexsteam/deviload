// Local development bridge using the same guest catalog and playback code as Tauri.
#[cfg(debug_assertions)]
fn main() {
    use std::io::{BufRead, Write};
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
        std::thread::spawn(move || {
        let args = &value["args"];
        let result = match value["command"].as_str() {
            Some("music_catalog") => deviload_lib::preview_music_catalog(args["kind"].as_str().unwrap_or(""), args["value"].as_str().unwrap_or(""), args["language"].as_str().unwrap_or("en"), "").and_then(|v| serde_json::to_value(v).map_err(|_| "Invalid response".to_owned())),
            Some("music_stream") => deviload_lib::preview_music_stream_request(args["id"].as_str().unwrap_or(""), "", args["refresh"].as_bool().unwrap_or(false), args["preload"].as_bool().unwrap_or(false)).and_then(|v| serde_json::to_value(v).map_err(|_| "Invalid response".to_owned())),
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
