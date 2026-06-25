use crate::windowing::backends::{cosmic, gnome, hyprland, i3, kwin, sway};
use crate::windowing::types::WindowInfo;
use anyhow::{anyhow, Result};
use std::env;

pub use cosmic::COSMIC_WAYLAND_BACKEND;
pub use gnome::{GNOME_SHELL_EXTENSION_BACKEND, GNOME_SHELL_INTROSPECT_BACKEND};
pub use hyprland::HYPRLAND_BACKEND;
pub use i3::I3_BACKEND;
pub use kwin::KWIN_BACKEND;
pub use sway::SWAY_BACKEND;

pub const WINDOW_PERMISSION_HINT: &str = "Computer Use could not access a supported window list backend. Targeted window input requires session-bus access plus GNOME Shell Introspect, the Codex GNOME Shell extension, KWin/Plasma DBus scripting, Sway IPC via swaymsg, Hyprland hyprctl, the COSMIC Wayland helper, or i3-msg. On GNOME, run setup_window_targeting to install the extension backend.";

#[derive(Debug, Clone, Copy)]
pub struct BackendDescriptor {
    pub id: &'static str,
    pub failure_label: &'static str,
    pub list_note: &'static str,
    pub missing_hint: &'static str,
    pub can_exact_focus: bool,
}

#[derive(Debug, Clone)]
pub struct BackendProbe {
    pub id: &'static str,
    pub ok: bool,
    pub can_list_windows: bool,
    pub can_focus_apps: bool,
    pub can_focus_windows: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BackendKind {
    GnomeExtension,
    GnomeIntrospect,
    Cosmic,
    Kwin,
    Sway,
    Hyprland,
    I3,
}

const BACKEND_ORDER: &[BackendKind] = &[
    BackendKind::GnomeExtension,
    BackendKind::GnomeIntrospect,
    BackendKind::Kwin,
    BackendKind::Sway,
    BackendKind::Hyprland,
    BackendKind::Cosmic,
    BackendKind::I3,
];

const DESCRIPTORS: &[BackendDescriptor] = &[
    BackendDescriptor {
        id: GNOME_SHELL_EXTENSION_BACKEND,
        failure_label: "Codex GNOME Shell extension",
        list_note: "Window list came from the Codex GNOME Shell extension. Terminal windows may include best-effort PTY and active-process context when the process tree is readable.",
        missing_hint: "On GNOME, run setup_window_targeting to install the optional GNOME Shell extension backend.",
        can_exact_focus: true,
    },
    BackendDescriptor {
        id: GNOME_SHELL_INTROSPECT_BACKEND,
        failure_label: "GNOME Shell Introspect",
        list_note: "Window list came from GNOME Shell Introspect. Terminal windows may include best-effort PTY and active-process context when the process tree is readable.",
        missing_hint: "On GNOME, ensure org.gnome.Shell.Introspect is available on the session bus.",
        can_exact_focus: false,
    },
    BackendDescriptor {
        id: KWIN_BACKEND,
        failure_label: "KWin",
        list_note: "Window list came from KWin/Plasma DBus scripting. Terminal windows may include best-effort PTY and active-process context when the process tree is readable.",
        missing_hint: "On KDE/Plasma, ensure KWin exposes org.kde.KWin scripting on the session bus.",
        can_exact_focus: true,
    },
    BackendDescriptor {
        id: SWAY_BACKEND,
        failure_label: "Sway",
        list_note: "Window list came from Sway IPC through swaymsg. Terminal windows may include best-effort PTY and active-process context when the process tree is readable.",
        missing_hint: "On Sway or Sway-compatible IPC sessions, ensure swaymsg can reach SWAYSOCK or a Sway IPC socket.",
        can_exact_focus: true,
    },
    BackendDescriptor {
        id: HYPRLAND_BACKEND,
        failure_label: "Hyprland",
        list_note: "Window list came from Hyprland hyprctl. Terminal windows may include best-effort PTY and active-process context when the process tree is readable.",
        missing_hint: "On Hyprland, ensure hyprctl is available in the session.",
        can_exact_focus: true,
    },
    BackendDescriptor {
        id: COSMIC_WAYLAND_BACKEND,
        failure_label: "COSMIC helper",
        list_note: "Window list came from the COSMIC Wayland helper. Terminal windows may include best-effort PTY and active-process context when the process tree is readable.",
        missing_hint: "On COSMIC, ensure the bundled COSMIC helper is present and can connect to the session.",
        can_exact_focus: true,
    },
    BackendDescriptor {
        id: I3_BACKEND,
        failure_label: "i3",
        list_note: "Window list came from i3-msg. Terminal windows may include best-effort PTY and active-process context when xprop and the process tree are readable.",
        missing_hint: "On i3, ensure i3-msg can reach the active i3 IPC socket.",
        can_exact_focus: true,
    },
];

pub fn descriptors() -> &'static [BackendDescriptor] {
    DESCRIPTORS
}

pub fn descriptor(id: &str) -> Option<&'static BackendDescriptor> {
    DESCRIPTORS.iter().find(|descriptor| descriptor.id == id)
}

pub fn list_note(id: &str) -> &'static str {
    descriptor(id)
        .map(|descriptor| descriptor.list_note)
        .unwrap_or_else(|| {
            descriptor(GNOME_SHELL_INTROSPECT_BACKEND)
                .unwrap()
                .list_note
        })
}

pub fn backend_can_exact_focus(id: &str) -> bool {
    descriptor(id).is_some_and(|descriptor| descriptor.can_exact_focus)
}

pub async fn list_windows() -> Result<Vec<WindowInfo>> {
    let mut errors = Vec::new();
    for backend in active_backend_order() {
        if let Some(windows) =
            usable_backend_windows(backend, list_windows_for(backend).await, &mut errors)
        {
            return Ok(windows);
        }
    }
    Err(anyhow!(errors.join("; ")))
}

fn usable_backend_windows(
    backend: BackendKind,
    result: Result<Vec<WindowInfo>>,
    errors: &mut Vec<String>,
) -> Option<Vec<WindowInfo>> {
    match result {
        Ok(windows) if !windows.is_empty() => Some(windows),
        Ok(_) => {
            errors.push(format!("{} returned no windows", backend.failure_label()));
            None
        }
        Err(error) => {
            errors.push(format!("{} failed: {error:#}", backend.failure_label()));
            None
        }
    }
}

async fn list_windows_for(backend: BackendKind) -> Result<Vec<WindowInfo>> {
    match backend {
        BackendKind::GnomeExtension => gnome::list_extension_windows().await,
        BackendKind::GnomeIntrospect => gnome::list_introspect_windows().await,
        BackendKind::Cosmic => cosmic::list_windows(),
        BackendKind::Kwin => kwin::list_windows().await,
        BackendKind::Sway => sway::list_windows(),
        BackendKind::Hyprland => hyprland::list_windows(),
        BackendKind::I3 => i3::list_windows(),
    }
}

pub async fn activate_window(window: &WindowInfo) -> Result<()> {
    match window.backend.as_str() {
        GNOME_SHELL_EXTENSION_BACKEND => gnome::activate_extension_window(window.window_id).await,
        GNOME_SHELL_INTROSPECT_BACKEND => {
            let app_id = window
                .app_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    anyhow!(
                        "GNOME Shell can only focus by app_id; the matched window has no app_id"
                    )
                })?;
            gnome::focus_app(app_id).await
        }
        COSMIC_WAYLAND_BACKEND => cosmic::activate_window(window.window_id),
        KWIN_BACKEND => kwin::activate_window(window.window_id).await,
        SWAY_BACKEND => sway::activate_window(window.window_id),
        HYPRLAND_BACKEND => hyprland::activate_window(window.window_id),
        I3_BACKEND => i3::activate_window(window.window_id),
        backend => Err(anyhow!(
            "Unsupported window backend for activation: {backend}"
        )),
    }
}

pub fn focused_window_override() -> Option<WindowInfo> {
    active_backend_order()
        .into_iter()
        .find_map(|backend| match backend {
            BackendKind::Cosmic => cosmic::focused_window().ok().flatten(),
            BackendKind::Hyprland => hyprland::focused_window().ok().flatten(),
            _ => None,
        })
}

pub fn probe_backends() -> Vec<BackendProbe> {
    let active = active_backend_order();
    BACKEND_ORDER
        .iter()
        .map(|backend| {
            if active.contains(backend) {
                probe_backend(*backend)
            } else {
                skipped_backend_probe(*backend)
            }
        })
        .collect()
}

fn probe_backend(backend: BackendKind) -> BackendProbe {
    match backend {
        BackendKind::GnomeExtension => gnome::probe_extension(),
        BackendKind::GnomeIntrospect => gnome::probe_introspect(),
        BackendKind::Cosmic => cosmic::probe(),
        BackendKind::Kwin => kwin::probe(),
        BackendKind::Sway => sway::probe(),
        BackendKind::Hyprland => hyprland::probe(),
        BackendKind::I3 => i3::probe(),
    }
}

fn skipped_backend_probe(backend: BackendKind) -> BackendProbe {
    BackendProbe {
        id: backend.id(),
        ok: false,
        can_list_windows: false,
        can_focus_apps: false,
        can_focus_windows: false,
        detail: format!(
            "skipped: current desktop session does not match {}",
            backend.failure_label()
        ),
    }
}

fn active_backend_order() -> Vec<BackendKind> {
    backend_order_for_session(&BackendSession::current())
}

fn backend_order_for_session(session: &BackendSession) -> Vec<BackendKind> {
    if session.probe_all {
        return BACKEND_ORDER.to_vec();
    }
    if let Some(forced) = &session.forced_backends {
        if !forced.is_empty() {
            return forced.clone();
        }
    }

    let mut backends = Vec::new();
    if session.is_gnome() {
        push_unique(&mut backends, BackendKind::GnomeExtension);
        push_unique(&mut backends, BackendKind::GnomeIntrospect);
    }
    if session.is_kwin() {
        push_unique(&mut backends, BackendKind::Kwin);
    }
    if session.is_sway() {
        push_unique(&mut backends, BackendKind::Sway);
    }
    if session.is_hyprland() {
        push_unique(&mut backends, BackendKind::Hyprland);
    }
    if session.is_cosmic() {
        push_unique(&mut backends, BackendKind::Cosmic);
    }
    if session.is_i3() {
        push_unique(&mut backends, BackendKind::I3);
    }

    if backends.is_empty() {
        BACKEND_ORDER.to_vec()
    } else {
        backends
    }
}

fn push_unique(backends: &mut Vec<BackendKind>, backend: BackendKind) {
    if !backends.contains(&backend) {
        backends.push(backend);
    }
}

#[derive(Debug, Clone, Default)]
struct BackendSession {
    desktop: String,
    session_type: Option<String>,
    has_display: bool,
    has_wayland_display: bool,
    has_hyprland_instance: bool,
    swaysock: Option<String>,
    i3sock: Option<String>,
    probe_all: bool,
    forced_backends: Option<Vec<BackendKind>>,
}

impl BackendSession {
    fn current() -> Self {
        let desktop = [
            "XDG_CURRENT_DESKTOP",
            "XDG_SESSION_DESKTOP",
            "DESKTOP_SESSION",
        ]
        .into_iter()
        .filter_map(env_var)
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

        Self {
            desktop,
            session_type: env_var("XDG_SESSION_TYPE").map(|value| value.to_ascii_lowercase()),
            has_display: env_var("DISPLAY").is_some(),
            has_wayland_display: env_var("WAYLAND_DISPLAY").is_some(),
            has_hyprland_instance: env_var("HYPRLAND_INSTANCE_SIGNATURE").is_some(),
            swaysock: env_var("SWAYSOCK"),
            i3sock: env_var("I3SOCK"),
            probe_all: env_flag("CODEX_COMPUTER_USE_PROBE_ALL_BACKENDS"),
            forced_backends: forced_backend_order(),
        }
    }

    fn desktop_contains(&self, needle: &str) -> bool {
        self.desktop.contains(needle)
    }

    fn is_gnome(&self) -> bool {
        self.desktop_contains("gnome")
    }

    fn is_kwin(&self) -> bool {
        self.desktop_contains("kde")
            || self.desktop_contains("plasma")
            || self.desktop_contains("kwin")
    }

    fn is_sway(&self) -> bool {
        self.desktop_contains("sway")
            || self.swaysock.is_some()
            || self
                .i3sock
                .as_deref()
                .is_some_and(path_looks_like_sway_socket)
    }

    fn is_hyprland(&self) -> bool {
        self.desktop_contains("hyprland") || self.has_hyprland_instance
    }

    fn is_cosmic(&self) -> bool {
        self.desktop_contains("cosmic")
    }

    fn is_i3(&self) -> bool {
        if self.desktop_contains("i3") {
            return true;
        }
        if self.is_known_non_i3_desktop() {
            return false;
        }
        if self.i3sock.is_some() && !self.is_sway() {
            return true;
        }

        self.session_type
            .as_deref()
            .is_some_and(|session_type| session_type == "x11")
            && self.has_display
            && !self.has_wayland_display
    }

    fn is_known_non_i3_desktop(&self) -> bool {
        self.is_gnome()
            || self.is_kwin()
            || self.is_sway()
            || self.is_hyprland()
            || self.is_cosmic()
    }
}

fn forced_backend_order() -> Option<Vec<BackendKind>> {
    let value = env_var("CODEX_COMPUTER_USE_WINDOW_BACKENDS")?;
    let backends = value
        .split(',')
        .filter_map(|item| BackendKind::from_id(item.trim()))
        .collect::<Vec<_>>();
    Some(backends)
}

fn env_flag(name: &str) -> bool {
    env_var(name).is_some_and(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
}

fn env_var(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn path_looks_like_sway_socket(path: &str) -> bool {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("sway-ipc.") && name.ends_with(".sock"))
}

impl BackendKind {
    fn from_id(id: &str) -> Option<Self> {
        let id = id.trim().to_ascii_lowercase();
        match id.as_str() {
            "gnome" | "gnome-shell" | "gnome-shell-extension" => Some(Self::GnomeExtension),
            "gnome-shell-introspect" | "gnome-introspect" => Some(Self::GnomeIntrospect),
            "cosmic" | "cosmic-wayland" => Some(Self::Cosmic),
            "kde" | "plasma" | "kwin" => Some(Self::Kwin),
            "sway" | "sway-ipc" => Some(Self::Sway),
            "hyprland" => Some(Self::Hyprland),
            "i3" => Some(Self::I3),
            _ => None,
        }
    }

    fn id(self) -> &'static str {
        match self {
            BackendKind::GnomeExtension => GNOME_SHELL_EXTENSION_BACKEND,
            BackendKind::GnomeIntrospect => GNOME_SHELL_INTROSPECT_BACKEND,
            BackendKind::Cosmic => COSMIC_WAYLAND_BACKEND,
            BackendKind::Kwin => KWIN_BACKEND,
            BackendKind::Sway => SWAY_BACKEND,
            BackendKind::Hyprland => HYPRLAND_BACKEND,
            BackendKind::I3 => I3_BACKEND,
        }
    }

    fn failure_label(self) -> &'static str {
        descriptor(self.id())
            .map(|item| item.failure_label)
            .unwrap_or(self.id())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windowing::types::WindowBounds;

    fn window(backend: &str) -> WindowInfo {
        WindowInfo {
            window_id: 1,
            backend_window_id: None,
            title: Some("Codex".to_string()),
            app_id: Some("codex-desktop".to_string()),
            wm_class: Some("codex-desktop".to_string()),
            pid: Some(1234),
            bounds: Some(WindowBounds {
                x: Some(0),
                y: Some(0),
                width: 800,
                height: 600,
            }),
            workspace: None,
            focused: true,
            hidden: false,
            client_type: Some("wayland".to_string()),
            backend: backend.to_string(),
            terminal: None,
        }
    }

    fn ids(backends: Vec<BackendKind>) -> Vec<&'static str> {
        backends.into_iter().map(BackendKind::id).collect()
    }

    fn session(desktop: &str) -> BackendSession {
        BackendSession {
            desktop: desktop.to_ascii_lowercase(),
            ..Default::default()
        }
    }

    #[test]
    fn session_backend_order_prefers_hyprland_only_on_hyprland() {
        let mut session = session("Hyprland");
        session.has_wayland_display = true;

        assert_eq!(
            ids(backend_order_for_session(&session)),
            vec![HYPRLAND_BACKEND]
        );
    }

    #[test]
    fn session_backend_order_prefers_gnome_pair_on_gnome() {
        let session = session("GNOME");

        assert_eq!(
            ids(backend_order_for_session(&session)),
            vec![
                GNOME_SHELL_EXTENSION_BACKEND,
                GNOME_SHELL_INTROSPECT_BACKEND
            ]
        );
    }

    #[test]
    fn session_backend_order_prefers_kwin_on_plasma() {
        let session = session("KDE Plasma");

        assert_eq!(ids(backend_order_for_session(&session)), vec![KWIN_BACKEND]);
    }

    #[test]
    fn session_backend_order_prefers_sway_for_sway_socket() {
        let mut session = session("");
        session.swaysock = Some("/run/user/1000/sway-ipc.1000.42.sock".to_string());

        assert_eq!(ids(backend_order_for_session(&session)), vec![SWAY_BACKEND]);
    }

    #[test]
    fn session_backend_order_treats_i3sock_as_sway_only_for_sway_socket_names() {
        let mut sway_session = session("");
        sway_session.i3sock = Some("/run/user/1000/sway-ipc.1000.42.sock".to_string());
        let mut i3_session = session("");
        i3_session.i3sock = Some("/run/user/1000/i3/ipc-socket.42".to_string());

        assert_eq!(
            ids(backend_order_for_session(&sway_session)),
            vec![SWAY_BACKEND]
        );
        assert_eq!(
            ids(backend_order_for_session(&i3_session)),
            vec![I3_BACKEND]
        );
    }

    #[test]
    fn session_backend_order_ignores_stale_i3sock_on_known_non_i3_desktops() {
        let mut session = session("KDE Plasma");
        session.i3sock = Some("/run/user/1000/i3/ipc-socket.42".to_string());

        assert_eq!(ids(backend_order_for_session(&session)), vec![KWIN_BACKEND]);
    }

    #[test]
    fn session_backend_order_prefers_i3_for_unknown_x11_session() {
        let mut session = session("");
        session.session_type = Some("x11".to_string());
        session.has_display = true;

        assert_eq!(ids(backend_order_for_session(&session)), vec![I3_BACKEND]);
    }

    #[test]
    fn session_backend_order_falls_back_to_all_backends_when_unknown() {
        let session = session("niri");

        assert_eq!(
            ids(backend_order_for_session(&session)),
            BACKEND_ORDER
                .iter()
                .map(|backend| backend.id())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn session_backend_order_honors_forced_backend_list() {
        let mut session = session("Hyprland");
        session.forced_backends = Some(vec![BackendKind::Kwin, BackendKind::Sway]);

        assert_eq!(
            ids(backend_order_for_session(&session)),
            vec![KWIN_BACKEND, SWAY_BACKEND]
        );
    }

    #[test]
    fn skipped_backend_probe_is_non_capable_and_actionable() {
        let probe = skipped_backend_probe(BackendKind::Kwin);

        assert_eq!(probe.id, KWIN_BACKEND);
        assert!(!probe.ok);
        assert!(!probe.can_list_windows);
        assert!(probe.detail.contains("skipped"));
        assert!(probe.detail.contains("KWin"));
    }

    #[test]
    fn skips_empty_backend_results_so_later_backends_can_answer() {
        let mut errors = Vec::new();

        assert!(
            usable_backend_windows(BackendKind::GnomeIntrospect, Ok(Vec::new()), &mut errors,)
                .is_none()
        );

        let windows = usable_backend_windows(
            BackendKind::Kwin,
            Ok(vec![window(KWIN_BACKEND)]),
            &mut errors,
        )
        .expect("non-empty backend result should be accepted");

        assert_eq!(windows[0].backend, KWIN_BACKEND);
        assert_eq!(errors, vec!["GNOME Shell Introspect returned no windows"]);
    }

    #[test]
    fn records_backend_failures_with_registry_labels() {
        let mut errors = Vec::new();

        assert!(usable_backend_windows(
            BackendKind::Kwin,
            Err(anyhow!("loadScript failed")),
            &mut errors,
        )
        .is_none());

        assert_eq!(errors, vec!["KWin failed: loadScript failed"]);
    }
}
