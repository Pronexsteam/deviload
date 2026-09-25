// "When the downloads finish": put the computer to sleep or shut it down, after a
// minute in which the window shows a countdown with a cancel button. The queue
// worker reports whether anything is still downloading; this module waits for the
// queue to get busy once and then idle again.
use super::command;
use serde::Serialize;
use std::{
    path::Path, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, thread, time::Duration,
};
use tauri::{Emitter, Manager};

const COUNTDOWN_SECONDS: u64 = 60;
const ACTIONS: [&str; 2] = ["sleep", "shutdown"];

#[derive(Default)]
pub struct AfterDownloads {
    plan: Mutex<Option<Plan>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, PartialEq)]
struct Plan { action: String, seen_busy: bool }

#[derive(Serialize, Clone)]
struct Countdown { action: String, seconds: u64 }

// The action to take now, if the queue has just gone idle after being busy.
fn step(plan: &mut Option<Plan>, busy: bool) -> Option<String> {
    let current = plan.as_mut()?;
    if busy { current.seen_busy = true; return None; }
    if !current.seen_busy { return None; }
    plan.take().map(|done| done.action)
}

pub fn observe(app: &tauri::AppHandle, busy: bool) {
    let state = app.state::<AfterDownloads>();
    let Some(action) = step(&mut state.plan.lock().unwrap(), busy) else { return };
    let cancel = state.cancel.clone();
    cancel.store(false, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", "power-countdown", Countdown { action: action.clone(), seconds: COUNTDOWN_SECONDS });
    let app = app.clone();
    thread::spawn(move || {
        for _ in 0..COUNTDOWN_SECONDS * 4 {
            if cancel.load(Ordering::Relaxed) { let _ = app.emit_to("main", "power-cancelled", ()); return; }
            thread::sleep(Duration::from_millis(250));
        }
        // A copy running on test data never turns the computer off.
        if std::env::var_os("DEVILOAD_TEST_DATA_DIR").is_some() {
            let _ = app.emit_to("main", "power-simulated", action);
            return;
        }
        if let Err(error) = power(&action) { let _ = app.emit_to("main", "power-failed", error); }
    });
}

fn power(action: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = if action == "shutdown" {
        let mut cmd = command(Path::new("shutdown.exe"));
        cmd.args(["/s", "/t", "0"]);
        cmd
    } else {
        // rundll32's SetSuspendState hibernates when hibernation is on; this call really sleeps.
        let mut cmd = command(Path::new("powershell.exe"));
        cmd.args(["-NoProfile", "-NonInteractive", "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"]);
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut cmd = if action == "shutdown" {
        let mut cmd = command(Path::new("osascript"));
        cmd.args(["-e", "tell application \"System Events\" to shut down"]);
        cmd
    } else {
        let mut cmd = command(Path::new("pmset"));
        cmd.arg("sleepnow");
        cmd
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut cmd = command(Path::new("systemctl"));
        cmd.arg(if action == "shutdown" { "poweroff" } else { "suspend" });
        cmd
    };
    let status = cmd.status().map_err(|e| format!("Could not turn the computer off: {e}"))?;
    if status.success() { Ok(()) } else { Err("Could not turn the computer off: the system refused".into()) }
}

// "none" disarms; "sleep" and "shutdown" wait for the downloads that are running or start later.
#[tauri::command]
pub fn set_after_downloads(action: String, state: tauri::State<'_, AfterDownloads>) -> Result<(), String> {
    if action != "none" && !ACTIONS.contains(&action.as_str()) { return Err("Unknown action after the downloads".into()); }
    *state.plan.lock().unwrap() = (action != "none").then_some(Plan { action, seen_busy: false });
    Ok(())
}

#[tauri::command]
pub fn cancel_power(state: tauri::State<'_, AfterDownloads>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fires_once_after_the_queue_was_busy_and_went_idle() {
        let mut plan = Some(Plan { action: "shutdown".into(), seen_busy: false });
        // Armed while nothing downloads: wait for the next downloads instead of firing at once.
        assert_eq!(step(&mut plan, false), None);
        assert_eq!(step(&mut plan, true), None);
        assert_eq!(step(&mut plan, true), None);
        assert_eq!(step(&mut plan, false).as_deref(), Some("shutdown"));
        // Disarmed after firing.
        assert_eq!(plan, None);
        assert_eq!(step(&mut plan, true), None);
        assert_eq!(step(&mut plan, false), None);
    }
}
