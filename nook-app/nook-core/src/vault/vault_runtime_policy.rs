//! Portable vault lifecycle policy shared by web and future native hosts.
//!
//! Host adapters supply raw configuration values. Core decides which values
//! are safe to honor and provides production-safe defaults.

pub const DEFAULT_VAULT_IDLE_TIMEOUT_MS: u32 = 5 * 60_000;
pub const DEFAULT_VAULT_IDLE_WARNING_MS: u32 = 30_000;
pub const MIN_VAULT_IDLE_TIMEOUT_MS: u32 = 1_000;
pub const DEFAULT_VAULT_SYNC_INTERVAL_MS: u32 = 60_000;
pub const MIN_VAULT_SYNC_INTERVAL_MS: u32 = 250;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientRunMode {
    Local,
    Dev,
    Prod,
}

impl ClientRunMode {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "localDev" | "local" | "development" | "test" => Some(Self::Local),
            "dev" => Some(Self::Dev),
            "prod" | "production" => Some(Self::Prod),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultRuntimePolicy {
    run_mode: ClientRunMode,
    expose_test_capabilities: bool,
}

impl VaultRuntimePolicy {
    #[must_use]
    pub const fn new(run_mode: ClientRunMode, expose_test_capabilities: bool) -> Self {
        Self {
            run_mode,
            expose_test_capabilities,
        }
    }

    #[must_use]
    pub const fn run_mode(self) -> ClientRunMode {
        self.run_mode
    }

    #[must_use]
    pub const fn expose_test_capabilities(self) -> bool {
        self.expose_test_capabilities
    }

    #[must_use]
    pub const fn allow_fast_idle(self) -> bool {
        !matches!(self.run_mode, ClientRunMode::Prod) || self.expose_test_capabilities
    }

    #[must_use]
    pub const fn allow_fast_sync(self) -> bool {
        !matches!(self.run_mode, ClientRunMode::Prod) || self.expose_test_capabilities
    }

    #[must_use]
    pub const fn expose_debug_hooks(self) -> bool {
        !matches!(self.run_mode, ClientRunMode::Prod) || self.expose_test_capabilities
    }

    #[must_use]
    pub fn resolve_vault_idle_timeout_ms(self, raw: Option<&str>) -> u32 {
        if !self.allow_fast_idle() {
            return DEFAULT_VAULT_IDLE_TIMEOUT_MS;
        }
        parse_config_millis(raw, MIN_VAULT_IDLE_TIMEOUT_MS).unwrap_or(DEFAULT_VAULT_IDLE_TIMEOUT_MS)
    }

    #[must_use]
    pub fn resolve_vault_idle_warning_ms(self, raw: Option<&str>) -> u32 {
        if !self.allow_fast_idle() {
            return DEFAULT_VAULT_IDLE_WARNING_MS;
        }
        parse_config_millis(raw, 0).unwrap_or(DEFAULT_VAULT_IDLE_WARNING_MS)
    }

    #[must_use]
    pub fn resolve_vault_sync_interval_ms(self, raw: Option<&str>) -> u32 {
        if !self.allow_fast_sync() {
            return DEFAULT_VAULT_SYNC_INTERVAL_MS;
        }
        parse_config_millis(raw, MIN_VAULT_SYNC_INTERVAL_MS)
            .unwrap_or(DEFAULT_VAULT_SYNC_INTERVAL_MS)
    }
}

fn parse_config_millis(raw: Option<&str>, min: u32) -> Option<u32> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let value = raw.parse::<u32>().ok()?;
    (value >= min).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_mode_aliases_are_classified_in_core() {
        for alias in ["localDev", "local", "development", "test"] {
            assert_eq!(ClientRunMode::parse(alias), Some(ClientRunMode::Local));
        }
        assert_eq!(ClientRunMode::parse("dev"), Some(ClientRunMode::Dev));
        assert_eq!(ClientRunMode::parse("prod"), Some(ClientRunMode::Prod));
        assert_eq!(
            ClientRunMode::parse("production"),
            Some(ClientRunMode::Prod)
        );
        assert_eq!(ClientRunMode::parse("preview"), None);
    }

    #[test]
    fn production_ignores_unsafe_fast_overrides() {
        let policy = VaultRuntimePolicy::new(ClientRunMode::Prod, false);
        assert_eq!(
            policy.resolve_vault_idle_timeout_ms(Some("1000")),
            DEFAULT_VAULT_IDLE_TIMEOUT_MS
        );
        assert_eq!(
            policy.resolve_vault_idle_warning_ms(Some("0")),
            DEFAULT_VAULT_IDLE_WARNING_MS
        );
        assert_eq!(
            policy.resolve_vault_sync_interval_ms(Some("250")),
            DEFAULT_VAULT_SYNC_INTERVAL_MS
        );
        assert!(!policy.expose_debug_hooks());
    }

    #[test]
    fn local_and_explicit_test_modes_honor_valid_overrides() {
        let local = VaultRuntimePolicy::new(ClientRunMode::Local, false);
        assert_eq!(local.resolve_vault_idle_timeout_ms(Some("1200")), 1200);
        assert_eq!(local.resolve_vault_idle_warning_ms(Some("0")), 0);
        assert_eq!(local.resolve_vault_sync_interval_ms(Some("300")), 300);
        assert_eq!(
            local.resolve_vault_idle_timeout_ms(Some("999")),
            DEFAULT_VAULT_IDLE_TIMEOUT_MS
        );
        assert_eq!(
            local.resolve_vault_sync_interval_ms(Some("249")),
            DEFAULT_VAULT_SYNC_INTERVAL_MS
        );

        let production_test = VaultRuntimePolicy::new(ClientRunMode::Prod, true);
        assert_eq!(
            production_test.resolve_vault_idle_timeout_ms(Some("1000")),
            1000
        );
        assert!(production_test.expose_debug_hooks());
    }
}
