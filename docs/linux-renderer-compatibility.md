# Linux rendering compatibility

The Debian 13 GNOME/Wayland reporter confirmed that launching with
`WEBKIT_DISABLE_DMABUF_RENDERER=1` stops the frozen web interface. That is
separate from the native titlebar fix shipped by Tao in Deviload 2.7.7.

`src-tauri/src/linux_compat.rs` now applies that renderer workaround during
ordinary startup, before the Tauri builder creates GTK/WebKit objects. It is
restricted to Debian 13, the GNOME desktop, and a Wayland session or explicitly
selected Wayland backend. A `.deb` installation no longer depends on `APPDIR`
to get this compatibility setting. No desktop launcher command needs editing.

The policy leaves other distributions, desktops, and X11 launches alone.
Existing explicit `WEBKIT_DISABLE_DMABUF_RENDERER` or
`WEBKIT_FORCE_DMABUF_RENDERER` values take precedence, including `0` and empty
values. It never changes `GDK_BACKEND`. The existing AppImage-specific renderer
default and GIO isolation remain separate and unchanged.

This trades the faster DMABUF rendering path for compatibility on the affected
configuration. It is deliberately not a universal Linux fix: upstream reports
also describe regressions when this setting is forced for other desktop/window
configurations.

## Evidence and limits

- [Tauri: Linux graphics issues](https://v2.tauri.app/develop/debug/linux-graphics/)
  documents the flag and setting it before the webview is created.
- [GTK: environment variables](https://docs.gtk.org/gtk3/running.html#environment-variables)
  documents `GDK_BACKEND` and its ordered backend list.
- [Cap issue 2624](https://github.com/CapSoftware/Cap/issues/2624)
  reports a different regression with a forced setting on WebKitGTK 2.54,
  Debian 13 KDE/Wayland and transparent windows. This is a reason not to widen
  the new default to every Linux desktop.
- [Tao native titlebar fix](https://github.com/tauri-apps/tao/pull/1218)
  addresses decorations after creating a hidden window. It does not establish
  that the web renderer freeze is fixed.

Pure Rust policy tests cover the affected default launch, explicit overrides,
backend ordering, X11, other desktops and distributions, and missing session
information. They do **not** exercise WebKitGTK or a Wayland compositor.

Before calling the reporter's problem resolved, test the new Linux build on
the affected Debian 13 GNOME/Wayland machine:

1. Fully exit Deviload, including its tray process, and remove any older manual
   renderer/backend overrides from the test launch. Keep the GNOME Wayland
   session.
2. Open Deviload normally from the application menu. Confirm the app version,
   change sections, scroll and interact for several minutes. No special
   terminal command should be needed.
3. Immediately after startup, test minimize, maximize, restore and close.
   Reopen from the tray and repeat; test resizing too.
4. Separately regress the existing Ubuntu/LXQt X11 installation and AppImage
   startup. Headless Xvfb startup checks alone cannot validate Wayland.

The affected-machine runtime check is still outstanding. The reporter's GPU
and installed WebKitGTK version are not yet known; do not claim that unit tests
prove the hang, button behavior, or resize smoothness resolved on that machine.
