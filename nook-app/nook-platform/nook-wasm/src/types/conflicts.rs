use super::{NookError, NookProviderSyncRevision, wasm_bindgen};
use nook_core::{
    ProviderVaultDecision, ProviderVaultDecisionReason, ProviderVaultIdentityEligibility,
    VaultSyncConflict, VaultSyncConflictKind,
};
use std::collections::BTreeMap;
use wasm_bindgen::JsError;

/// Pending browser sync resolution state.
///
/// Core owns the variant-specific conflict. This wrapper additionally carries
/// the browser provider handle needed to resume the paused storage operation.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPendingSyncConflict {
    provider_id: String,
    provider_label: String,
    local_yaml: String,
    remote_yaml: String,
    mode: String,
    pat: String,
    repo: String,
    remote_revision: NookProviderSyncRevision,
    conflict: nook_core::VaultSyncConflict,
}

const PENDING_SYNC_PROVIDER_ID: &str = "__pending_provider__";
const TEST_SYNC_PROVIDER_ID: &str = "__test_provider__";

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookProviderVaultIdentityProjection(nook_core::ProviderVaultIdentityProjection);

#[wasm_bindgen]
impl NookProviderVaultIdentityProjection {
    #[wasm_bindgen(getter, js_name = identityId)]
    pub fn identity_id(&self) -> String {
        self.0.identity_id.clone()
    }

    #[wasm_bindgen(getter, js_name = identityLabel)]
    pub fn identity_label(&self) -> String {
        self.0.identity_label.clone()
    }

    #[wasm_bindgen(getter, js_name = isCurrentApp)]
    pub fn is_current_app(&self) -> bool {
        self.0.is_current_app
    }

    #[wasm_bindgen(getter)]
    pub fn eligibility(&self) -> nook_core::ProviderVaultIdentityEligibility {
        self.0.eligibility
    }
}

#[wasm_bindgen]
pub struct NookProviderVaultDecisionProjection(nook_core::ProviderVaultDecisionProjection);

impl NookProviderVaultDecisionProjection {
    pub(crate) const fn from_core(projection: nook_core::ProviderVaultDecisionProjection) -> Self {
        Self(projection)
    }
}

#[wasm_bindgen]
impl NookProviderVaultDecisionProjection {
    #[wasm_bindgen(getter)]
    pub fn decision(&self) -> nook_core::ProviderVaultDecision {
        self.0.decision
    }

    #[wasm_bindgen(getter)]
    pub fn reason(&self) -> nook_core::ProviderVaultDecisionReason {
        self.0.reason
    }

    #[wasm_bindgen(getter)]
    pub fn identities(&self) -> Vec<NookProviderVaultIdentityProjection> {
        self.0
            .identities
            .iter()
            .cloned()
            .map(NookProviderVaultIdentityProjection)
            .collect()
    }
}

#[wasm_bindgen]
impl NookPendingSyncConflict {
    /// E2E/dev seam for rendering a Rust-owned content conflict without storage I/O.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `for_testing_content` version or epoch through a JavaScript Number scalar"
        )
    )]
    pub fn for_testing_content(
        provider_label: String,
        local_version: u32,
        remote_version: u32,
    ) -> Self {
        Self::content(
            TEST_SYNC_PROVIDER_ID.to_owned(),
            provider_label,
            String::new(),
            "remote-vault".to_owned(),
            local_version,
            remote_version,
            String::new(),
            String::new(),
            String::new(),
            &NookProviderSyncRevision::untracked(),
        )
    }

    /// E2E/dev seam for rendering a Rust-owned store-id conflict without storage I/O.
    #[wasm_bindgen]
    pub fn for_testing_store_id(
        provider_label: String,
        local_store_id: String,
        remote_store_id: String,
    ) -> Self {
        Self::store_id(
            TEST_SYNC_PROVIDER_ID.to_owned(),
            provider_label,
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            &NookProviderSyncRevision::untracked(),
            local_store_id,
            remote_store_id,
        )
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `content` version or epoch through a JavaScript Number scalar"
        )
    )]
    pub fn content(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        local_version: u32,
        remote_version: u32,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: &NookProviderSyncRevision,
    ) -> Self {
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision: remote_revision.clone(),
            conflict: VaultSyncConflict::Content(nook_core::ContentSyncConflict {
                local_version: u64::from(local_version),
                remote_version: u64::from(remote_version),
            }),
        }
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn content_from_vaults(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: &NookProviderSyncRevision,
    ) -> Self {
        let local_version = nook_core::read_vault_version(&local_yaml).unwrap_or(0);
        let remote_version = nook_core::read_vault_version(&remote_yaml).unwrap_or(0);
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision: remote_revision.clone(),
            conflict: VaultSyncConflict::Content(nook_core::ContentSyncConflict {
                local_version,
                remote_version,
            }),
        }
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn store_id(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: &NookProviderSyncRevision,
        local_store_id: String,
        remote_store_id: String,
    ) -> Self {
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision: remote_revision.clone(),
            conflict: VaultSyncConflict::StoreId(nook_core::StoreIdSyncConflict {
                local_store_id,
                remote_store_id,
            }),
        }
    }

    /// Store-id conflict discovered while a provider is still being configured.
    ///
    /// Keep the pending-provider sentinel inside Rust so the web layer does not
    /// duplicate a value that controls whether provider setup resumes after the
    /// user chooses a recovery action.
    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn pending_store_id(
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: &NookProviderSyncRevision,
        local_store_id: String,
        remote_store_id: String,
    ) -> Self {
        Self::store_id(
            PENDING_SYNC_PROVIDER_ID.to_owned(),
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision,
            local_store_id,
            remote_store_id,
        )
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> String {
        self.provider_id.clone()
    }

    #[wasm_bindgen(getter, js_name = isPendingProvider)]
    #[must_use]
    pub fn is_pending_provider(&self) -> bool {
        self.provider_id == PENDING_SYNC_PROVIDER_ID
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> String {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = localYaml)]
    pub fn local_yaml(&self) -> String {
        self.local_yaml.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteYaml)]
    pub fn remote_yaml(&self) -> String {
        self.remote_yaml.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn mode(&self) -> String {
        self.mode.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteRevision)]
    pub fn remote_revision(&self) -> NookProviderSyncRevision {
        self.remote_revision.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> nook_core::VaultSyncConflictKind {
        self.conflict.kind()
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `content_local_version` version or epoch through a JavaScript Number scalar"
        )
    )]
    pub fn content_local_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        let VaultSyncConflict::Content(details) = &self.conflict else {
            return Err(JsError::new("Sync conflict is not a content conflict."));
        };
        let version = details.local_version;
        u32::try_from(version)
            .map_err(|_| JsError::new("Local vault version exceeds the web limit."))
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `content_remote_version` version or epoch through a JavaScript Number scalar"
        )
    )]
    pub fn content_remote_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        let VaultSyncConflict::Content(details) = &self.conflict else {
            return Err(JsError::new("Sync conflict is not a content conflict."));
        };
        let version = details.remote_version;
        u32::try_from(version)
            .map_err(|_| JsError::new("Remote vault version exceeds the web limit."))
    }

    #[wasm_bindgen]
    pub fn local_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.conflict {
            VaultSyncConflict::StoreId(details) => Ok(details.local_store_id.clone()),
            VaultSyncConflict::Content(_) => {
                Err(JsError::new("Sync conflict is not a store-id conflict."))
            }
        }
    }

    #[wasm_bindgen]
    pub fn remote_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.conflict {
            VaultSyncConflict::StoreId(details) => Ok(details.remote_store_id.clone()),
            VaultSyncConflict::Content(_) => {
                Err(JsError::new("Sync conflict is not a store-id conflict."))
            }
        }
    }
}

#[cfg(test)]
mod pending_sync_conflict_tests {
    use super::*;
    use nook_core::{CurrentVaultReplaceability, IdentityVaultAppGrantKind};

    #[test]
    fn pending_store_id_factory_marks_unsaved_provider() -> Result<(), wasm_bindgen::JsError> {
        let conflict = NookPendingSyncConflict::pending_store_id(
            "GitHub".to_owned(),
            "local".to_owned(),
            String::new(),
            "github".to_owned(),
            "token".to_owned(),
            "owner/repo".to_owned(),
            &NookProviderSyncRevision::untracked(),
            "store_local12345".to_owned(),
            "store_remote1234".to_owned(),
        );

        assert!(conflict.is_pending_provider());
        assert_eq!(conflict.provider_label(), "GitHub");
        assert_eq!(conflict.local_store_id()?, "store_local12345");
        assert_eq!(conflict.remote_store_id()?, "store_remote1234");
        Ok(())
    }

    #[test]
    fn testing_factories_keep_conflict_shapes_in_rust() -> Result<(), wasm_bindgen::JsError> {
        let content =
            NookPendingSyncConflict::for_testing_content("Remote provider".to_owned(), 1, 2);
        assert_eq!(content.kind(), VaultSyncConflictKind::Content);
        assert_eq!(content.content_local_version()?, 1);
        assert_eq!(content.content_remote_version()?, 2);

        let store_id = NookPendingSyncConflict::for_testing_store_id(
            "Google Drive".to_owned(),
            "store_localDemo01".to_owned(),
            "store_remoteDemo1".to_owned(),
        );
        assert_eq!(store_id.kind(), VaultSyncConflictKind::StoreId);
        assert_eq!(store_id.local_store_id()?, "store_localDemo01");
        assert_eq!(store_id.remote_store_id()?, "store_remoteDemo1");
        Ok(())
    }

    #[test]
    fn provider_vault_projection_exposes_only_public_decision_facts() {
        let projection = NookProviderVaultDecisionProjection::from_core(
            nook_core::project_provider_vault_decision(
                CurrentVaultReplaceability::Replaceable,
                vec![
                    nook_core::ProviderVaultIdentityObservation {
                        identity_id: "identity-personal".to_owned(),
                        identity_label: "Personal".to_owned(),
                        linked_to_provider_vault: false,
                        protected_local_app_available: true,
                        is_current_app: true,
                        app_grant: IdentityVaultAppGrantKind::NotLinked,
                    },
                    nook_core::ProviderVaultIdentityObservation {
                        identity_id: "identity-work".to_owned(),
                        identity_label: "Work".to_owned(),
                        linked_to_provider_vault: true,
                        protected_local_app_available: true,
                        is_current_app: false,
                        app_grant: IdentityVaultAppGrantKind::Granted,
                    },
                ],
            ),
        );

        assert_eq!(
            projection.decision(),
            ProviderVaultDecision::AdoptProviderVault
        );
        assert_eq!(
            projection.reason(),
            ProviderVaultDecisionReason::ReadyToAdopt
        );
        let identities = projection.identities();
        assert_eq!(identities[0].identity_id(), "identity-personal");
        assert_eq!(
            identities[0].eligibility(),
            ProviderVaultIdentityEligibility::NotLinked
        );
        assert_eq!(identities[1].identity_label(), "Work");
        assert!(!identities[1].is_current_app());
        assert_eq!(
            identities[1].eligibility(),
            ProviderVaultIdentityEligibility::LinkedAndPrepared
        );
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementCandidate {
    event_id: String,
    secret_id: String,
}

#[wasm_bindgen]
impl NookReplacementCandidate {
    #[wasm_bindgen(getter, js_name = eventId)]
    pub fn event_id(&self) -> String {
        self.event_id.clone()
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementConflict {
    old_secret_id: String,
    candidates: Vec<NookReplacementCandidate>,
}

#[wasm_bindgen]
impl NookReplacementConflict {
    #[wasm_bindgen(getter, js_name = oldSecretId)]
    pub fn old_secret_id(&self) -> String {
        self.old_secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn candidates(&self) -> Vec<NookReplacementCandidate> {
        self.candidates.clone()
    }

    #[wasm_bindgen(getter, js_name = candidateSecretIds)]
    pub fn candidate_secret_ids(&self) -> Vec<String> {
        self.candidates
            .iter()
            .map(|candidate| candidate.secret_id.clone())
            .collect()
    }
}

pub(crate) fn replacement_conflicts_to_vec(
    conflicts: BTreeMap<nook_core::SecretId, nook_core::SecretReplacementConflict>,
) -> Result<Vec<NookReplacementConflict>, NookError> {
    conflicts
        .into_values()
        .map(|conflict| {
            Ok(NookReplacementConflict {
                old_secret_id: conflict.old_secret_id.as_str().to_owned(),
                candidates: conflict
                    .candidates
                    .into_iter()
                    .map(|(event_id, secret_id)| NookReplacementCandidate {
                        event_id: event_id.as_str().to_owned(),
                        secret_id: secret_id.as_str().to_owned(),
                    })
                    .collect(),
            })
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecurityConflict {
    events: Vec<String>,
    reasons: Vec<String>,
}

#[wasm_bindgen]
impl NookSecurityConflict {
    #[wasm_bindgen]
    pub fn from_display_parts(events: Vec<String>, reasons: Vec<String>) -> Self {
        Self { events, reasons }
    }

    #[wasm_bindgen(getter)]
    pub fn events(&self) -> Vec<String> {
        self.events.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn reasons(&self) -> Vec<String> {
        self.reasons.clone()
    }
}

pub(crate) fn security_conflicts_to_vec(
    conflicts: Vec<nook_core::SecurityConflict>,
) -> Result<Vec<NookSecurityConflict>, NookError> {
    conflicts
        .into_iter()
        .map(|conflict| {
            Ok(NookSecurityConflict {
                events: conflict
                    .events
                    .into_iter()
                    .map(|event| event.as_str().to_owned())
                    .collect(),
                reasons: conflict
                    .reasons
                    .into_iter()
                    .map(|reason| reason.as_str().to_owned())
                    .collect(),
            })
        })
        .collect()
}

#[cfg(test)]
mod projection_conflict_tests {
    use super::*;

    #[test]
    fn replacement_conflict_exposes_candidate_ids_without_web_mapping() {
        let conflict = NookReplacementConflict {
            old_secret_id: "secret-old".to_owned(),
            candidates: vec![
                NookReplacementCandidate {
                    event_id: "event-a".to_owned(),
                    secret_id: "secret-a".to_owned(),
                },
                NookReplacementCandidate {
                    event_id: "event-b".to_owned(),
                    secret_id: "secret-b".to_owned(),
                },
            ],
        };

        assert_eq!(
            conflict.candidate_secret_ids(),
            vec!["secret-a".to_owned(), "secret-b".to_owned()]
        );
    }

    #[test]
    fn security_conflict_display_parts_are_owned_by_wasm() {
        let conflict = NookSecurityConflict::from_display_parts(
            vec!["event-a".to_owned()],
            vec!["password-rotated".to_owned()],
        );

        assert_eq!(conflict.events(), vec!["event-a".to_owned()]);
        assert_eq!(conflict.reasons(), vec!["password-rotated".to_owned()]);
    }
}
