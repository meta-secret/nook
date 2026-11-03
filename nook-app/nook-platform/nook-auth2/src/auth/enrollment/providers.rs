#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! The sync providers one invite carries, and the credential each one hands
//! the joiner.
use super::EnrollmentProvider;
use crate::errors::{EnrollmentError, EnrollmentResult};
use serde::{Deserialize, Serialize};
use std::iter;

/// The sync providers an invite carries, in the inviter's order: at least
/// one by its type. On the wire it is a JSON array; an empty one is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "Vec<EnrollmentProvider>", into = "Vec<EnrollmentProvider>")]
pub struct EnrollmentProviders {
    first: EnrollmentProvider,
    rest: Vec<EnrollmentProvider>,
}

impl EnrollmentProviders {
    #[must_use]
    pub const fn new(first: EnrollmentProvider, rest: Vec<EnrollmentProvider>) -> Self {
        Self { first, rest }
    }

    #[must_use]
    pub const fn single(first: EnrollmentProvider) -> Self {
        Self::new(first, Vec::new())
    }

    #[must_use]
    pub const fn first(&self) -> &EnrollmentProvider {
        &self.first
    }

    /// Every provider, the first one first.
    pub fn iter(&self) -> impl Iterator<Item = &EnrollmentProvider> {
        iter::once(&self.first).chain(self.rest.iter())
    }

    pub(super) fn validate(&self) -> EnrollmentResult<()> {
        self.iter().try_for_each(EnrollmentProvider::validate)
    }
}

/// A list with no provider names no way in: it is refused.
impl TryFrom<Vec<EnrollmentProvider>> for EnrollmentProviders {
    type Error = EnrollmentError;
    fn try_from(providers: Vec<EnrollmentProvider>) -> EnrollmentResult<Self> {
        let mut providers = providers.into_iter();
        match providers.next() {
            Some(first) => Ok(Self::new(first, providers.collect())),
            None => Err(EnrollmentError::MissingProviderDetails),
        }
    }
}

impl From<EnrollmentProviders> for Vec<EnrollmentProvider> {
    fn from(providers: EnrollmentProviders) -> Self {
        let EnrollmentProviders { first, mut rest } = providers;
        rest.insert(0, first);
        rest
    }
}

#[cfg(test)]
mod tests {
    use super::EnrollmentProviders;
    use crate::auth::enrollment::{
        EnrollmentProvider, GithubEnrollmentToken, PersonalEnrollmentProvider,
        S3EnrollmentConnection, S3EnrollmentKey, S3EnrollmentLocation, SharedEnrollmentProvider,
    };
    use crate::{EnrollmentError, ProviderSecretText, S3KeyPrefix};
    use serde_json::json;

    const S3_TEST_SECRET: &str = "TEST-ONLY-device-a-secret-not-real";
    const GITHUB_TEST_TOKEN: &str = "github_pat_TEST-ONLY-not-real";

    impl S3EnrollmentLocation {
        fn fixture() -> Self {
            Self {
                endpoint: "http://127.0.0.1:8333".to_owned(),
                region: "us-east-1".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: S3KeyPrefix::BucketRoot,
            }
        }
    }

    impl S3EnrollmentKey {
        fn included_fixture() -> anyhow::Result<Self> {
            Ok(Self::Included {
                access_key_id: "device-a".to_owned(),
                secret_access_key: ProviderSecretText::try_from(S3_TEST_SECRET.to_owned())?,
            })
        }

        fn provider(self) -> EnrollmentProvider {
            EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                location: S3EnrollmentLocation::fixture(),
                key: self,
            }))
        }
    }

    impl GithubEnrollmentToken {
        fn included_fixture() -> anyhow::Result<Self> {
            Ok(Self::Included {
                pat: ProviderSecretText::try_from(GITHUB_TEST_TOKEN.to_owned())?,
            })
        }

        fn provider(self) -> EnrollmentProvider {
            EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                self,
                "team-vault".to_owned(),
            ))
        }
    }

    fn every_credential_variant() -> anyhow::Result<Vec<EnrollmentProvider>> {
        Ok(vec![
            S3EnrollmentKey::included_fixture()?.provider(),
            S3EnrollmentKey::JoinerProvides.provider(),
            GithubEnrollmentToken::included_fixture()?.provider(),
            GithubEnrollmentToken::JoinerProvides.provider(),
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "folder-1".to_owned(),
            )),
        ])
    }

    #[test]
    fn a_list_of_every_credential_variant_round_trips_in_order() -> anyhow::Result<()> {
        let providers = EnrollmentProviders::try_from(every_credential_variant()?)?;
        providers.validate()?;
        let wire = serde_json::to_value(&providers)?;
        assert_eq!(wire.as_array().map(Vec::len), Some(5));
        let read: EnrollmentProviders = serde_json::from_value(wire)?;
        assert_eq!(read, providers);
        assert_eq!(
            read.iter().cloned().collect::<Vec<_>>(),
            every_credential_variant()?
        );
        assert_eq!(
            read.first(),
            &S3EnrollmentKey::included_fixture()?.provider()
        );
        // No variant prints a secret.
        let printed = format!("{providers:?}");
        assert!(!printed.contains(S3_TEST_SECRET));
        assert!(!printed.contains(GITHUB_TEST_TOKEN));
        Ok(())
    }

    #[test]
    fn an_empty_list_is_refused() {
        assert!(matches!(
            EnrollmentProviders::try_from(Vec::new()),
            Err(EnrollmentError::MissingProviderDetails)
        ));
        assert!(serde_json::from_value::<EnrollmentProviders>(json!([])).is_err());
        assert!(serde_json::from_value::<EnrollmentProviders>(json!({})).is_err());
    }

    #[test]
    fn each_provider_in_the_list_is_validated() {
        let blank_repo = EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
            GithubEnrollmentToken::JoinerProvides,
            String::new(),
        ));
        let providers =
            EnrollmentProviders::new(S3EnrollmentKey::JoinerProvides.provider(), vec![blank_repo]);
        assert!(matches!(
            providers.validate(),
            Err(EnrollmentError::MalformedGithubProvider)
        ));
    }

    #[test]
    fn an_s3_invite_names_its_location_and_its_key_choice() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::to_value(S3EnrollmentKey::included_fixture()?.provider())?,
            json!({
                "onboardingType": "personal-credential-transfer",
                "provider": {
                    "type": "s3",
                    "location": {
                        "endpoint": "http://127.0.0.1:8333",
                        "region": "us-east-1",
                        "bucket": "nook-dev",
                        "key_prefix": { "state": "bucketRoot" },
                    },
                    "key": {
                        "state": "included",
                        "access_key_id": "device-a",
                        "secret_access_key": S3_TEST_SECRET,
                    },
                }
            })
        );
        let joiner = S3EnrollmentKey::JoinerProvides.provider();
        let wire = serde_json::to_value(&joiner)?;
        assert_eq!(
            wire.pointer("/provider/key"),
            Some(&json!({ "state": "joiner_provides" }))
        );
        assert_eq!(serde_json::from_value::<EnrollmentProvider>(wire)?, joiner);
        // A blank secret names no key: such a code fails to decode.
        let mut blank_secret =
            serde_json::to_value(S3EnrollmentKey::included_fixture()?.provider())?;
        if let Some(secret) = blank_secret.pointer_mut("/provider/key/secret_access_key") {
            *secret = json!(" ");
        }
        assert!(serde_json::from_value::<EnrollmentProvider>(blank_secret).is_err());
        // The prefix is a named state: a bare string or a damaged path is refused.
        for damaged in [json!(""), json!({ "state": "prefix", "value": "team/" })] {
            let mut wire = serde_json::to_value(&joiner)?;
            if let Some(prefix) = wire.pointer_mut("/provider/location/key_prefix") {
                *prefix = damaged;
            }
            assert!(serde_json::from_value::<EnrollmentProvider>(wire).is_err());
        }
        // A shared grant never carries a personal S3 connection.
        let shared = json!({
            "onboardingType": "shared-provider-grant",
            "provider": { "type": "s3", "location": {}, "key": { "state": "joiner_provides" } }
        });
        assert!(serde_json::from_value::<EnrollmentProvider>(shared).is_err());
        Ok(())
    }

    #[test]
    fn an_s3_invite_needs_its_location_and_an_included_key_id() -> anyhow::Result<()> {
        S3EnrollmentKey::included_fixture()?.provider().validate()?;
        S3EnrollmentKey::JoinerProvides.provider().validate()?;
        let blanks: [fn(&mut S3EnrollmentConnection); 4] = [
            |connection| connection.location.endpoint = " ".to_owned(),
            |connection| connection.location.region = String::new(),
            |connection| connection.location.bucket = "\t".to_owned(),
            |connection| {
                if let S3EnrollmentKey::Included { access_key_id, .. } = &mut connection.key {
                    access_key_id.clear();
                }
            },
        ];
        for blank in blanks {
            let mut connection = S3EnrollmentConnection {
                location: S3EnrollmentLocation::fixture(),
                key: S3EnrollmentKey::included_fixture()?,
            };
            blank(&mut connection);
            let provider = EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(connection));
            assert!(matches!(
                provider.validate(),
                Err(EnrollmentError::MalformedS3Provider)
            ));
        }
        Ok(())
    }

    #[test]
    fn a_github_invite_carries_a_token_or_leaves_it_to_the_joiner() -> anyhow::Result<()> {
        let included = GithubEnrollmentToken::included_fixture()?.provider();
        assert_eq!(
            serde_json::to_value(&included)?,
            json!({
                "onboardingType": "personal-credential-transfer",
                "provider": {
                    "type": "github",
                    "token": { "state": "included", "pat": GITHUB_TEST_TOKEN },
                    "repo": "team-vault",
                }
            })
        );
        let joiner = GithubEnrollmentToken::JoinerProvides.provider();
        let wire = serde_json::to_value(&joiner)?;
        assert!(!wire.to_string().contains("pat"));
        assert_eq!(serde_json::from_value::<EnrollmentProvider>(wire)?, joiner);
        // A token the inviter chose is never blank.
        let blank = json!({
            "onboardingType": "personal-credential-transfer",
            "provider": {
                "type": "github",
                "token": { "state": "included", "pat": "" },
                "repo": "team-vault",
            }
        });
        assert!(serde_json::from_value::<EnrollmentProvider>(blank).is_err());
        Ok(())
    }
}
