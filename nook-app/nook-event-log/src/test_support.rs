use crate::{EventId, EventResult, SigningIdentity};
use ed25519_dalek::SigningKey;
use nook_auth2::{AuthKeyId, DeviceSigningPublicKey, StoreId};
use rand_core::OsRng;

pub(crate) fn signing_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

pub(crate) fn actor(signing_key: &SigningKey) -> EventResult<AuthKeyId> {
    SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())
}

pub(crate) fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
    DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
}

pub(crate) fn epoch() -> EventResult<EventId> {
    EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
}

pub(crate) fn store() -> EventResult<StoreId> {
    StoreId::parse("store_testtoken11").map_err(Into::into)
}
