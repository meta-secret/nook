use crate::{EventId, SigningIdentity};
use ed25519_dalek::SigningKey;
use nook_auth2::{AuthKeyId, DeviceSigningPublicKey, StoreId};
use rand_core::OsRng;

pub(crate) fn signing_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

pub(crate) fn actor(signing_key: &SigningKey) -> AuthKeyId {
    SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())
        .expect("test support test setup should succeed")
}

pub(crate) fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
    DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
}

pub(crate) fn epoch() -> EventId {
    EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
        .expect("test support test setup should succeed")
}

pub(crate) fn store() -> StoreId {
    StoreId::parse("store_testtoken11").expect("test support test setup should succeed")
}
