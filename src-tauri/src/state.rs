use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use crate::exiftool_daemon::SharedExifToolDaemon;

pub struct AppState {
    pub cancellation_tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
    // Store child process IDs if we need to kill them (for czkawka)
    // On Unix, Command::spawn() returns a generic Child, but tauri's Command is different.
    // If we use std::process::Command, we get a Child which has an ID.
    pub running_processes: Mutex<HashMap<String, u32>>,
    // Shared ExifTool daemon for efficient batch metadata operations
    pub exiftool_daemon: SharedExifToolDaemon,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            cancellation_tokens: Mutex::new(HashMap::new()),
            running_processes: Mutex::new(HashMap::new()),
            exiftool_daemon: SharedExifToolDaemon::new(),
        }
    }

    pub fn register_token(&self, id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        self.cancellation_tokens
            .lock()
            .unwrap()
            .insert(id.to_string(), token.clone());
        token
    }

    pub fn remove_token(&self, id: &str) {
        self.cancellation_tokens.lock().unwrap().remove(id);
    }

    pub fn cancel(&self, id: &str) {
        if let Some(token) = self.cancellation_tokens.lock().unwrap().get(id) {
            token.store(true, Ordering::Relaxed);
        }

        // Also check if there's a process to kill
        // Killing processes is platform specific, but we can try generic approaches or crates like `nix` or `sysinfo` if needed.
        // For now, let's assume we can use `kill` command if we have the PID.
        let pid = { self.running_processes.lock().unwrap().remove(id) };

        if let Some(pid) = pid {
            #[cfg(unix)]
            {
                use std::process::Command;
                let _ = Command::new("kill").arg(pid.to_string()).output();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_new() {
        let state = AppState::new();
        assert!(state.cancellation_tokens.lock().unwrap().is_empty());
        assert!(state.running_processes.lock().unwrap().is_empty());
    }

    #[test]
    fn test_register_and_cancel_token() {
        let state = AppState::new();
        let id = "test-op";
        let token = state.register_token(id);
        
        assert_eq!(token.load(Ordering::Relaxed), false);
        assert!(state.cancellation_tokens.lock().unwrap().contains_key(id));

        state.cancel(id);
        assert_eq!(token.load(Ordering::Relaxed), true);
    }

    #[test]
    fn test_remove_token() {
        let state = AppState::new();
        let id = "test-op";
        state.register_token(id);
        
        assert!(state.cancellation_tokens.lock().unwrap().contains_key(id));
        state.remove_token(id);
        assert!(!state.cancellation_tokens.lock().unwrap().contains_key(id));
    }

    #[test]
    fn test_cancel_nonexistent_token() {
        let state = AppState::new();
        // Should not panic
        state.cancel("nonexistent");
    }
}
