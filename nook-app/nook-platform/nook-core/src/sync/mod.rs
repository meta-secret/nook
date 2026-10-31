//! Sync-provider configuration, validation, credentials, and reconciliation.

pub(crate) mod authorized_accounts;
pub(crate) mod drive_vault_folder;
pub(crate) mod key_in_use_addition;
pub(crate) mod passkey_identity_addition;
pub(crate) mod provider_identity_choice;
pub(crate) mod provider_identity_join;
pub(crate) mod provider_identity_log;
pub(crate) mod provider_vault_access;
pub(crate) mod provider_vault_join;
pub(crate) mod provider_vault_listing;
pub(crate) mod sync_provider_credentials;
pub(crate) mod sync_provider_store;
pub(crate) mod validation;
pub(crate) mod vault_access_check;
pub(crate) mod vault_sync;
pub(crate) mod vault_sync_conflict;
pub(crate) mod vault_sync_session;
pub(crate) mod vault_sync_state;
pub(crate) mod vault_sync_store;
