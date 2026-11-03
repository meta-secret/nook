#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! An S3 provider row's connection and what the store derives from it.
//!
//! The row holds one [`S3Connection`]: the location, this device's access
//! key, and the spare keys saved for invites. Every secret access key is
//! sealed to the device key at rest exactly like a GitHub token; while the row
//! is open in memory it holds the plaintext. Only the row's own key reaches
//! its storage connection; a spare key leaves the row only inside an invite.

use std::iter;

use nook_event_log::{IdentityMountTarget, S3MountTarget};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    ProviderSecretText, S3AccessKey, S3Connection, S3DraftField, S3DraftFieldError,
    S3EnrollmentKey, S3EnrollmentLocation, S3KeyDraft, S3Location, StorageProvider, StoredProvider,
};

/// What saving a spare key on an S3 row did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum S3SpareKeyAddition {
    /// The row with the key saved after its other spares.
    Added { provider: Box<StorageProvider> },
    /// Each wrong field once, in form order.
    Invalid { fields: Vec<S3DraftFieldError> },
}

/// A spare key typed for a saved S3 row.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3SpareKeyRequest {
    pub provider: StorageProvider,
    pub key: S3KeyDraft,
}

/// A spare key to remove from a saved S3 row, by its id.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3SpareKeyRemoval {
    pub provider: StorageProvider,
    pub access_key_id: String,
}

impl S3SpareKeyRequest {
    /// Validate the key as the setup form validates one, refuse a key the
    /// row saves already, and keep it as the row's last spare.
    pub fn add(self) -> ValidationResult<S3SpareKeyAddition> {
        let Self { mut provider, key } = self;
        let StoredProvider::S3(connection) = &mut provider.provider else {
            return Err(ValidationError::S3StorageTargetInvalid);
        };
        let Ok((access_key_id, secret_access_key)) = key.parse() else {
            return Ok(S3SpareKeyAddition::Invalid {
                fields: key.field_errors(),
            });
        };
        if connection.saves_key(&access_key_id) {
            return Ok(S3SpareKeyAddition::Invalid {
                fields: vec![S3DraftFieldError {
                    field: S3DraftField::AccessKeyId,
                    error_key: ValidationError::S3AccessKeyIdDuplicate.to_string(),
                }],
            });
        }
        connection.spare_keys.push(S3AccessKey {
            access_key_id,
            secret_access_key,
        });
        Ok(S3SpareKeyAddition::Added {
            provider: Box::new(provider),
        })
    }
}

impl S3SpareKeyRemoval {
    /// The row without that spare. The key this device signs with is not a
    /// spare and stays.
    pub fn remove(self) -> ValidationResult<StorageProvider> {
        let Self {
            mut provider,
            access_key_id,
        } = self;
        let StoredProvider::S3(connection) = &mut provider.provider else {
            return Err(ValidationError::S3StorageTargetInvalid);
        };
        connection
            .spare_keys
            .retain(|spare| spare.access_key_id != access_key_id.trim());
        Ok(provider)
    }
}

impl S3Connection {
    /// Where the row's objects live, as its label shows it: the bucket and
    /// the key prefix below it.
    #[must_use]
    pub fn location_label(&self) -> String {
        self.key_prefix.below(&self.bucket)
    }

    /// `S3 · bucket[/prefix]`.
    #[must_use]
    pub fn label(&self) -> String {
        format!("S3 · {}", self.location_label())
    }

    /// The row's detail line: the host it talks to and the key it uses.
    #[must_use]
    pub fn storage_detail(&self) -> String {
        let host = match self.endpoint.split_once("://") {
            Some((_, host)) => host,
            None => self.endpoint.as_str(),
        };
        format!("{host} · {}", self.access_key_id)
    }

    /// Where the row's objects live, without its key.
    #[must_use]
    pub fn location(&self) -> S3Location {
        S3Location {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
        }
    }

    /// The location an invite carries for this row, whoever adds the key.
    #[must_use]
    pub fn enrollment_location(&self) -> S3EnrollmentLocation {
        S3EnrollmentLocation {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
        }
    }

    /// Whether the row signs with this key id or saves it as a spare.
    fn saves_key(&self, access_key_id: &str) -> bool {
        self.access_key_id == access_key_id
            || self
                .spare_keys
                .iter()
                .any(|spare| spare.access_key_id == access_key_id)
    }

    /// A saved spare key, as an invite carrying it holds it.
    pub fn spare_enrollment_key(&self, access_key_id: &str) -> ValidationResult<S3EnrollmentKey> {
        self.spare_keys
            .iter()
            .find(|spare| spare.access_key_id == access_key_id.trim())
            .map(|spare| S3EnrollmentKey::Included {
                access_key_id: spare.access_key_id.clone(),
                secret_access_key: spare.secret_access_key.clone(),
            })
            .ok_or(ValidationError::S3AccessKeyNotSaved)
    }

    /// The connection a storage request signs with: the row's own key and
    /// none of its spares.
    #[must_use]
    pub fn signing_connection(&self) -> Self {
        Self {
            spare_keys: Vec::new(),
            ..self.clone()
        }
    }

    /// Every secret the row holds: its own key's, then each spare's.
    pub(crate) fn secrets(&self) -> Vec<&ProviderSecretText> {
        iter::once(&self.secret_access_key)
            .chain(self.spare_keys.iter().map(|spare| &spare.secret_access_key))
            .collect()
    }

    /// This row's own key, as an invite carrying the inviter's key holds it:
    /// the plaintext secret, encrypted by the invite's passphrase as the
    /// GitHub token is.
    #[must_use]
    pub fn enrollment_key(&self) -> S3EnrollmentKey {
        S3EnrollmentKey::Included {
            access_key_id: self.access_key_id.clone(),
            secret_access_key: self.secret_access_key.clone(),
        }
    }

    /// Where the objects live, without the key or the region that reach them.
    #[must_use]
    pub fn mount_location(&self) -> S3MountTarget {
        S3MountTarget {
            endpoint: self.endpoint.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
        }
    }

    /// The credential-free mount record of this location.
    #[must_use]
    pub fn mount_target(&self) -> IdentityMountTarget {
        IdentityMountTarget::S3(self.mount_location())
    }

    pub(crate) fn transition_secrets<E>(
        &self,
        mut transition: impl FnMut(&ProviderSecretText) -> Result<ProviderSecretText, E>,
    ) -> Result<Self, E> {
        Ok(Self {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
            access_key_id: self.access_key_id.clone(),
            secret_access_key: transition(&self.secret_access_key)?,
            spare_keys: self
                .spare_keys
                .iter()
                .map(|spare| {
                    Ok(S3AccessKey {
                        access_key_id: spare.access_key_id.clone(),
                        secret_access_key: transition(&spare.secret_access_key)?,
                    })
                })
                .collect::<Result<_, E>>()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{S3SpareKeyAddition, S3SpareKeyRemoval, S3SpareKeyRequest};
    use crate::errors::ValidationError;
    use crate::{
        ProviderSecretText, S3Connection, S3DraftField, S3EnrollmentKey, S3KeyDraft, S3KeyPrefix,
        StorageProvider, StoredProvider,
    };

    const SPARE_SECRET: &str = "TEST-ONLY-device-b-secret";

    fn spare(access_key_id: &str, secret: &str) -> S3KeyDraft {
        S3KeyDraft {
            access_key_id: access_key_id.to_owned(),
            secret_access_key: secret.to_owned(),
        }
    }

    fn add(provider: StorageProvider, key: S3KeyDraft) -> anyhow::Result<StorageProvider> {
        match (S3SpareKeyRequest { provider, key }).add()? {
            S3SpareKeyAddition::Added { provider } => Ok(*provider),
            S3SpareKeyAddition::Invalid { fields } => anyhow::bail!("refused: {fields:?}"),
        }
    }

    fn connection(provider: &StorageProvider) -> anyhow::Result<&S3Connection> {
        let StoredProvider::S3(connection) = &provider.provider else {
            anyhow::bail!("an S3 row");
        };
        Ok(connection)
    }

    #[test]
    fn a_spare_key_is_saved_beside_the_row_key_and_sealed_with_it() -> anyhow::Result<()> {
        let row = StorageProvider::fixture("s3", StoredProvider::s3_fixture()?);
        assert!(connection(&row)?.spare_keys.is_empty());
        let saved = add(row, spare(" device-b ", SPARE_SECRET))?;
        let spares = &connection(&saved)?.spare_keys;
        assert_eq!(spares.len(), 1);
        assert_eq!(
            spares.first().map(|key| key.access_key_id.as_str()),
            Some("device-b")
        );
        // The row's secret walk covers the spare, so sealing covers it too.
        let walked = saved
            .provider
            .secrets()
            .into_iter()
            .map(|secret| secret.expose().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(walked.len(), 2);
        assert!(walked.iter().any(|secret| secret == SPARE_SECRET));
        let sealed = saved.provider.transition_secrets(|secret| {
            ProviderSecretText::try_from(format!("sealed:{}", secret.expose().len()))
        })?;
        let StoredProvider::S3(sealed) = &sealed else {
            anyhow::bail!("an S3 row stays S3");
        };
        assert!(!format!("{sealed:?}").contains(SPARE_SECRET));
        assert!(
            sealed
                .spare_keys
                .iter()
                .all(|key| key.secret_access_key.expose().starts_with("sealed:"))
        );
        // A storage request signs with the row's own key alone.
        assert!(
            connection(&saved)?
                .signing_connection()
                .spare_keys
                .is_empty()
        );
        assert!(!format!("{saved:?}").contains(SPARE_SECRET));
        let wire = serde_json::to_value(&saved)?;
        assert_eq!(serde_json::from_value::<StorageProvider>(wire)?, saved);
        Ok(())
    }

    #[test]
    fn a_spare_key_is_validated_and_never_saved_twice() -> anyhow::Result<()> {
        let row = StorageProvider::fixture("s3", StoredProvider::s3_fixture()?);
        let refused = |provider: StorageProvider, key| -> anyhow::Result<Vec<S3DraftField>> {
            match (S3SpareKeyRequest { provider, key }).add()? {
                S3SpareKeyAddition::Invalid { fields } => {
                    Ok(fields.into_iter().map(|field| field.field).collect())
                }
                S3SpareKeyAddition::Added { .. } => anyhow::bail!("expected a refusal"),
            }
        };
        assert_eq!(
            refused(row.clone(), spare("", " "))?,
            vec![S3DraftField::AccessKeyId, S3DraftField::SecretAccessKey]
        );
        assert_eq!(
            refused(row.clone(), spare("device-a", SPARE_SECRET))?,
            vec![S3DraftField::AccessKeyId]
        );
        let saved = add(row, spare("device-b", SPARE_SECRET))?;
        assert_eq!(
            refused(saved, spare("device-b", "TEST-ONLY-other"))?,
            vec![S3DraftField::AccessKeyId]
        );
        let github = StorageProvider::fixture("gh", StoredProvider::github_fixture()?);
        assert!(matches!(
            (S3SpareKeyRequest {
                provider: github,
                key: spare("device-b", SPARE_SECRET),
            })
            .add(),
            Err(ValidationError::S3StorageTargetInvalid)
        ));
        Ok(())
    }

    #[test]
    fn removing_a_spare_keeps_the_row_key_and_the_other_spares() -> anyhow::Result<()> {
        let row = StorageProvider::fixture("s3", StoredProvider::s3_fixture()?);
        let saved = add(
            add(row, spare("device-b", SPARE_SECRET))?,
            spare("device-c", "TEST-ONLY-device-c"),
        )?;
        let removed = (S3SpareKeyRemoval {
            provider: saved.clone(),
            access_key_id: "device-b".to_owned(),
        })
        .remove()?;
        let kept = connection(&removed)?;
        assert_eq!(kept.access_key_id, "device-a");
        assert_eq!(
            kept.spare_keys
                .iter()
                .map(|key| key.access_key_id.as_str())
                .collect::<Vec<_>>(),
            vec!["device-c"]
        );
        // The row's own key is not a spare: removing it changes nothing.
        let unchanged = (S3SpareKeyRemoval {
            provider: removed.clone(),
            access_key_id: "device-a".to_owned(),
        })
        .remove()?;
        assert_eq!(unchanged, removed);
        // An invite reads a spare by its id, and only a saved one.
        let StoredProvider::S3(saved_connection) = &saved.provider else {
            anyhow::bail!("an S3 row");
        };
        assert!(matches!(
            saved_connection.spare_enrollment_key("device-b")?,
            S3EnrollmentKey::Included { access_key_id, .. } if access_key_id == "device-b"
        ));
        assert_eq!(
            kept.spare_enrollment_key("device-b"),
            Err(ValidationError::S3AccessKeyNotSaved)
        );
        Ok(())
    }

    #[test]
    fn an_s3_connection_names_its_label_detail_and_mount() -> anyhow::Result<()> {
        let mut connection = S3Connection::fixture()?;
        assert_eq!(connection.label(), "S3 · nook-dev/e2e/run-1");
        assert_eq!(connection.storage_detail(), "127.0.0.1:8333 · device-a");
        assert_eq!(
            connection.mount_location().location_identity(),
            connection.location_identity()
        );
        connection.key_prefix = S3KeyPrefix::BucketRoot;
        assert_eq!(connection.label(), "S3 · nook-dev");
        assert_eq!(
            connection.enrollment_location().key_prefix,
            S3KeyPrefix::BucketRoot
        );
        assert_eq!(connection.location().label(), connection.label());
        Ok(())
    }
}
