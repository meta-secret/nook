#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Encoded ceremony data and ES256 credential material.
use super::*;
use base64::Engine;
pub(super) struct CanonicalPasskeyField<'a> {
    pub(super) name: &'static str,
    pub(super) value: &'a str,
    pub(super) min: usize,
    pub(super) max: usize,
}
impl CanonicalPasskeyField<'_> {
    pub(super) fn decode(self) -> PasskeyAuthenticatorResult<Vec<u8>> {
        let Self {
            name,
            value,
            min,
            max,
        } = self;
        let bytes = Engine::decode(&URL_SAFE_NO_PAD, value)
            .map_err(|_| PasskeyAuthenticatorError::InvalidRequest(name))?;
        if bytes.len() < min
            || bytes.len() > max
            || Engine::encode(&URL_SAFE_NO_PAD, &bytes) != value
        {
            return Err(PasskeyAuthenticatorError::InvalidRequest(name));
        }
        Ok(bytes)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClientData<'a> {
    #[serde(rename = "type")]
    pub(super) ceremony_type: &'static str,
    pub(super) challenge: &'a str,
    pub(super) origin: &'a str,
    pub(super) cross_origin: bool,
}

impl ClientData<'_> {
    pub(super) fn encode(self) -> PasskeyAuthenticatorResult<Vec<u8>> {
        let challenge = self.challenge;
        CanonicalPasskeyField {
            name: "challenge",
            value: challenge,
            min: MIN_CHALLENGE_BYTES,
            max: MAX_CHALLENGE_BYTES,
        }
        .decode()?;
        serde_json::to_vec(&self).map_err(|_| PasskeyAuthenticatorError::Serialization)
    }
}
pub(super) struct CoseEncodedPoint<'a>(pub(super) &'a Sec1Point);
impl CoseEncodedPoint<'_> {
    pub(super) fn encode(self) -> PasskeyAuthenticatorResult<Vec<u8>> {
        let encoded_point = self.0;
        let x = encoded_point
            .x()
            .ok_or(PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let y = encoded_point
            .y()
            .ok_or(PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let value = Value::Map(vec![
            (
                Value::Integer(Integer::from(1)),
                Value::Integer(Integer::from(2)),
            ),
            (
                Value::Integer(Integer::from(3)),
                Value::Integer(Integer::from(i64::from(ES256_ALGORITHM))),
            ),
            (
                Value::Integer(Integer::from(-1)),
                Value::Integer(Integer::from(1)),
            ),
            (Value::Integer(Integer::from(-2)), Value::Bytes(x.to_vec())),
            (Value::Integer(Integer::from(-3)), Value::Bytes(y.to_vec())),
        ]);
        let mut bytes = Vec::new();
        ser::into_writer(&value, &mut bytes)
            .map_err(|_| PasskeyAuthenticatorError::Serialization)?;
        Ok(bytes)
    }
}
pub(super) struct CoseKeyBytes<'a>(pub(super) &'a [u8]);
impl CoseKeyBytes<'_> {
    pub(super) fn coordinates(self) -> PasskeyAuthenticatorResult<(Vec<u8>, Vec<u8>)> {
        let bytes = self.0;
        let value: Value =
            de::from_reader(bytes).map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let Value::Map(entries) = value else {
            return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
        };
        let mut x = None;
        let mut y = None;
        let mut key_type = None;
        let mut algorithm = None;
        let mut curve = None;
        for (key, value) in entries {
            let Value::Integer(key) = key else { continue };
            let key = i128::from(key);
            match (key, value) {
                (1, Value::Integer(value)) => key_type = Some(i128::from(value)),
                (3, Value::Integer(value)) => algorithm = Some(i128::from(value)),
                (-1, Value::Integer(value)) => curve = Some(i128::from(value)),
                (-2, Value::Bytes(value)) => x = Some(value),
                (-3, Value::Bytes(value)) => y = Some(value),
                _ => {}
            }
        }
        let (Some(x), Some(y)) = (x, y) else {
            return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
        };
        if key_type != Some(2)
            || algorithm != Some(i128::from(ES256_ALGORITHM))
            || curve != Some(1)
            || x.len() != 32
            || y.len() != 32
        {
            return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
        }
        Ok((x, y))
    }
}
impl PasskeyPrivateKeyPkcs8 {
    pub(crate) fn validate_es256(
        &self,
        public_key: Option<&PasskeyPublicKeyCose>,
    ) -> PasskeyAuthenticatorResult<()> {
        let private_key = self;
        let private_bytes = Zeroizing::new(
            Engine::decode(&URL_SAFE_NO_PAD, private_key.encoded())
                .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?,
        );
        let secret = SecretKey::from_pkcs8_der(&private_bytes)
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        if let Some(public_key) = public_key {
            let public_bytes = Engine::decode(&URL_SAFE_NO_PAD, public_key.encoded())
                .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
            let (x, y) = CoseKeyBytes(&public_bytes).coordinates()?;
            let encoded = secret.public_key().to_sec1_point(false);
            if encoded
                .x()
                .is_none_or(|value| value.as_slice() != x.as_slice())
                || encoded
                    .y()
                    .is_none_or(|value| value.as_slice() != y.as_slice())
            {
                return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
            }
        }
        Ok(())
    }
}
pub(super) enum AuthenticatorDataKind {
    Registration,
    Assertion,
}
impl AuthenticatorDataKind {
    fn flags(self, user_verified: bool) -> u8 {
        let attested = matches!(self, Self::Registration);
        0x01 | if user_verified { 0x04 } else { 0 } | 0x08 | 0x10 | if attested { 0x40 } else { 0 }
    }
}
pub(super) struct RegistrationAuthenticatorData<'a> {
    pub(super) rp_id: &'a str,
    pub(super) credential_id: &'a [u8],
    pub(super) cose_key: &'a [u8],
    pub(super) user_verified: bool,
}
impl RegistrationAuthenticatorData<'_> {
    pub(super) fn encode(self) -> PasskeyAuthenticatorResult<Vec<u8>> {
        let Self {
            rp_id,
            credential_id,
            cose_key,
            user_verified,
        } = self;
        let mut data = Vec::with_capacity(55 + credential_id.len() + cose_key.len());
        data.extend_from_slice(&Sha256::digest(rp_id.as_bytes()));
        data.push(AuthenticatorDataKind::Registration.flags(user_verified));
        data.extend_from_slice(&0_u32.to_be_bytes());
        data.extend_from_slice(&[0_u8; 16]);
        let credential_id_len = u16::try_from(credential_id.len())
            .map_err(|_| PasskeyAuthenticatorError::InvalidRequest("credential id"))?;
        data.extend_from_slice(&credential_id_len.to_be_bytes());
        data.extend_from_slice(credential_id);
        data.extend_from_slice(cose_key);
        Ok(data)
    }
}
pub(super) struct AssertionAuthenticatorData<'a> {
    pub(super) rp_id: &'a str,
    pub(super) count: u32,
    pub(super) user_verified: bool,
}
impl AssertionAuthenticatorData<'_> {
    pub(super) fn encode(self) -> Vec<u8> {
        let Self {
            rp_id,
            count,
            user_verified,
        } = self;
        let mut data = Vec::with_capacity(37);
        data.extend_from_slice(&Sha256::digest(rp_id.as_bytes()));
        data.push(AuthenticatorDataKind::Assertion.flags(user_verified));
        data.extend_from_slice(&count.to_be_bytes());
        data
    }
}
pub(super) struct AttestationObject(pub(super) Vec<u8>);
impl AttestationObject {
    pub(super) fn encode(self) -> PasskeyAuthenticatorResult<Vec<u8>> {
        let authenticator_data = self.0;
        let value = Value::Map(vec![
            (
                Value::Text("fmt".to_owned()),
                Value::Text("none".to_owned()),
            ),
            (Value::Text("attStmt".to_owned()), Value::Map(Vec::new())),
            (
                Value::Text("authData".to_owned()),
                Value::Bytes(authenticator_data),
            ),
        ]);
        let mut bytes = Vec::new();
        ser::into_writer(&value, &mut bytes)
            .map_err(|_| PasskeyAuthenticatorError::Serialization)?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_challenge_boundaries_and_noncanonical_encoding_fail_closed() {
        for length in [MIN_CHALLENGE_BYTES, MAX_CHALLENGE_BYTES] {
            let expected = vec![0x3c; length];
            let encoded = Engine::encode(&URL_SAFE_NO_PAD, &expected);
            assert_eq!(
                CanonicalPasskeyField {
                    name: "challenge",
                    value: &encoded,
                    min: MIN_CHALLENGE_BYTES,
                    max: MAX_CHALLENGE_BYTES
                }
                .decode(),
                Ok(expected)
            );
        }
        let too_short = Engine::encode(&URL_SAFE_NO_PAD, [0x3c; MIN_CHALLENGE_BYTES - 1]);
        let too_long = Engine::encode(&URL_SAFE_NO_PAD, vec![0x3c; MAX_CHALLENGE_BYTES + 1]);
        let padded = format!(
            "{}=",
            Engine::encode(&URL_SAFE_NO_PAD, [0x3c; MIN_CHALLENGE_BYTES])
        );
        let malformed: [&str; 4] = [&too_short, &too_long, &padded, "not+base64/url"];
        for value in malformed {
            assert_eq!(
                CanonicalPasskeyField {
                    name: "challenge",
                    value,
                    min: MIN_CHALLENGE_BYTES,
                    max: MAX_CHALLENGE_BYTES
                }
                .decode(),
                Err(PasskeyAuthenticatorError::InvalidRequest("challenge"))
            );
        }
    }

    #[test]
    fn authenticator_data_preserves_flags_counter_and_attested_layout() -> anyhow::Result<()> {
        for user_verified in [false, true] {
            let data = AssertionAuthenticatorData {
                rp_id: "example.com",
                count: 0x01020304,
                user_verified,
            }
            .encode();
            assert_eq!(data.len(), 37);
            assert_eq!(&data[..32], Sha256::digest(b"example.com").as_slice());
            assert_eq!(data[32], if user_verified { 0x1d } else { 0x19 });
            assert_eq!(&data[33..], &[1, 2, 3, 4]);
            let data = RegistrationAuthenticatorData {
                rp_id: "example.com",
                credential_id: &[7, 8],
                cose_key: &[9, 10],
                user_verified,
            }
            .encode()?;
            assert_eq!(data.len(), 59);
            assert_eq!(data[32], if user_verified { 0x5d } else { 0x59 });
            assert_eq!(&data[33..53], &[0; 20]);
            assert_eq!(&data[53..], &[0, 2, 7, 8, 9, 10]);
        }
        Ok(())
    }

    #[test]
    fn credential_key_validation_rejects_mismatched_public_key() -> anyhow::Result<()> {
        let first = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?
            .credential;
        let second = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?
            .credential;
        let PasskeyCredentialKey::Es256 {
            private_key_pkcs8, ..
        } = &first.key;
        let PasskeyCredentialKey::Es256 {
            public_key_cose, ..
        } = &second.key;
        assert_eq!(
            private_key_pkcs8.validate_es256(Some(public_key_cose)),
            Err(PasskeyAuthenticatorError::InvalidKeyMaterial)
        );
        Ok(())
    }
}
