//! Typed exports of the Rust-owned "This site" page need and listing.

use nook_companion_core::{
    AuthenticationWorkflowMatch, SitePageNeed, SiteSecretListing, SiteSecretListingRequest,
    SiteSecretVaults,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// The page need the content script reports for its classified page.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn site_page_need(
    workflow_match: &Ts<AuthenticationWorkflowMatch>,
) -> Result<SitePageNeed, JsError> {
    workflow_match
        .to_rust()
        .map(SitePageNeed::from)
        .map_err(|_| JsError::new("Invalid authentication workflow match."))
}

/// Presents one identity:vault section per paired vault, with each vault's
/// matches filtered by the page need, for the side panel.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn present_site_secret_listing(
    page_need: SitePageNeed,
    vaults: &Ts<SiteSecretVaults>,
) -> Result<Ts<SiteSecretListing>, JsError> {
    let vaults = vaults
        .to_rust()
        .map_err(|_| JsError::new("Invalid site secret vault matches."))?;
    SiteSecretListingRequest { page_need, vaults }
        .present()
        .into_ts()
        .map_err(|_| JsError::new("Site secret listing could not be encoded."))
}

#[cfg(test)]
mod tests {
    use nook_companion_core::{
        SiteSecretItem, SiteSecretListing, SiteSecretListingSummary, SiteSecretMatches,
        SiteSecretRow, SiteSecretSection, SiteSecretSectionContent, SiteSecretVault,
    };
    use tsify::Tsify;

    #[test]
    fn site_listing_bridge_declares_the_kind_names_and_tagged_unions() {
        assert!(SiteSecretItem::DECL.contains("kind: keyof typeof SiteSecretKind"));
        assert!(SiteSecretItem::DECL.contains("secret_id: SecretId"));
        assert!(SiteSecretMatches::DECL.contains("items: SiteSecretItem[]"));
        assert!(SiteSecretVault::DECL.contains("vault_store_id: StoreId"));
        assert!(SiteSecretVault::DECL.contains("matches: SiteSecretMatches"));
        assert!(SiteSecretListing::DECL.contains("summary: SiteSecretListingSummary"));
        assert!(SiteSecretListing::DECL.contains("sections: SiteSecretSection[]"));
        assert!(SiteSecretListingSummary::DECL.contains(r#"kind: "Listed""#));
        assert!(SiteSecretListingSummary::DECL.contains(r#"kind: "Empty""#));
        assert!(SiteSecretSection::DECL.contains("vault_store_id: StoreId"));
        assert!(SiteSecretSection::DECL.contains("identity: SiteSecretIdentityHeader"));
        assert!(SiteSecretSection::DECL.contains("vault: SiteSecretVaultLabel"));
        assert!(SiteSecretSection::DECL.contains("content: SiteSecretSectionContent"));
        assert!(SiteSecretSectionContent::DECL.contains("rows: SiteSecretRow[]"));
        assert!(SiteSecretSectionContent::DECL.contains(r#"kind: "Empty""#));
        assert!(SiteSecretRow::DECL.contains("kind: keyof typeof SiteSecretKind"));
        assert!(SiteSecretRow::DECL.contains("action: SiteSecretAction"));
        assert!(!SiteSecretRow::DECL.contains("vault:"));
    }
}
