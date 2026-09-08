//! In-memory session mutations shared by WASM and integration tests.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ValidationError;

use crate::errors::{SessionError, SessionResult, VaultResult};
use crate::{
    BackupCodeAttachMode, BackupCodePersistenceVerification, Database, SecretId, SecretPayloadYaml,
    SecretType, SecretValue, StoredRecordPayload, VaultCrypto, VaultMetaState,
};

/// Replacement payload admitted by a plaintext or encrypted session.
pub struct ReplaceSecretInput<'a> {
    pub old_id: &'a str,
    pub new_id: &'a str,
    pub secret_type: SecretType,
    pub data_yaml: &'a str,
}

pub struct VerifiedAuthenticatorReplacementInput<'a> {
    pub replacement: ReplaceSecretInput<'a>,
    pub intended_backup_codes: &'a [String],
    pub reviewed_backup_codes: &'a [String],
    pub mode: BackupCodeAttachMode,
}

/// Borrowed plaintext and encrypted projections of the same live session.
pub struct PlaintextSecretSession<'a> {
    pub database: &'a mut Database,
    pub state: &'a mut VaultMetaState,
    pub crypto: &'a VaultCrypto,
}

impl PlaintextSecretSession<'_> {
    /// Replace the plaintext item before encrypting its replacement.
    ///
    /// Encryption failure retains the existing partial effects; persistence is caller-owned.
    pub fn replace(self, input: &ReplaceSecretInput<'_>) -> SessionResult<()> {
        let Self {
            database: db,
            state,
            crypto,
        } = self;
        let old_id = SecretId::parse(input.old_id)?;
        let new_id = SecretId::parse(input.new_id)?;
        if old_id == new_id {
            return Err(SessionError::ReplacementIdUnchanged);
        }
        let payload = SecretPayloadYaml::validate(input.data_yaml)?;
        if !db.list().iter().any(|record| record.id == old_id) {
            return Err(SessionError::SecretNotFound { id: old_id });
        }
        if db.list().iter().any(|record| record.id == new_id) {
            return Err(SessionError::SecretAlreadyExists { id: new_id });
        }

        let typed_value = SecretValue::from_yaml_str(input.secret_type, payload.as_str())?;
        db.remove_and_zeroize(&old_id);
        db.insert(new_id.clone(), typed_value);

        state.secrets.remove(&old_id);

        let encrypted = crypto.encrypt_value(payload.as_str())?;
        state.secrets.insert(
            new_id,
            (
                input.secret_type,
                StoredRecordPayload::from_age_armored(encrypted),
            ),
        );
        Ok(())
    }
}

/// The live encrypted projection and the crypto context used to admit a replacement.
pub struct EncryptedSecretSession<'a> {
    pub state: &'a mut VaultMetaState,
    pub crypto: &'a VaultCrypto,
}

/// An encrypted candidate admitted against the exclusively borrowed live projection.
/// Dropping this value leaves that projection unchanged. Commit is an in-memory effect.
///
/// A candidate cannot be constructed without admission:
/// ```compile_fail,E0451
/// use nook_core::{EncryptedSecretSession, PreparedEncryptedSecretReplacement, SecretId, SecretType, StoredRecordPayload};
/// let forge = |session: EncryptedSecretSession<'_>, old_id: SecretId, new_id: SecretId, payload: StoredRecordPayload| {
///     PreparedEncryptedSecretReplacement { session, old_id, new_id, replacement: (SecretType::Login, payload) }
/// };
/// ```
/// It cannot be cloned or committed twice:
/// ```compile_fail,E0599
/// use nook_core::PreparedEncryptedSecretReplacement;
/// let duplicate = |prepared: PreparedEncryptedSecretReplacement<'_>| prepared.clone();
/// ```
/// ```compile_fail,E0382
/// use nook_core::PreparedEncryptedSecretReplacement;
/// let twice = |prepared: PreparedEncryptedSecretReplacement<'_>| {
///     prepared.commit();
///     prepared.commit();
/// };
/// ```
/// The target remains exclusively borrowed until commit or drop:
/// ```compile_fail,E0499
/// use nook_core::{EncryptedSecretSession, ReplaceSecretInput, VaultCrypto, VaultMetaState, SessionResult};
/// let invalid = |state: &mut VaultMetaState, crypto: &VaultCrypto, input: &ReplaceSecretInput<'_>| -> SessionResult<()> {
///     let prepared = EncryptedSecretSession { state, crypto }.prepare(input)?;
///     state.secrets.clear();
///     prepared.commit();
///     Ok(())
/// };
/// ```
/// Ordinary admission followed by a single commit is valid:
/// ```
/// use nook_core::{EncryptedSecretSession, ReplaceSecretInput, VaultCrypto, VaultMetaState, SessionResult};
/// let replace = |state: &mut VaultMetaState, crypto: &VaultCrypto, input: &ReplaceSecretInput<'_>| -> SessionResult<()> {
///     EncryptedSecretSession { state, crypto }.prepare(input)?.commit();
///     Ok(())
/// };
/// ```
pub struct PreparedEncryptedSecretReplacement<'a> {
    session: EncryptedSecretSession<'a>,
    old_id: SecretId,
    new_id: SecretId,
    replacement: (SecretType, StoredRecordPayload),
}

impl PreparedEncryptedSecretReplacement<'_> {
    pub fn commit(self) {
        self.session.state.secrets.remove(&self.old_id);
        self.session
            .state
            .secrets
            .insert(self.new_id, self.replacement);
    }
}

impl<'a> EncryptedSecretSession<'a> {
    pub fn prepare(
        self,
        input: &ReplaceSecretInput<'_>,
    ) -> SessionResult<PreparedEncryptedSecretReplacement<'a>> {
        let state = &self.state;
        let crypto = self.crypto;
        let old_id = SecretId::parse(input.old_id)?;
        let new_id = SecretId::parse(input.new_id)?;
        if old_id == new_id {
            return Err(SessionError::ReplacementIdUnchanged);
        }
        let payload = SecretPayloadYaml::validate(input.data_yaml)?;
        if !state.secrets.contains_key(&old_id) {
            return Err(SessionError::SecretNotFound { id: old_id });
        }
        if state.secrets.contains_key(&new_id) {
            return Err(SessionError::SecretAlreadyExists { id: new_id });
        }

        let mut typed_value = SecretValue::from_yaml_str(input.secret_type, payload.as_str())?;
        typed_value.zeroize_plaintext();
        let encrypted = crypto.encrypt_value(payload.as_str())?;
        Ok(PreparedEncryptedSecretReplacement {
            session: self,
            old_id,
            new_id,
            replacement: (
                input.secret_type,
                StoredRecordPayload::from_age_armored(encrypted),
            ),
        })
    }

    /// Replace an authenticator only when the projected ciphertext decrypts to the reviewed codes.
    pub fn prepare_verified(
        self,
        input: &VerifiedAuthenticatorReplacementInput<'_>,
    ) -> VaultResult<PreparedEncryptedSecretReplacement<'a>> {
        let state = &self.state;
        let crypto = self.crypto;
        let old_id = SecretId::parse(input.replacement.old_id)?;
        let new_id = SecretId::parse(input.replacement.new_id)?;
        let previous_old = state
            .secrets
            .get(&old_id)
            .cloned()
            .ok_or_else(|| SessionError::SecretNotFound { id: old_id.clone() })?;
        if state.secrets.contains_key(&new_id) {
            return Err(SessionError::SecretAlreadyExists { id: new_id }.into());
        }

        let mut projected_state = VaultMetaState::default();
        projected_state.secrets.insert(old_id.clone(), previous_old);
        EncryptedSecretSession {
            state: &mut projected_state,
            crypto,
        }
        .prepare(&input.replacement)?
        .commit();

        let mut projected =
            crate::VaultSecretSession::new(&projected_state.secrets, crypto).decrypt(&new_id)?;
        let verification = match &projected.data {
            SecretValue::Authenticator(authenticator) => BackupCodePersistenceVerification {
                persisted: &authenticator.backup_codes,
                intended: input.intended_backup_codes,
                reviewed: input.reviewed_backup_codes,
                mode: input.mode,
            }
            .verify()
            .map_err(SessionError::from),
            _ => Err(SessionError::Validation(
                ValidationError::AuthenticatorBackupCodesInvalid,
            )),
        };
        projected.zeroize_plaintext();
        verification?;

        let projected_new = projected_state
            .secrets
            .remove(&new_id)
            .ok_or_else(|| SessionError::SecretNotFound { id: new_id.clone() })?;
        Ok(PreparedEncryptedSecretReplacement {
            session: self,
            old_id,
            new_id,
            replacement: projected_new,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::VaultKeys;
    use crate::{AuthenticatorSecret, ValidationError, VaultError};
    use std::ptr;
    use zeroize::Zeroizing;

    use super::{
        EncryptedSecretSession, ReplaceSecretInput, VerifiedAuthenticatorReplacementInput,
    };
    use crate::{
        BackupCodeAttachMode, SecretType, SecretValue, SessionError, StoredRecordPayload,
        VaultCrypto, VaultMetaState,
    };
    use crate::{SecretId, VaultResult};

    #[test]
    fn encrypted_replace_preserves_validation_and_encrypts_new_payload() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let old_id = SecretId::from_vault_record("secret_SMypl8K0w9Y");
        let mut state = VaultMetaState::default();
        state.secrets.insert(
            old_id,
            (
                SecretType::Login,
                StoredRecordPayload::from_age_armored(crypto.encrypt_value(
                    "websiteUrl: https://old.example\nusername: old\npassword: old-password\nnotes: ''",
                )?),
            ),
        );

        EncryptedSecretSession { state: &mut state, crypto: &crypto }.prepare(
            &ReplaceSecretInput {
                old_id: "secret_SMypl8K0w9Y",
                new_id: "secret_TMypl8K0w9Y",
                secret_type: SecretType::Login,
                data_yaml: "websiteUrl: https://new.example\nusername: new\npassword: new-password\nnotes: ''",
            },
        )?.commit();

        assert!(
            !state
                .secrets
                .contains_key(&SecretId::from_vault_record("secret_SMypl8K0w9Y"))
        );
        let replacement_id = SecretId::from_vault_record("secret_TMypl8K0w9Y");
        let (_, payload) =
            state
                .secrets
                .get(&replacement_id)
                .ok_or(SessionError::SecretNotFound {
                    id: replacement_id.clone(),
                })?;
        assert!(payload.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(!payload.as_str().contains("new-password"));
        let projected =
            crate::VaultSecretSession::new(&state.secrets, &crypto).decrypt(&replacement_id)?;
        let expected = SecretValue::from_yaml_str(
            SecretType::Login,
            "websiteUrl: https://new.example\nusername: new\npassword: new-password\nnotes: ''",
        )?;
        assert_eq!(projected.data, expected);
        Ok(())
    }

    #[test]
    fn verified_authenticator_replace_rolls_back_mismatch_and_commits_exact_codes()
    -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let old_id = SecretId::from_vault_record("secret_AuThOld0001");
        let new_id = SecretId::from_vault_record("secret_AuThNew0001");
        let mut authenticator = AuthenticatorSecret::from_otpauth_uri(
            "otpauth://totp/Nook:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nook",
        )?;
        authenticator.backup_codes = vec!["old-code".to_owned()];
        let old_yaml = SecretValue::Authenticator(authenticator.clone()).to_yaml()?;
        let mut state = VaultMetaState::default();
        state.secrets.insert(
            old_id.clone(),
            (
                SecretType::Authenticator,
                StoredRecordPayload::from_age_armored(crypto.encrypt_value(old_yaml.as_str())?),
            ),
        );

        authenticator.backup_codes = vec!["reviewed-code".to_owned()];
        let replacement_yaml = SecretValue::Authenticator(authenticator).to_yaml()?;
        let intended = vec!["reviewed-code".to_owned()];
        let wrong_reviewed = vec!["wrong-code".to_owned()];
        let mismatch = VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: "secret_AuThOld0001",
                new_id: "secret_AuThNew0001",
                secret_type: SecretType::Authenticator,
                data_yaml: replacement_yaml.as_str(),
            },
            intended_backup_codes: &intended,
            reviewed_backup_codes: &wrong_reviewed,
            mode: BackupCodeAttachMode::Replace,
        };
        assert!(
            EncryptedSecretSession {
                state: &mut state,
                crypto: &crypto
            }
            .prepare_verified(&mismatch)
            .is_err()
        );
        assert!(state.secrets.contains_key(&old_id));
        assert!(!state.secrets.contains_key(&new_id));

        let verified = VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: "secret_AuThOld0001",
                new_id: "secret_AuThNew0001",
                secret_type: SecretType::Authenticator,
                data_yaml: replacement_yaml.as_str(),
            },
            intended_backup_codes: &intended,
            reviewed_backup_codes: &intended,
            mode: BackupCodeAttachMode::Replace,
        };
        EncryptedSecretSession {
            state: &mut state,
            crypto: &crypto,
        }
        .prepare_verified(&verified)?
        .commit();
        let projected = crate::VaultSecretSession::new(&state.secrets, &crypto).decrypt(&new_id)?;
        let SecretValue::Authenticator(projected_authenticator) = projected.data else {
            anyhow::bail!("expected projected authenticator")
        };
        assert_eq!(projected_authenticator.backup_codes, intended);
        Ok(())
    }

    struct ReplacementFixture {
        state: VaultMetaState,
        crypto: VaultCrypto,
        yaml: Zeroizing<String>,
    }

    impl ReplacementFixture {
        const OLD: &'static str = "secret_SMypl8K0w9Y";
        const NEW: &'static str = "secret_TMypl8K0w9Y";
        const OTHER: &'static str = "secret_UMypl8K0w9Y";

        fn new() -> VaultResult<Self> {
            let keys = VaultKeys::generate()?;
            let crypto = VaultCrypto::new(&keys.secrets_key)?;
            let yaml = Zeroizing::new(
                "websiteUrl: https://example.com\nusername: alice\npassword: fixture-only\nnotes: ''".to_owned(),
            );
            let mut state = VaultMetaState::default();
            for id in [Self::OLD, Self::OTHER] {
                state.secrets.insert(
                    SecretId::parse(id)?,
                    (
                        SecretType::Login,
                        StoredRecordPayload::from_age_armored(crypto.encrypt_value(yaml.as_str())?),
                    ),
                );
            }
            Ok(Self {
                state,
                crypto,
                yaml,
            })
        }

        fn request(&self) -> ReplaceSecretInput<'_> {
            ReplaceSecretInput {
                old_id: Self::OLD,
                new_id: Self::NEW,
                secret_type: SecretType::Login,
                data_yaml: &self.yaml,
            }
        }
    }

    #[test]
    fn dropping_admitted_ciphertext_preserves_the_exact_target() -> VaultResult<()> {
        let mut fixture = ReplacementFixture::new()?;
        let before = fixture.state.secrets.clone();
        {
            let prepared = EncryptedSecretSession {
                state: &mut fixture.state,
                crypto: &fixture.crypto,
            }
            .prepare(&ReplaceSecretInput {
                old_id: ReplacementFixture::OLD,
                new_id: ReplacementFixture::NEW,
                secret_type: SecretType::Login,
                data_yaml: &fixture.yaml,
            })?;
            assert!(ptr::eq(prepared.session.crypto, &raw const fixture.crypto));
            assert_eq!(prepared.session.state.secrets, before);
            assert!(
                prepared
                    .replacement
                    .1
                    .as_str()
                    .contains("BEGIN AGE ENCRYPTED FILE")
            );
            assert!(!prepared.replacement.1.as_str().contains("fixture-only"));
        }
        assert_eq!(fixture.state.secrets, before);
        Ok(())
    }

    #[test]
    fn commit_installs_the_admitted_ciphertext_and_preserves_other_entries() -> VaultResult<()> {
        let mut fixture = ReplacementFixture::new()?;
        let other = SecretId::parse(ReplacementFixture::OTHER)?;
        let before = fixture.state.secrets.get(&other).cloned();
        let prepared = EncryptedSecretSession {
            state: &mut fixture.state,
            crypto: &fixture.crypto,
        }
        .prepare(&ReplaceSecretInput {
            old_id: ReplacementFixture::OLD,
            new_id: ReplacementFixture::NEW,
            secret_type: SecretType::Login,
            data_yaml: &fixture.yaml,
        })?;
        let admitted = prepared.replacement.clone();
        prepared.commit();
        assert_eq!(
            fixture
                .state
                .secrets
                .get(&SecretId::parse(ReplacementFixture::NEW)?),
            Some(&admitted)
        );
        assert_eq!(fixture.state.secrets.get(&other), before.as_ref());
        assert!(
            !fixture
                .state
                .secrets
                .contains_key(&SecretId::parse(ReplacementFixture::OLD)?)
        );
        Ok(())
    }

    #[test]
    fn ordinary_admission_keeps_unchanged_id_before_yaml_validation() -> anyhow::Result<()> {
        let mut fixture = ReplacementFixture::new()?;
        let before = fixture.state.secrets.clone();
        let result = EncryptedSecretSession {
            state: &mut fixture.state,
            crypto: &fixture.crypto,
        }
        .prepare(&ReplaceSecretInput {
            old_id: ReplacementFixture::OLD,
            new_id: ReplacementFixture::OLD,
            secret_type: SecretType::Login,
            data_yaml: "",
        });
        let Err(SessionError::ReplacementIdUnchanged) = result else {
            anyhow::bail!("unchanged ID must precede payload validation");
        };
        assert_eq!(fixture.state.secrets, before);
        Ok(())
    }

    #[test]
    fn reviewed_admission_keeps_duplicate_before_unchanged_id_and_yaml() -> anyhow::Result<()> {
        let mut fixture = ReplacementFixture::new()?;
        let before = fixture.state.secrets.clone();
        let result = EncryptedSecretSession {
            state: &mut fixture.state,
            crypto: &fixture.crypto,
        }
        .prepare_verified(&VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: ReplacementFixture::OLD,
                new_id: ReplacementFixture::OLD,
                secret_type: SecretType::Login,
                data_yaml: "",
            },
            intended_backup_codes: &[],
            reviewed_backup_codes: &[],
            mode: BackupCodeAttachMode::Replace,
        });
        let Err(VaultError::Session(SessionError::SecretAlreadyExists { id })) = result else {
            anyhow::bail!("reviewed admission must report the existing target first");
        };
        assert_eq!(id.as_str(), ReplacementFixture::OLD);
        assert_eq!(fixture.state.secrets, before);
        Ok(())
    }

    #[test]
    fn reviewed_admission_keeps_missing_source_before_duplicate_target() -> anyhow::Result<()> {
        let mut fixture = ReplacementFixture::new()?;
        let before = fixture.state.secrets.clone();
        let result = EncryptedSecretSession {
            state: &mut fixture.state,
            crypto: &fixture.crypto,
        }
        .prepare_verified(&VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: ReplacementFixture::NEW,
                new_id: ReplacementFixture::OLD,
                secret_type: SecretType::Login,
                data_yaml: "",
            },
            intended_backup_codes: &[],
            reviewed_backup_codes: &[],
            mode: BackupCodeAttachMode::Replace,
        });
        let Err(VaultError::Session(SessionError::SecretNotFound { id })) = result else {
            anyhow::bail!("reviewed admission must look up the source first");
        };
        assert_eq!(id.as_str(), ReplacementFixture::NEW);
        assert_eq!(fixture.state.secrets, before);
        Ok(())
    }

    #[test]
    fn non_authenticator_projection_cannot_admit_reviewed_replacement() -> anyhow::Result<()> {
        let mut fixture = ReplacementFixture::new()?;
        let before = fixture.state.secrets.clone();
        let yaml = Zeroizing::new(fixture.request().data_yaml.to_owned());
        let result = EncryptedSecretSession {
            state: &mut fixture.state,
            crypto: &fixture.crypto,
        }
        .prepare_verified(&VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: ReplacementFixture::OLD,
                new_id: ReplacementFixture::NEW,
                secret_type: SecretType::Login,
                data_yaml: &yaml,
            },
            intended_backup_codes: &[],
            reviewed_backup_codes: &[],
            mode: BackupCodeAttachMode::Replace,
        });
        let Err(VaultError::Session(SessionError::Validation(
            ValidationError::AuthenticatorBackupCodesInvalid,
        ))) = result
        else {
            anyhow::bail!("a login cannot prove authenticator backup-code persistence");
        };
        assert_eq!(fixture.state.secrets, before);
        Ok(())
    }

    #[test]
    fn malformed_payload_rejection_preserves_ciphertext() -> anyhow::Result<()> {
        let mut fixture = ReplacementFixture::new()?;
        let before = fixture.state.secrets.clone();
        let result = EncryptedSecretSession {
            state: &mut fixture.state,
            crypto: &fixture.crypto,
        }
        .prepare(&ReplaceSecretInput {
            old_id: ReplacementFixture::OLD,
            new_id: ReplacementFixture::NEW,
            secret_type: SecretType::Login,
            data_yaml: "[",
        });
        assert!(
            result.is_err(),
            "malformed YAML must not produce an admitted candidate"
        );
        assert_eq!(fixture.state.secrets, before);
        Ok(())
    }
}
