use serde::Deserialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub active: bool,
    pub playing: bool,
    pub previous_enabled: bool,
    pub play_enabled: bool,
    pub next_enabled: bool,
    pub previous_label: String,
    pub play_label: String,
    pub next_label: String,
}

#[derive(Default)]
pub struct MusicControls(pub Mutex<Playback>);

impl Playback {
    fn allows(&self, action: &str) -> bool {
        self.active && match action { "previous" => self.previous_enabled, "play" => self.play_enabled, "next" => self.next_enabled, _ => false }
    }
}

pub fn dispatch(app: &tauri::AppHandle, action: &str) {
    let playback = app.state::<MusicControls>().0.lock().unwrap().clone();
    if playback.allows(action) { let _ = app.emit_to("main", "music-control", action); }
}

#[tauri::command]
pub fn set_music_controls(window: tauri::WebviewWindow, mut playback: Playback) -> Result<(), String> {
    if window.label() != "main" { return Ok(()); }
    for label in [&mut playback.previous_label, &mut playback.play_label, &mut playback.next_label] {
        *label = label.chars().filter(|c| !c.is_control()).take(60).collect();
    }
    let app = window.app_handle();
    *app.state::<MusicControls>().0.lock().unwrap() = playback.clone();
    let items = app.state::<crate::TrayItems>();
    for (item, label, enabled) in [(&items.previous, &playback.previous_label, playback.previous_enabled),
        (&items.play, &playback.play_label, playback.play_enabled), (&items.next, &playback.next_label, playback.next_enabled)] {
        item.set_text(label).map_err(|e| e.to_string())?;
        item.set_enabled(playback.active && enabled).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        taskbar::refresh(&window);
        if let Some(mini)=app.get_webview_window("music-mini") { taskbar::refresh(&mini); }
    }
    Ok(())
}

#[cfg(windows)]
pub mod taskbar {
    use super::*;
    use std::cell::Cell;
    use windows::{core::w, Win32::{Foundation::{HWND, LPARAM, LRESULT, WPARAM}, System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
        UI::{Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass, ITaskbarList3, TaskbarList, THUMBBUTTON, THB_FLAGS, THB_ICON, THB_TOOLTIP, THBF_DISABLED, THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED},
        WindowsAndMessaging::{CreateIcon, DestroyIcon, HICON, PostMessageW, RegisterWindowMessageW, WM_APP, WM_COMMAND, WM_NCDESTROY}}}};

    const SUBCLASS: usize = 0x444d;
    const SYNC: u32 = WM_APP + 0x444;
    const FIRST: u32 = 0x7400;
    struct Toolbar { app: tauri::AppHandle, taskbar: ITaskbarList3, icons: [HICON; 4], created: u32, installed: Cell<bool> }
    impl Drop for Toolbar { fn drop(&mut self) { for icon in self.icons { unsafe { let _ = DestroyIcon(icon); } } } }

    // The shell owns copies of these small, alpha-masked transport glyphs.
    fn icon(kind: usize) -> windows::core::Result<HICON> {
        let mut mask = [255u8; 32];
        let mut pixels = [0u8; 16 * 16 * 4];
        for y in 0..16usize { for x in 0..16usize {
            let dx = if kind == 0 { 15 - x } else { x };
            let on = if kind == 2 { (4..12).contains(&y) && ((4..7).contains(&x) || (9..12).contains(&x)) }
                else { (4..12).contains(&y) && ((5..12).contains(&dx) && dx <= 12 - y.abs_diff(8) * 2 || kind != 1 && (12..14).contains(&dx)) };
            if on { mask[y * 2 + x / 8] &= !(128 >> (x % 8));pixels[(y * 16 + x) * 4..(y * 16 + x + 1) * 4].copy_from_slice(&[235, 235, 235, 255]); }
        }}
        unsafe { CreateIcon(None, 16, 16, 1, 32, mask.as_ptr(), pixels.as_ptr()) }
    }

    impl Toolbar {
        unsafe fn render(&self, hwnd: HWND) {
            let state = self.app.state::<MusicControls>().0.lock().unwrap().clone();
            let definitions = [(&state.previous_label, state.previous_enabled, self.icons[0]),
                (&state.play_label, state.play_enabled, self.icons[if state.playing { 2 } else { 1 }]),
                (&state.next_label, state.next_enabled, self.icons[3])];
            let buttons: Vec<_> = definitions.into_iter().enumerate().map(|(index, (label, enabled, icon))| {
                let mut button = THUMBBUTTON { dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS, iId: FIRST + index as u32, hIcon: icon,
                    dwFlags: if !state.active { THBF_HIDDEN } else if enabled { THBF_ENABLED } else { THBF_DISABLED }, ..Default::default() };
                for (slot, value) in button.szTip.iter_mut().take(259).zip(label.encode_utf16()) { *slot = value; }
                button
            }).collect();
            if self.installed.get() { let _ = self.taskbar.ThumbBarUpdateButtons(hwnd, &buttons); }
            else if self.taskbar.ThumbBarAddButtons(hwnd, &buttons).is_ok() { self.installed.set(true); }
        }
    }

    fn click_action(wparam: usize) -> Option<&'static str> {
        if (wparam >> 16) as u32 != THBN_CLICKED { return None; }
        match (wparam & 0xffff) as u32 { FIRST => Some("previous"), id if id == FIRST + 1 => Some("play"), id if id == FIRST + 2 => Some("next"), _ => None }
    }

    unsafe extern "system" fn procedure(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _: usize, data: usize) -> LRESULT {
        if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(procedure), SUBCLASS);
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            drop(Box::from_raw(data as *mut Toolbar));
            return result;
        }
        let toolbar = &*(data as *const Toolbar);
        if message == toolbar.created { toolbar.installed.set(false); toolbar.render(hwnd); }
        else if message == SYNC { toolbar.render(hwnd); }
        else if message == WM_COMMAND {
            if let Some(action) = click_action(wparam.0) { dispatch(&toolbar.app, action); return LRESULT(0); }
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    pub fn install(window: &tauri::WebviewWindow) {
        let window = window.clone();
        let handle = window.clone();
        let _ = handle.run_on_main_thread(move || unsafe {
            let Ok(hwnd) = window.hwnd() else { return; };
            let hwnd = HWND(hwnd.0);
            let Ok(taskbar): windows::core::Result<ITaskbarList3> = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) else { return; };
            if taskbar.HrInit().is_err() { return; }
            let mut icons = Vec::new();
            for kind in 0..4 { match icon(kind) { Ok(icon) => icons.push(icon), Err(_) => { for icon in icons { let _ = DestroyIcon(icon); } return; } } }
            let toolbar = Box::new(Toolbar { app: window.app_handle().clone(), taskbar, icons: icons.try_into().unwrap(), created: RegisterWindowMessageW(w!("TaskbarButtonCreated")), installed: Cell::new(false) });
            let pointer = Box::into_raw(toolbar);
            if !SetWindowSubclass(hwnd, Some(procedure), SUBCLASS, pointer as usize).as_bool() { drop(Box::from_raw(pointer));return; }
            let _ = PostMessageW(Some(hwnd), SYNC, WPARAM(0), LPARAM(0));
        });
    }

    pub fn refresh(window: &tauri::WebviewWindow) {
        if let Ok(hwnd) = window.hwnd() { unsafe { let _ = PostMessageW(Some(HWND(hwnd.0)), SYNC, WPARAM(0), LPARAM(0)); } }
    }

    #[test]
    fn music_thumbnail_commands_ignore_other_window_commands() {
        let click = (THBN_CLICKED as usize) << 16;
        assert_eq!(click_action(click | FIRST as usize), Some("previous"));
        assert_eq!(click_action(click | (FIRST + 1) as usize), Some("play"));
        assert_eq!(click_action(click | (FIRST + 2) as usize), Some("next"));
        assert_eq!(click_action(FIRST as usize), None);
        assert_eq!(click_action(click | (FIRST + 3) as usize), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn music_controls_reject_actions_without_a_track_or_disabled_transport() {
        let mut playback = Playback { play_enabled: true, next_enabled: true, ..Default::default() };
        assert!(!playback.allows("play"));
        playback.active = true;
        assert!(playback.allows("play"));
        assert!(playback.allows("next"));
        assert!(!playback.allows("previous"));
        assert!(!playback.allows("quit"));
        playback.next_enabled = false;
        assert!(!playback.allows("next"));
    }
}
