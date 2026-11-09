//! Notices when another app plays sound, for the optional "pause when another app plays" setting.
//! Nothing runs until the setting is turned on. Deviload's own processes and system sounds do not count.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;

static WATCHING: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);
const POLL: Duration = Duration::from_secs(1);
/// Quiet this long before "stopped" is reported, so pauses between two sounds do not resume the music.
const QUIET_POLLS: u32 = 3;

/// Turns the watcher on or off. The main window hears `other-audio` with `true` or `false` on changes.
#[tauri::command]
pub fn other_audio_watch(app: tauri::AppHandle, window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Unavailable window".into()); }
    WATCHING.store(enabled, Ordering::Release);
    if enabled && !RUNNING.swap(true, Ordering::AcqRel) {
        std::thread::Builder::new().name("other-audio".into()).spawn(move || { watch(app); RUNNING.store(false, Ordering::Release); }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn watch(app: tauri::AppHandle) {
    let mut playing = false;
    let mut quiet = 0u32;
    let mut family = Vec::new();
    let mut tick = 0u32;
    let mut sessions = None;
    #[cfg(windows)]
    unsafe { let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED); }
    while WATCHING.load(Ordering::Acquire) {
        // Deviload's own processes change rarely; their list is refreshed every few seconds.
        if tick % 8 == 0 { family = own_processes(); }
        tick = tick.wrapping_add(1);
        // The session manager is kept between checks and rebuilt only after an error, such as the
        // default output device changing.
        let now = match others_playing(&mut sessions, &family) { Ok(value) => value, Err(_) => { sessions = None; false } };
        if now { quiet = 0; } else { quiet += 1; }
        let next = if now { true } else if quiet >= QUIET_POLLS { false } else { playing };
        if next != playing { playing = next; let _ = app.emit_to("main", "other-audio", playing); }
        std::thread::sleep(POLL);
    }
    if playing { let _ = app.emit_to("main", "other-audio", false); }
}

/// Process ids of Deviload and everything it started, such as its web view and engines.
#[cfg(windows)]
fn own_processes() -> Vec<u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let root = std::process::id();
    let mut pairs = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return vec![root] };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32NextW(snapshot, &mut entry).is_err() { break; }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    descendants(root, &pairs)
}
#[cfg(not(windows))]
fn own_processes() -> Vec<u32> { vec![std::process::id()] }

/// [root] and every process below it in (pid, parent) pairs.
pub(super) fn descendants(root: u32, pairs: &[(u32, u32)]) -> Vec<u32> {
    let mut family = vec![root];
    let mut index = 0;
    while index < family.len() {
        let parent = family[index];
        for &(pid, owner) in pairs { if owner == parent && pid != parent && !family.contains(&pid) { family.push(pid); } }
        index += 1;
    }
    family
}

/// Whether any audio session outside [own] is actually making sound on the default output.
#[cfg(windows)]
type Sessions = windows::Win32::Media::Audio::IAudioSessionManager2;
#[cfg(not(windows))]
type Sessions = ();

#[cfg(windows)]
fn others_playing(cache: &mut Option<Sessions>, own: &[u32]) -> windows::core::Result<bool> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    unsafe {
        if cache.is_none() {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            *cache = Some(device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)?);
        }
        let sessions = cache.as_ref().expect("session manager").GetSessionEnumerator()?;
        for index in 0..sessions.GetCount()? {
            let control = sessions.GetSession(index)?;
            if control.GetState()? != AudioSessionStateActive { continue; }
            let details: IAudioSessionControl2 = control.cast()?;
            if details.IsSystemSoundsSession() == windows::Win32::Foundation::S_OK { continue; }
            let pid = details.GetProcessId().unwrap_or(0);
            if pid == 0 || own.contains(&pid) { continue; }
            let meter: IAudioMeterInformation = control.cast()?;
            if meter.GetPeakValue()? > 0.015 { return Ok(true); }
        }
        Ok(false)
    }
}
#[cfg(not(windows))]
fn others_playing(_cache: &mut Option<Sessions>, _own: &[u32]) -> Result<bool, ()> { Ok(false) }

#[cfg(test)]
mod tests {
    use super::descendants;
    #[test]
    fn the_family_follows_children_and_grandchildren_only() {
        let pairs = [(10, 1), (11, 10), (12, 11), (20, 2), (13, 10), (10, 10)];
        let mut family = descendants(10, &pairs);
        family.sort();
        assert_eq!(family, vec![10, 11, 12, 13]);
    }
}
