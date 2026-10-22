/// Windows 11 draws a one-pixel border around undecorated windows, even without a shadow, which shows as an
/// outline around the floating bubbles. DWM lets a window set that border's color to "none", or back to the default.
#[cfg(windows)]
fn set_border_color(window: &tauri::WebviewWindow, color: u32) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &color as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        )
    }
    .map_err(|e| e.to_string())
}

/// Shows or hides the window's border. Windows 10 has no such border (and rejects the setting), so errors here
/// are harmless; other platforms have nothing to do.
#[tauri::command]
fn set_window_border(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
        const DWMWA_COLOR_DEFAULT: u32 = 0xFFFF_FFFF;
        set_border_color(&window, if visible { DWMWA_COLOR_DEFAULT } else { DWMWA_COLOR_NONE })
    }
    #[cfg(not(windows))]
    {
        let _ = (window, visible);
        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_window_border])
        .run(tauri::generate_context!())
        .expect("error while running ChillCall");
}
