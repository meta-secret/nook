//! Named evidence required by each vault client decision.

#[derive(Clone, Copy)]
pub struct EditBlockReasonRequest {
    pub security_conflict_count: crate::VaultSecurityConflictCount,
    pub has_sync_conflict: crate::VaultSyncConflictState,
    pub architecture_allows_secret_creation: crate::VaultSecretCreationPermission,
}

#[derive(Clone, Copy)]
pub struct EditsBlockedRequest {
    pub security_conflict_count: crate::VaultSecurityConflictCount,
    pub has_sync_conflict: crate::VaultSyncConflictState,
    pub architecture_allows_secret_creation: crate::VaultSecretCreationPermission,
}

#[derive(Clone, Copy)]
pub struct EditBlockMessageRequest<'a> {
    pub security_conflict_count: crate::VaultSecurityConflictCount,
    pub has_sync_conflict: crate::VaultSyncConflictState,
    pub architecture_allows_secret_creation: crate::VaultSecretCreationPermission,
    pub catalog_json: &'a str,
    pub locale: &'a str,
}

#[derive(Clone, Copy)]
pub struct ShouldUseJoinProviderForConnectRequest {
    pub authenticated: crate::VaultAuthenticationState,
    pub sync_provider_count: crate::VaultSyncProviderCount,
    pub join_state: crate::JoinEnrollmentState,
}

#[derive(Clone, Copy)]
pub struct ShouldAutoUnlockRequest {
    pub session_explicitly_locked: crate::VaultSessionLockIntent,
    pub local_vault_present: crate::LocalVaultPresence,
    pub password_entry_count: crate::VaultPasswordEntryCount,
    pub sync_provider_count: crate::VaultSyncProviderCount,
    pub provider_setup_active: crate::ProviderSetupState,
    pub add_provider_open: crate::AddProviderPromptState,
}

#[derive(Clone, Copy)]
pub struct ShouldShowLoginVaultPickerRequest {
    pub authenticated: crate::VaultAuthenticationState,
    pub local_vault_count: crate::LocalVaultCount,
    pub vault_selected: crate::VaultSelectionState,
    pub provider_setup_active: crate::ProviderSetupState,
    pub add_provider_open: crate::AddProviderPromptState,
    pub session_explicitly_locked: crate::VaultSessionLockIntent,
}

#[derive(Clone, Copy)]
pub struct ExistingVaultIdentityRecoveryRequiredRequest {
    pub existing_vault_required: crate::VaultExistenceRequirement,
    pub provider_setup_active: crate::ProviderSetupState,
    pub device_protection_ready: crate::DeviceProtectionReadiness,
}

#[derive(Clone, Copy)]
pub struct RemoteVaultAssessDecisionRequest {
    pub access_status: crate::VaultAccessStatus,
    pub existing_vault_required: crate::VaultExistenceRequirement,
    pub provider_setup_active: crate::ProviderSetupState,
}

#[derive(Clone, Copy)]
pub struct VaultConnectProbeDecisionRequest {
    pub access_status: crate::VaultAccessStatus,
    pub authenticated: crate::VaultAuthenticationState,
    pub sync_provider_count: crate::VaultSyncProviderCount,
}

#[derive(Clone, Copy)]
pub struct VaultSwitchTargetRequest<'a> {
    pub requested_store_id: &'a str,
    pub active_store_id: crate::ActiveVaultStore<'a>,
    pub verifying: crate::VaultVerificationState,
}

#[derive(Clone, Copy)]
pub struct ManualSyncHasTargetRequest {
    pub local_vault_present: crate::LocalVaultPresence,
    pub sync_provider_count: crate::VaultSyncProviderCount,
}

#[derive(Clone, Copy)]
pub struct SyncActivityVisibleRequest {
    pub fan_out_syncing: crate::VaultFanOutSyncState,
    pub provider_syncing: crate::VaultProviderSyncState,
    pub syncing: crate::VaultSyncActivity,
    pub saving: crate::VaultSaveActivity,
}

#[derive(Clone, Copy)]
pub struct ShouldSyncFromProvidersRequest {
    pub sync_blocked: crate::VaultSyncPermission,
    pub force: crate::VaultSyncIntent,
    pub verifying: crate::VaultVerificationState,
    pub saving: crate::VaultSaveActivity,
    pub password_busy: crate::VaultPasswordActivity,
    pub syncing: crate::VaultSyncActivity,
    pub sync_provider_count: crate::VaultSyncProviderCount,
}

#[derive(Clone, Copy)]
pub struct UnauthenticatedSyncDecisionRequest {
    pub changed: crate::VaultSyncChange,
    pub access_status: crate::VaultAccessObservation,
    pub join_state: crate::JoinEnrollmentState,
    pub awaiting_join_approval: crate::VaultJoinApprovalWait,
}

#[derive(Clone, Copy)]
pub struct ShouldAutoConnectAfterApprovalRequest {
    pub authenticated: crate::VaultAuthenticationState,
    pub verifying: crate::VaultVerificationState,
    pub password_prompt_open: crate::VaultPasswordPromptState,
    pub session_expired_by_idle: crate::VaultIdleExpiration,
    pub session_explicitly_locked: crate::VaultSessionLockIntent,
}

#[derive(Clone, Copy)]
pub struct VaultSyncTimerStartDecisionRequest {
    pub authenticated: crate::VaultAuthenticationState,
    pub device_protection_ready: crate::DeviceProtectionReadiness,
    pub join_state: crate::JoinEnrollmentState,
    pub awaiting_join_approval: crate::VaultJoinApprovalWait,
}

#[derive(Clone, Copy)]
pub struct VaultSyncTimerTickDecisionRequest {
    pub verifying: crate::VaultVerificationState,
    pub saving: crate::VaultSaveActivity,
    pub syncing: crate::VaultSyncActivity,
    pub password_busy: crate::VaultPasswordActivity,
    pub authenticated: crate::VaultAuthenticationState,
    pub join_state: crate::JoinEnrollmentState,
    pub awaiting_join_approval: crate::VaultJoinApprovalWait,
    pub sync_provider_count: crate::VaultSyncProviderCount,
}

#[derive(Clone, Copy)]
pub struct VaultStorageSyncDecisionRequest {
    pub sync_blocked: crate::VaultSyncPermission,
    pub freshness: crate::ProviderSyncFreshness,
    pub verifying: crate::VaultVerificationState,
    pub saving: crate::VaultSaveActivity,
    pub password_busy: crate::VaultPasswordActivity,
    pub syncing: crate::VaultSyncActivity,
    pub authenticated: crate::VaultAuthenticationState,
    pub sync_provider_count: crate::VaultSyncProviderCount,
    pub has_remote_credentials: crate::RemoteVaultCredentialPresence,
    pub local_vault_present: crate::LocalVaultPresence,
}
