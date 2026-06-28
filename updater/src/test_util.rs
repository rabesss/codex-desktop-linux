//! Shared test helpers.
//!
//! Several tests across modules mutate process-wide env vars
//! (`HOME`, `PATH`, `NVM_DIR`, `CODEX_CLI_PATH`, display sockets, ...) so
//! they can drive `command_path_env`, `npm_program`, and
//! `hydrate_session_bus_env` deterministically. Cargo runs unit tests in
//! parallel; without serialisation those mutations race across threads
//! — on a developer machine with `nvm` installed the tests would otherwise
//! pick up the real `~/.nvm/.../bin/npm` instead of the temp-dir fake. Each
//! test that touches env vars must hold this lock for its entire body.

use std::ffi::OsString;
use std::sync::{Mutex, MutexGuard, OnceLock};

pub(crate) fn env_lock() -> MutexGuard<'static, ()> {
    static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|err| err.into_inner())
}

pub(crate) struct EnvRestoreGuard {
    values: Vec<(String, Option<OsString>)>,
}

impl EnvRestoreGuard {
    pub(crate) fn capture(keys: &[&str]) -> Self {
        Self {
            values: keys
                .iter()
                .map(|key| ((*key).to_string(), std::env::var_os(key)))
                .collect(),
        }
    }
}

impl Drop for EnvRestoreGuard {
    fn drop(&mut self) {
        for (key, value) in self.values.drain(..) {
            if let Some(value) = value {
                std::env::set_var(key, value);
            } else {
                std::env::remove_var(key);
            }
        }
    }
}
