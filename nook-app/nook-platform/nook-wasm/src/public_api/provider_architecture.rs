use super::{NookProviderSelection, wasm_bindgen};
use crate::{NookEnrollmentProvider, NookProviderReplicationCapability, NookVaultArchitecture};
use crate::{TypedInput, TypedOutput};
use nook_core::{EnrollmentAudience, ProviderEnrollmentRequest, SharedEnrollmentAudience};
use nook_core::{ICloudShareRole, ICloudSharedTarget, ProviderDraft, VaultArchitecture};
use nook_core::{ProviderSelectionPolicy, ProviderSelectionRequest};
use wasm_bindgen::JsError;

/// A Google sign-in applied to the draft being set up.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn apply_google_drive_sign_in(
    request: &tsify::Ts<nook_core::GoogleDriveSignInRequest>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    Ok(request.apply().encode()?)
}

/// A `CloudKit` sign-in applied to the draft being set up.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn apply_icloud_sign_in(
    request: &tsify::Ts<nook_core::ICloudSignInRequest>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    Ok(request.apply().encode()?)
}

/// The vault folder a Google Drive draft connects through.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn bind_google_drive_folder(
    request: &tsify::Ts<nook_core::GoogleDriveFolderBinding>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    Ok(request.apply()?.encode()?)
}

/// The `CloudKit` share an iCloud draft connects through.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn bind_icloud_share(
    request: &tsify::Ts<nook_core::ICloudShareBinding>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    Ok(request.apply()?.encode()?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn create_icloud_shared_storage_target(
    role: &str,
    zone_name: &str,
    owner_record_name: &str,
    root_record_name: &str,
    short_guid: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let role = match role.trim() {
        "owner" => ICloudShareRole::Owner,
        "participant" => ICloudShareRole::Participant,
        other => {
            return Err(JsError::new(&format!(
                "Unknown iCloud share role: {other}"
            )));
        }
    };
    Ok(ICloudSharedTarget::new(
        role,
        zone_name,
        owner_record_name,
        root_record_name,
        short_guid,
    )?
    .to_storage_id()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn parse_icloud_shared_storage_target(
    storage_target_id: &str,
) -> Result<tsify::Ts<nook_core::ICloudSharedTarget>, wasm_bindgen::JsError> {
    let result =
        Ok::<_, wasm_bindgen::JsError>(ICloudSharedTarget::from_storage_id(storage_target_id)?)?;
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn default_vault_architecture() -> NookVaultArchitecture {
    NookVaultArchitecture::from_core(VaultArchitecture::default())
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_vault_architecture(
    architecture: &NookVaultArchitecture,
) -> Result<NookVaultArchitecture, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(NookVaultArchitecture::from_core(architecture))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn vault_architecture_onboarding_type(
    architecture: &NookVaultArchitecture,
) -> Result<nook_core::OnboardingType, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.onboarding_type())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_onboarding_type(
    provider: &tsify::Ts<nook_core::StorageProvider>,
    architecture: &NookVaultArchitecture,
) -> Result<nook_core::OnboardingType, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    let architecture = architecture.to_core();
    Ok(provider.onboarding_type(&architecture)?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn vault_architecture_can_create_secret(
    architecture: &NookVaultArchitecture,
) -> Result<bool, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.can_create_secret())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_replication_capability(
    provider: &tsify::Ts<nook_core::StorageProvider>,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    Ok(NookProviderReplicationCapability::from_core(
        provider.replication_capability(),
    ))
}

/// What a provider kind can replicate, before any row of it exists.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_kind_replication_capability(
    kind: &tsify::Ts<nook_core::ProviderKind>,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    let kind = kind.decode()?;
    Ok(NookProviderReplicationCapability::from_core(
        kind.replication_capability(),
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn validate_provider_replication(
    provider: &tsify::Ts<nook_core::StorageProvider>,
    replication_type: nook_core::ReplicationType,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    Ok(NookProviderReplicationCapability::from_core(
        provider.validate_replication(replication_type)?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_carries_device_join(
    provider: &tsify::Ts<nook_core::StorageProvider>,
) -> Result<bool, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    Ok(provider.device_join_reach() == nook_core::DeviceJoinReach::OtherDevices)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_supports_replication(
    provider: &tsify::Ts<nook_core::StorageProvider>,
    replication_type: nook_core::ReplicationType,
) -> Result<nook_core::ReplicationSupport, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    Ok(provider.replication_support(replication_type))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn first_compatible_provider_id(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    replication_type: nook_core::ReplicationType,
) -> Result<NookProviderSelection, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;
    let result = {
        NookProviderSelection(
            ProviderSelectionRequest {
                providers: &snapshot.providers,
                replication_type,
                policy: ProviderSelectionPolicy::FirstCompatible,
            }
            .select(),
        )
    };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn first_compatible_provider_id_preferred(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    replication_type: nook_core::ReplicationType,
    preferred_id: &str,
) -> Result<NookProviderSelection, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;
    let result = {
        NookProviderSelection(
            ProviderSelectionRequest {
                providers: &snapshot.providers,
                replication_type,
                policy: ProviderSelectionPolicy::Prefer(preferred_id.into()),
            }
            .select(),
        )
    };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn enrollment_provider_for_architecture(
    provider: &tsify::Ts<nook_core::StorageProvider>,
    architecture: &NookVaultArchitecture,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    let architecture = architecture.to_core();
    Ok(NookEnrollmentProvider::from_core(
        ProviderEnrollmentRequest {
            provider: &provider,
            architecture: &architecture,
            audience: EnrollmentAudience::Personal,
        }
        .build()?,
    ))
}

/// Credential-free device invite for a shared Google Drive or iCloud provider.
/// `joiner_identity` is the authorized account (email) picked from the
/// provider's access list; the target comes from the saved provider row.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn enrollment_shared_provider_for_architecture(
    provider: &tsify::Ts<nook_core::StorageProvider>,
    architecture: &NookVaultArchitecture,
    joiner_identity: &str,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    let architecture = architecture.to_core();
    Ok(NookEnrollmentProvider::from_core(
        ProviderEnrollmentRequest {
            provider: &provider,
            architecture: &architecture,
            audience: EnrollmentAudience::Shared(SharedEnrollmentAudience { joiner_identity }),
        }
        .build()?,
    ))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn select_shared_grant_provider(
    request: &tsify::Ts<nook_core::SharedGrantProviderRequest>,
) -> Result<tsify::Ts<nook_core::SharedGrantProviderOutcome>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    let result = { request.select() };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn evaluate_sentinel_policy_draft(
    draft: &tsify::Ts<nook_core::SentinelPolicyDraft>,
) -> Result<tsify::Ts<nook_core::SentinelPolicyDraftEvaluation>, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    let result = { draft.evaluate() };
    Ok(result.encode()?)
}
