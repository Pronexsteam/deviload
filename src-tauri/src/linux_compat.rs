//! Narrow startup workaround for the reported Debian 13 GNOME/Wayland hang.
//!
//! The reporter confirmed that disabling WebKitGTK's DMABUF path stops the
//! freeze. Keep that choice out of AppImage's GIO isolation: a system-installed
//! .deb also needs it, before GTK/WebKit or their threads are initialized.
//! Do not force a different window-system backend or overwrite user choices.

fn release_value<'a>(release: &'a str, key: &str) -> Option<&'a str> {
    release.lines().find_map(|line| {
        let (name, value) = line.trim().split_once('=')?;
        if name != key { return None; }
        // Only compare literal distribution fields; never execute os-release.
        Some(value.trim().trim_matches(['\'', '"']))
    })
}

fn needs_renderer_workaround(release: &str, get: impl Fn(&str) -> Option<String>) -> bool {
    // Presence, not truthiness: an explicit "0" (or empty value) must survive.
    if get("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
        || get("WEBKIT_FORCE_DMABUF_RENDERER").is_some()
    {
        return false;
    }
    if release_value(release, "ID") != Some("debian")
        || release_value(release, "VERSION_ID").and_then(|v| v.split('.').next()) != Some("13")
    {
        return false;
    }
    let gnome = get("XDG_CURRENT_DESKTOP").is_some_and(|desktop| {
        desktop.split(':').any(|component| component.eq_ignore_ascii_case("gnome"))
    });
    if !gnome { return false; }
    // GDK_BACKEND wins over session variables (e.g. XWayland in a Wayland
    // session). With an ordered backend list, only select the leading Wayland
    // backend; don't interfere with an explicit X11-first launch.
    match get("GDK_BACKEND").filter(|backend| !backend.trim().is_empty()) {
        Some(backend) => backend.split(',').next().is_some_and(|first| first.trim() == "wayland"),
        None => get("XDG_SESSION_TYPE").is_some_and(|session| session.eq_ignore_ascii_case("wayland")),
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn configure_renderer() {
    let release = std::fs::read_to_string("/etc/os-release")
        .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        .unwrap_or_default();
    if needs_renderer_workaround(&release, |key| {
        std::env::var_os(key).map(|value| value.to_string_lossy().into_owned())
    }) {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        eprintln!("Deviload: enabled WebKitGTK renderer compatibility for Debian 13 GNOME/Wayland.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEBIAN_13: &str = "ID=debian\nVERSION_ID=\"13\"\n";

    fn check(release: &str, overrides: &[(&str, &str)]) -> bool {
        needs_renderer_workaround(release, |key| {
            overrides.iter().find(|(name, _)| *name == key).map(|(_, value)| value.to_string())
                .or_else(|| match key {
                    "XDG_CURRENT_DESKTOP" => Some("GNOME".into()),
                    "XDG_SESSION_TYPE" => Some("wayland".into()),
                    _ => None,
                })
        })
    }

    #[test]
    fn ordinary_debian_gnome_wayland_launch_gets_compatibility() {
        // No APPDIR or terminal flag is required for the system .deb.
        assert!(check(DEBIAN_13, &[]));
        assert!(check("ID='debian'\nVERSION_ID=13.1", &[("XDG_CURRENT_DESKTOP", "GNOME:GNOME-Classic")]));
    }

    #[test]
    fn explicit_webkit_renderer_choices_always_win() {
        for key in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_FORCE_DMABUF_RENDERER"] {
            for value in ["0", "1", ""] {
                assert!(!check(DEBIAN_13, &[(key, value)]), "{key}={value}");
            }
        }
    }

    #[test]
    fn x11_and_other_desktops_keep_their_renderer() {
        for overrides in [
            vec![("XDG_SESSION_TYPE", "x11")],
            vec![("GDK_BACKEND", "x11")],
            vec![("GDK_BACKEND", "x11,wayland")],
            vec![("XDG_CURRENT_DESKTOP", "KDE")],
            vec![("XDG_CURRENT_DESKTOP", "LXQt")],
            vec![("XDG_CURRENT_DESKTOP", "NOTGNOME")],
            vec![("XDG_CURRENT_DESKTOP", "")],
        ] {
            assert!(!check(DEBIAN_13, &overrides), "{overrides:?}");
        }
        assert!(check(DEBIAN_13, &[("GDK_BACKEND", "wayland,x11")]));
        assert!(check(DEBIAN_13, &[("GDK_BACKEND", "wayland"), ("XDG_SESSION_TYPE", "x11")]));
    }

    #[test]
    fn other_or_unknown_distributions_do_not_inherit_this_workaround() {
        for release in [
            "", "ID=debian", "ID=debian\nVERSION_ID=12", "ID=debian\nVERSION_ID=14",
            "ID=ubuntu\nID_LIKE=debian\nVERSION_ID=26.04", "ID=kali\nID_LIKE=debian\nVERSION_ID=13",
        ] {
            assert!(!check(release, &[]), "{release}");
        }
        assert!(!needs_renderer_workaround(DEBIAN_13, |_| None));
    }
}
