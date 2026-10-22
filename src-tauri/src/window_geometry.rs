// Geometry only: native application is kept in the Linux setup path. Values from
// the monitor are physical pixels; client sizes and decorations are logical.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LogicalSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowFit {
    pub size: LogicalSize,
    pub minimum_size: LogicalSize,
    pub position: (i32, i32),
}

// Keep a little room around an unmaximized window, including the native title
// bar. A small screen must be allowed below the usual minimum size; otherwise
// GTK can reject maximize or keep part of the window outside the work area.
pub fn fit_initial_window(
    area: WorkArea,
    preferred: LogicalSize,
    minimum: LogicalSize,
    frame: LogicalSize,
) -> Option<WindowFit> {
    let positive = |n: f64| n.is_finite() && n > 0.0;
    let nonnegative = |n: f64| n.is_finite() && n >= 0.0;
    if area.width == 0 || area.height == 0 || !positive(area.scale_factor)
        || !positive(preferred.width) || !positive(preferred.height)
        || !positive(minimum.width) || !positive(minimum.height)
        || !nonnegative(frame.width) || !nonnegative(frame.height) {
        return None;
    }
    let scale = area.scale_factor;
    let screen = LogicalSize { width: area.width as f64 / scale, height: area.height as f64 / scale };
    if !positive(screen.width) || !positive(screen.height) { return None; }
    // On exceptionally small displays, give the client at least one pixel and
    // spend less space on margins. Native decoration extents cannot be changed.
    let available = |screen: f64, decoration: f64| {
        let room = (screen - decoration).max(1.0);
        (room - 24.0_f64.min((room - 1.0).max(0.0))).max(1.0)
    };
    let bounds = LogicalSize { width: available(screen.width, frame.width), height: available(screen.height, frame.height) };
    let minimum_size = LogicalSize { width: minimum.width.min(bounds.width), height: minimum.height.min(bounds.height) };
    let size = LogicalSize {
        width: preferred.width.max(minimum_size.width).min(bounds.width),
        height: preferred.height.max(minimum_size.height).min(bounds.height),
    };
    let coordinate = |origin: i32, screen: u32, client: f64, decoration: f64| {
        // set_position addresses the outer window. Never accidentally center
        // an oversized decoration at a negative offset from this monitor.
        let outer = ((client + decoration) * scale).min(screen as f64);
        let offset = ((screen as f64 - outer) / 2.0).round();
        (origin as f64 + offset).clamp(i32::MIN as f64, i32::MAX as f64) as i32
    };
    Some(WindowFit { size, minimum_size, position: (
        coordinate(area.x, area.width, size.width, frame.width),
        coordinate(area.y, area.height, size.height, frame.height),
    ) })
}

#[cfg(test)]
mod tests {
    use super::*;
    const PREFERRED: LogicalSize = LogicalSize { width: 1120.0, height: 780.0 };
    const MINIMUM: LogicalSize = LogicalSize { width: 760.0, height: 620.0 };
    const FRAME: LogicalSize = LogicalSize { width: 0.0, height: 40.0 };
    fn area(width: u32, height: u32, scale_factor: f64) -> WorkArea {
        WorkArea { x: 0, y: 0, width, height, scale_factor }
    }
    fn fit(area: WorkArea) -> WindowFit { fit_initial_window(area, PREFERRED, MINIMUM, FRAME).unwrap() }
    fn assert_inside(area: WorkArea, fitted: WindowFit) {
        let scale = area.scale_factor;
        assert!(fitted.minimum_size.width <= fitted.size.width);
        assert!(fitted.minimum_size.height <= fitted.size.height);
        assert!(fitted.position.0 >= area.x && fitted.position.1 >= area.y);
        assert!(fitted.position.0 as f64 + (fitted.size.width + FRAME.width) * scale <= area.x as f64 + area.width as f64 + 1.0);
        assert!(fitted.position.1 as f64 + (fitted.size.height + FRAME.height) * scale <= area.y as f64 + area.height as f64 + 1.0);
    }

    #[test]
    fn preserves_the_normal_window_on_a_large_work_area() {
        let area = area(1920, 1040, 1.0);
        let fitted = fit(area);
        assert_eq!(fitted.size, PREFERRED);
        assert_eq!(fitted.minimum_size, MINIMUM);
        assert_eq!(fitted.position, (400, 110));
        assert_inside(area, fitted);
    }

    #[test]
    fn fits_a_768_high_screen_and_includes_the_native_titlebar() {
        let area = area(1366, 728, 1.0);
        let fitted = fit(area);
        assert_eq!(fitted.size, LogicalSize { width: 1120.0, height: 664.0 });
        assert_eq!(fitted.position, (123, 12));
        assert_inside(area, fitted);
    }

    #[test]
    fn scales_physical_work_area_before_comparing_client_and_minimum_sizes() {
        for scale in [1.0, 1.25, 1.5, 2.0, 3.0] {
            let area = area(1366, 728, scale);
            assert_inside(area, fit(area));
        }
        let fitted = fit(area(1366, 728, 2.0));
        assert_eq!(fitted.minimum_size, LogicalSize { width: 659.0, height: 300.0 });
        assert_eq!(fitted.size, fitted.minimum_size);
    }

    #[test]
    fn uses_the_selected_monitors_origin_including_negative_coordinates() {
        let left = WorkArea { x: -1920, y: -200, ..area(1920, 1040, 1.0) };
        let fitted = fit(left);
        assert_eq!(fitted.position, (-1520, -90));
        assert_inside(left, fitted);
        let right = WorkArea { x: 1920, y: 80, ..area(1366, 728, 1.25) };
        assert_inside(right, fit(right));
    }

    #[test]
    fn accepts_measured_frame_and_larger_minimum_without_oversizing_the_screen() {
        let fitted = fit_initial_window(area(1920, 1040, 1.0),
            LogicalSize { width: 500.0, height: 400.0 }, MINIMUM,
            LogicalSize { width: 16.0, height: 48.0 }).unwrap();
        assert_eq!(fitted.size, MINIMUM);
        assert_eq!(fitted.position, (572, 186));
    }

    #[test]
    fn ignores_unavailable_or_invalid_monitor_geometry_without_panicking() {
        for area in [area(0, 100, 1.0), area(100, 0, 1.0), area(100, 100, 0.0),
            area(100, 100, -1.0), area(100, 100, f64::NAN), area(100, 100, f64::INFINITY)] {
            assert!(fit_initial_window(area, PREFERRED, MINIMUM, FRAME).is_none());
        }
        assert!(fit_initial_window(area(100, 100, 1.0), PREFERRED, MINIMUM,
            LogicalSize { width: -1.0, height: 40.0 }).is_none());
    }
}
