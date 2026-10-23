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

const SIGNED_IN_PAGE: &str = "<!doctype html><meta charset=utf-8><title>ChillCall</title><body style=\"font-family:system-ui,sans-serif;text-align:center;margin-top:20vh\"><h1>You are signed in</h1><p>You can close this tab and go back to ChillCall.</p></body>";

/// The path and query of a request line such as `GET /callback?code=1 HTTP/1.1`.
fn request_target(head: &str) -> Option<String> {
    let mut parts = head.lines().next()?.split_whitespace();
    (parts.next()? == "GET").then(|| parts.next().map(str::to_string)).flatten()
}

/// Whether a request is the provider sending the person back: our callback path carrying a code or an error.
fn is_sign_in_return(target: &str) -> bool {
    target.starts_with("/callback?") && (target.contains("code=") || target.contains("error="))
}

fn reply(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write;
    let _ = write!(
        stream,
        "HTTP/1.1 {status}
Content-Type: text/html; charset=utf-8
Content-Length: {}
Connection: close

{body}",
        body.len()
    );
}

/// Signing in happens in the person's own browser, which cannot reach this window. So the provider sends it back to a
/// short-lived address on this machine only (`http://127.0.0.1:<port>/callback`), which this listens on once and
/// reports to the page as an `oauth-callback` event carrying the path and query. Returns the port.
#[tauri::command]
fn oauth_listen(app: tauri::AppHandle) -> Result<u16, String> {
    use std::io::{ErrorKind, Read};
    use std::time::{Duration, Instant};
    use tauri::Emitter;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(300);
        let result = loop {
            if Instant::now() > deadline {
                break "/callback?error=timeout&error_description=Signing+in+took+too+long.".to_string();
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut buffer = [0u8; 8192];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    match request_target(&String::from_utf8_lossy(&buffer[..read])) {
                        Some(target) if is_sign_in_return(&target) => {
                            reply(&mut stream, "200 OK", SIGNED_IN_PAGE);
                            break target;
                        }
                        // A browser also asks for the site's icon and the like; those are not the answer.
                        _ => reply(&mut stream, "404 Not Found", ""),
                    }
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break "/callback?error=failed&error_description=Could+not+listen+for+the+sign-in.".to_string(),
            }
        };
        let _ = app.emit("oauth-callback", result);
    });
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_target_of_a_get_request() {
        assert_eq!(request_target("GET /callback?code=1&state=2 HTTP/1.1
Host: x

").as_deref(), Some("/callback?code=1&state=2"));
        assert_eq!(request_target("POST /callback?code=1 HTTP/1.1

"), None);
        assert_eq!(request_target(""), None);
        assert_eq!(request_target("GET"), None);
    }

    #[test]
    fn only_the_providers_return_counts() {
        assert!(is_sign_in_return("/callback?code=abc&state=s"));
        assert!(is_sign_in_return("/callback?error=access_denied&state=s"));
        assert!(!is_sign_in_return("/callback"));
        assert!(!is_sign_in_return("/favicon.ico"));
        assert!(!is_sign_in_return("/other?code=abc"));
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_window_border, oauth_listen])
        .run(tauri::generate_context!())
        .expect("error while running ChillCall");
}
