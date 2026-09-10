use gloo_storage::{SessionStorage, Storage};

#[derive(Clone, Copy)]
pub(crate) enum VaultSessionLock {
    Locked,
    Unlocked,
}
const VAULT_SESSION_LOCKED_KEY: &str = "nook_vault_session_locked";

impl VaultSessionLock {
    #[must_use]
    pub(crate) fn is_vault_session_locked() -> bool {
        if SessionStorage::get::<bool>(VAULT_SESSION_LOCKED_KEY).unwrap_or(false) {
            return true;
        }

        SessionStorage::raw()
            .get_item(VAULT_SESSION_LOCKED_KEY)
            .ok()
            .flatten()
            .is_some_and(|value| value == "1" || value == "true")
    }
}

impl VaultSessionLock {
    pub(crate) fn set_vault_session_locked(state: Self) {
        if matches!(state, Self::Locked) {
            let _ = SessionStorage::set(VAULT_SESSION_LOCKED_KEY, true);
        } else {
            SessionStorage::delete(VAULT_SESSION_LOCKED_KEY);
        }
    }
}
