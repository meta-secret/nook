use gloo_storage::{SessionStorage, Storage};

const VAULT_SESSION_LOCKED_KEY: &str = "nook_vault_session_locked";

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

pub(crate) fn set_vault_session_locked(locked: bool) {
    if locked {
        let _ = SessionStorage::set(VAULT_SESSION_LOCKED_KEY, true);
    } else {
        SessionStorage::delete(VAULT_SESSION_LOCKED_KEY);
    }
}
