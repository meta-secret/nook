//! What the user can decide about each identity a provider holds.
//!
//! Rust groups the listed vaults by identity, decides each identity's
//! standing from the listing and the checks run on the page, and names the
//! decisions it allows. The setup and recovery screens only render them.
use super::wasm_bindgen;
use crate::{TypedInput, TypedOutput};
use nook_core::{
    CredentialCheckReport, FilingIdentity, IdentitySession, ProviderIdentityChoice,
    ProviderIdentityChoices, ProviderVaultSummary,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::JsError;

/// A listing, the checks run on its page, and whether an identity is in use.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookProviderIdentityChoicesRequest {
    pub vaults: Vec<ProviderVaultSummary>,
    /// The listing's `identities`: every identity the provider holds, a
    /// vaultless one included.
    pub identities: Vec<FilingIdentity>,
    pub checks: Vec<CredentialCheckReport>,
    pub session: IdentitySession,
}

/// Every listed identity with its standing, decisions, and vaults.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookProviderIdentityChoices {
    pub identities: Vec<ProviderIdentityChoice>,
}

/// Group a provider listing by identity and say what each one allows.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn provider_identity_choices(
    request: &tsify::Ts<NookProviderIdentityChoicesRequest>,
) -> Result<tsify::Ts<NookProviderIdentityChoices>, JsError> {
    let request = request.decode()?;
    let choices = NookProviderIdentityChoices {
        identities: ProviderIdentityChoices {
            vaults: &request.vaults,
            identities: &request.identities,
            checks: &request.checks,
            session: request.session,
        }
        .choices(),
    };
    Ok(choices.encode()?)
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    fn an_empty_listing_has_no_identity_to_decide_in_either_session() -> anyhow::Result<()> {
        for session in [IdentitySession::IdentityInUse, IdentitySession::NoIdentity] {
            let request = NookProviderIdentityChoicesRequest {
                vaults: Vec::new(),
                identities: Vec::new(),
                checks: Vec::new(),
                session,
            }
            .encode()?;
            let choices = provider_identity_choices(&request)
                .map_err(|error| anyhow::anyhow!("{error:?}"))?
                .decode()?;
            assert!(choices.identities.is_empty());
        }
        Ok(())
    }
}
