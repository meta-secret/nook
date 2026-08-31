use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct AccountPickerAuthorizationLifecycle {
    inner: nook_companion_core::AccountPickerAuthorizationLifecycle,
}

#[wasm_bindgen]
impl AccountPickerAuthorizationLifecycle {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(epoch: String) -> Self {
        Self {
            inner: nook_companion_core::AccountPickerAuthorizationLifecycle::new(epoch),
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> String {
        self.inner.snapshot()
    }

    pub fn begin_cleanup(&mut self, next_epoch: String) -> String {
        self.inner.begin_cleanup(next_epoch)
    }

    pub fn complete_cleanup(&mut self, candidate: &str, full_cleanup_completed: bool) -> bool {
        self.inner
            .complete_cleanup(candidate, full_cleanup_completed)
    }

    #[must_use]
    pub fn is_final_cleanup(&self, candidate: &str, full_cleanup_completed: bool) -> bool {
        self.inner
            .is_final_cleanup(candidate, full_cleanup_completed)
    }

    pub fn release_cleanup(&mut self, candidate: &str) {
        self.inner.release_cleanup(candidate);
    }

    #[must_use]
    pub fn is_current(&self, candidate: &str) -> bool {
        self.inner.is_current(candidate)
    }
}
