//! Vault-keyed identity and secret-version fingerprints for import reconciliation.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod canonical;
mod metadata;
use crate::{LoginSecret, SecretValue, SecureNoteSecret, SymmetricKey};
use canonical::{FingerprintKind, FingerprintRequest};
use metadata::{ImportMetadataPolicy, ProviderNotes};
use nook_auth2::ValidationResult;
pub use nook_event_log::SecretFingerprint;
use zeroize::Zeroize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretEnrichment {
    Changed,
    Unchanged,
}

impl SecretValue {
    /// Compute the logical item identity without its password or provider metadata.
    pub fn identity_fingerprint(
        &self,
        secrets_key: &SymmetricKey,
    ) -> ValidationResult<SecretFingerprint> {
        FingerprintRequest {
            value: self,
            secrets_key,
        }
        .prepare(FingerprintKind::Identity)
        .finish()
    }
    /// Compute one secret-value version, bound to its logical item identity.
    ///
    /// ```
    /// use nook_core::{LoginSecret, SecretValue, SymmetricKey};
    /// let value = SecretValue::Login(LoginSecret {
    ///     website_url: "https://example.com".to_owned(),
    ///     username: "alice".to_owned(), password: "secret".to_owned(),
    ///     notes: String::new(),
    /// });
    /// let key = SymmetricKey::parse(&"a".repeat(64))?;
    /// let identity = value.identity_fingerprint(&key)?;
    /// let version = value.fingerprint(&key)?;
    /// assert_ne!(identity, version);
    /// # Ok::<(), nook_core::ValidationError>(())
    /// ```
    /// Canonical operation fields are private implementation evidence.
    /// ```compile_fail,E0603
    /// use nook_core::secrets::secret_fingerprint::canonical::CanonicalSecretFingerprint;
    /// ```
    pub fn fingerprint(&self, secrets_key: &SymmetricKey) -> ValidationResult<SecretFingerprint> {
        FingerprintRequest {
            value: self,
            secrets_key,
        }
        .prepare(FingerprintKind::Version)
        .finish()
    }
    /// Enrich an existing matching version with another provider's fields.
    /// The caller retains responsibility for deciding that the versions match.
    #[must_use]
    pub fn enrich_with(&mut self, incoming: &Self) -> SecretEnrichment {
        match (self, incoming) {
            (SecretValue::Login(existing), SecretValue::Login(incoming)) => {
                let notes = (ProviderNotes {
                    text: &existing.notes,
                    policy: ImportMetadataPolicy::Login,
                })
                .merge(&incoming.notes);
                if notes == existing.notes {
                    SecretEnrichment::Unchanged
                } else {
                    existing.notes.zeroize();
                    existing.notes = notes;
                    SecretEnrichment::Changed
                }
            }
            (SecretValue::SecureNote(existing), SecretValue::SecureNote(incoming)) => {
                let note = (ProviderNotes {
                    text: &existing.note,
                    policy: ImportMetadataPolicy::General,
                })
                .merge(&incoming.note);
                if note == existing.note {
                    SecretEnrichment::Unchanged
                } else {
                    existing.note.zeroize();
                    existing.note = note;
                    SecretEnrichment::Changed
                }
            }
            _ => SecretEnrichment::Unchanged,
        }
    }
}
#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::{SecretEnrichment, SecretFingerprint};
    use crate::SymmetricKey;
    use crate::{
        AuthenticatorSecret, CheckedPasskeyRegistration, LoginSecret, PasskeyRegistrationRequest,
        PasskeyRelyingParty, PasskeyUser, SecretValue, SecureNoteSecret, TotpAlgorithm, TotpDigits,
        TotpPeriod, TotpSecret,
    };
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    #[test]
    fn enrichment_keeps_existing_credentials_without_claiming_a_match() {
        let mut existing = SecretValue::Login(LoginSecret {
            website_url: "existing".to_owned(),
            username: "alice".to_owned(),
            password: "original".to_owned(),
            notes: "first".to_owned(),
        });
        let incoming = SecretValue::Login(LoginSecret {
            website_url: "different".to_owned(),
            username: "bob".to_owned(),
            password: "different".to_owned(),
            notes: "second".to_owned(),
        });
        assert_eq!(existing.enrich_with(&incoming), SecretEnrichment::Changed);
        assert_eq!(
            existing,
            SecretValue::Login(LoginSecret {
                website_url: "existing".to_owned(),
                username: "alice".to_owned(),
                password: "original".to_owned(),
                notes: "first\n\nsecond".to_owned(),
            })
        );
        assert!(matches!(incoming, SecretValue::Login(login) if login.notes == "second"));
    }

    #[test]
    fn unsupported_enrichment_pairs_return_the_existing_value_unchanged() {
        let mut existing = SecretValue::SecureNote(SecureNoteSecret {
            title: "original".to_owned(),
            note: "first".to_owned(),
        });
        let mut incoming = SecretValue::Login(LoginSecret {
            website_url: String::new(),
            username: String::new(),
            password: "password".to_owned(),
            notes: "second".to_owned(),
        });
        assert_eq!(existing.enrich_with(&incoming), SecretEnrichment::Unchanged);
        assert_eq!(incoming.enrich_with(&existing), SecretEnrichment::Unchanged);
    }

    #[test]
    fn secure_note_enrichment_preserves_the_existing_title() {
        let mut existing = SecretValue::SecureNote(SecureNoteSecret {
            title: "original".to_owned(),
            note: "first".to_owned(),
        });
        let incoming = SecretValue::SecureNote(SecureNoteSecret {
            title: "incoming".to_owned(),
            note: "second".to_owned(),
        });
        assert_eq!(existing.enrich_with(&incoming), SecretEnrichment::Changed);
        assert_eq!(
            existing,
            SecretValue::SecureNote(SecureNoteSecret {
                title: "original".to_owned(),
                note: "first\n\nsecond".to_owned(),
            })
        );
    }

    struct FingerprintKeyFixture {
        byte: char,
    }
    impl FingerprintKeyFixture {
        fn key(&self) -> anyhow::Result<SymmetricKey> {
            Ok(SymmetricKey::parse(&self.byte.to_string().repeat(64))?)
        }
    }

    struct AuthenticatorFixture<'a> {
        secret: &'a str,
        backup_codes: &'a [&'a str],
    }
    impl AuthenticatorFixture<'_> {
        fn value(&self) -> anyhow::Result<SecretValue> {
            Ok(SecretValue::Authenticator(AuthenticatorSecret {
                issuer: "Example".to_owned(),
                account: "alice@example.com".to_owned(),
                website_url: String::new(),
                secret: TotpSecret::parse(self.secret)?,
                algorithm: TotpAlgorithm::Sha1,
                digits: TotpDigits::try_from(6)?,
                period: TotpPeriod::try_from(30)?,
                backup_codes: self.backup_codes.iter().map(ToString::to_string).collect(),
            }))
        }
    }

    #[test]
    fn fingerprints_are_vault_scoped_and_deterministic() -> anyhow::Result<()> {
        let value = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "correct horse".to_owned(),
            notes: "personal".to_owned(),
        });
        assert_eq!(
            value.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            value.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        assert_ne!(
            value.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            value.fingerprint(&(FingerprintKeyFixture { byte: 'b' }).key()?)
        );
        assert!(
            (value)
                .identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)?
                .as_str()
                .starts_with("hmac-sha256:v1:")
        );
        assert!(
            (value)
                .fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)?
                .is_current_secret_version()
        );
        assert!(
            !SecretFingerprint::from_trusted(format!("hmac-sha256:v1:{}", "ab".repeat(32)))
                .is_current_secret_version()
        );
        Ok(())
    }

    #[test]
    fn identity_ignores_password_and_provider_metadata() -> anyhow::Result<()> {
        let bitwarden = SecretValue::Login(LoginSecret {
            website_url: " https://example.com ".to_owned(),
            username: "alice".to_owned(),
            password: "old".to_owned(),
            notes: "shared note\n\n## Bitwarden\n- totp: abc".to_owned(),
        });
        let onepassword = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "new".to_owned(),
            notes: "shared note\n\n## 1Password\n- vault: Personal".to_owned(),
        });
        assert_eq!(
            bitwarden.identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            onepassword.identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn different_passwords_are_different_versions() -> anyhow::Result<()> {
        assert_ne!(
            (SecretValue::Login(LoginSecret {
                website_url: "https://example.com".to_owned(),
                username: "alice".to_owned(),
                password: "old".to_owned(),
                notes: String::new(),
            }))
            .fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            (SecretValue::Login(LoginSecret {
                website_url: "https://example.com".to_owned(),
                username: "alice".to_owned(),
                password: "new".to_owned(),
                notes: String::new(),
            }))
            .fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn login_versions_ignore_all_supported_importer_metadata() -> anyhow::Result<()> {
        let chrome = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "shared note\n\n## Browser password manager\n- name: Example".to_owned(),
        });
        let apple = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "shared note\n\n## Apple Passwords\n- title: Example".to_owned(),
        });

        assert_eq!(
            chrome.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            apple.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn meaningful_secure_note_changes_remain_distinct() -> anyhow::Result<()> {
        let first = SecretValue::SecureNote(SecureNoteSecret {
            title: "Recovery".to_owned(),
            note: "first".to_owned(),
        });
        let second = SecretValue::SecureNote(SecureNoteSecret {
            title: "Recovery".to_owned(),
            note: "second".to_owned(),
        });
        assert_ne!(
            first.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            second.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn login_only_import_markers_remain_meaningful_in_secure_notes() -> anyhow::Result<()> {
        let first = SecretValue::SecureNote(SecureNoteSecret {
            title: "Migration guide".to_owned(),
            note: "Steps\n\n## Apple Passwords\nUse the first export".to_owned(),
        });
        let second = SecretValue::SecureNote(SecureNoteSecret {
            title: "Migration guide".to_owned(),
            note: "Steps\n\n## Apple Passwords\nUse the second export".to_owned(),
        });

        assert_ne!(
            first.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            second.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn secure_note_versions_ignore_all_provider_metadata() -> anyhow::Result<()> {
        let providers = [
            "## Bitwarden\n- field.folder: Personal",
            "## 1Password\n- format: 1PUX\n- PIN: 1234",
            "## LastPass\n- group: Personal",
            "## Proton Pass\n- vault: Personal",
        ];
        let expected = (SecretValue::SecureNote(SecureNoteSecret {
            title: "Recovery".to_owned(),
            note: format!("same note\n\n{}", providers[0]),
        }))
        .fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?);

        for metadata in providers {
            let note = SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: format!("same note\n\n{metadata}"),
            });
            assert_eq!(
                note.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
                expected
            );
        }
        Ok(())
    }

    #[test]
    fn user_authored_provider_sections_remain_meaningful() -> anyhow::Result<()> {
        for heading in ["## LastPass", "## Proton Pass"] {
            let first = SecretValue::SecureNote(SecureNoteSecret {
                title: "Migration diary".to_owned(),
                note: format!("Notes\n\n{heading}\n- diary: first export"),
            });
            let second = SecretValue::SecureNote(SecureNoteSecret {
                title: "Migration diary".to_owned(),
                note: format!("Notes\n\n{heading}\n- diary: second export"),
            });

            assert_ne!(
                first.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
                second.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
            );
        }
        Ok(())
    }

    #[test]
    fn generated_metadata_after_a_user_provider_section_is_still_ignored() -> anyhow::Result<()> {
        let first = SecretValue::SecureNote(SecureNoteSecret {
            title: "Migration diary".to_owned(),
            note: "Notes\n\n## LastPass\n- diary: first export\n\n## LastPass\n- group: Personal"
                .to_owned(),
        });
        let second = SecretValue::SecureNote(SecureNoteSecret {
            title: "Migration diary".to_owned(),
            note: "Notes\n\n## LastPass\n- diary: first export\n\n## LastPass\n- group: Work"
                .to_owned(),
        });

        assert_eq!(
            first.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            second.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn authenticator_identity_excludes_secret_material() -> anyhow::Result<()> {
        let first = (AuthenticatorFixture {
            secret: "JBSWY3DPEHPK3PXP",
            backup_codes: &["alpha"],
        })
        .value()?;
        let second = (AuthenticatorFixture {
            secret: "KRSXG5DSNFXGOIDB",
            backup_codes: &["beta"],
        })
        .value()?;
        assert_eq!(
            first.identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            second.identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        assert_ne!(
            first.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            second.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn authenticator_backup_code_order_does_not_create_a_new_version() -> anyhow::Result<()> {
        assert_eq!(
            ((AuthenticatorFixture {
                secret: "JBSWY3DPEHPK3PXP",
                backup_codes: &["alpha", "beta"]
            })
            .value()?)
            .fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?),
            ((AuthenticatorFixture {
                secret: "JBSWY3DPEHPK3PXP",
                backup_codes: &["beta", "alpha"]
            })
            .value()?)
            .fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)
        );
        Ok(())
    }

    #[test]
    fn passkey_identity_is_stable_while_counter_updates_create_new_versions() -> anyhow::Result<()>
    {
        let registration = (PasskeyRegistrationRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: Engine::encode(&URL_SAFE_NO_PAD, [7_u8; 32]),
            relying_party: PasskeyRelyingParty {
                id: "example.com".to_owned(),
                name: "Example".to_owned(),
            },
            user: PasskeyUser {
                id: Engine::encode(&URL_SAFE_NO_PAD, [8_u8; 16]),
                name: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            algorithms: vec![-7],
            exclude_credentials: Vec::new(),
            resident_key_required: true,
            user_verification_required: true,
        })
        .prepare(&[])
        .and_then(CheckedPasskeyRegistration::generate)?;
        let first = SecretValue::Passkey(registration.credential);
        let first_identity =
            first.identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)?;
        let first_version = first.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)?;
        let mut updated = first;
        let SecretValue::Passkey(updated_passkey) = &mut updated else {
            unreachable!();
        };
        updated_passkey.signature_count = 1.into();

        assert_eq!(
            first_identity,
            updated.identity_fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)?
        );
        assert_ne!(
            first_version,
            updated.fingerprint(&(FingerprintKeyFixture { byte: 'a' }).key()?)?
        );
        Ok(())
    }

    #[test]
    fn matching_login_versions_merge_provider_fields() -> anyhow::Result<()> {
        let mut existing = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "note\n\n## Bitwarden\n- field.PIN: 1234".to_owned(),
        });
        let incoming = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "note\n\n## 1Password\n- Security.TOTP: abc".to_owned(),
        });
        assert_eq!(existing.enrich_with(&incoming), SecretEnrichment::Changed);
        let SecretValue::Login(merged) = &existing else {
            panic!("expected login");
        };
        assert!(merged.notes.contains("field.PIN: 1234"));
        assert!(merged.notes.contains("Security.TOTP: abc"));
        assert_eq!(merged.notes.matches("note").count(), 1);
        assert_eq!(existing.enrich_with(&incoming), SecretEnrichment::Unchanged);
        Ok(())
    }
}
