//! Proven enrollment authority and signer-publication decisions.
use nook_core::{AppId, AppKey, DeviceSigningPublicKey};

#[derive(Clone)]
pub(crate) enum VaultCreationAuthority {
    NewIdentity,
    ExistingIdentity(AppKey),
}
#[derive(Clone, Copy)]
pub(crate) enum VaultCreationAuthorityRef<'a> {
    NewIdentity,
    ExistingIdentity(&'a AppKey),
}
impl VaultCreationAuthority {
    pub(crate) fn authorization(&self) -> VaultCreationAuthorityRef<'_> {
        match self {
            Self::NewIdentity => VaultCreationAuthorityRef::NewIdentity,
            Self::ExistingIdentity(key) => VaultCreationAuthorityRef::ExistingIdentity(key),
        }
    }
}
#[derive(Clone, Copy)]
pub(crate) enum HandoffAuthorization<'a> {
    Unauthenticated,
    Authenticated(&'a AppKey),
}
#[derive(Clone)]
pub(crate) struct AuthorizerMemberSigning {
    pub(crate) app_id: AppId,
    pub(crate) signing_public_key: DeviceSigningPublicKey,
}
#[derive(Clone)]
pub(crate) enum AuthorizerSigningUpdate {
    RetainMembership,
    Verified(AuthorizerMemberSigning),
}
#[derive(Clone, Copy)]
pub(crate) enum HandoffSignerPublication<'a> {
    RetainStored,
    ReplaceWith(&'a str),
}
