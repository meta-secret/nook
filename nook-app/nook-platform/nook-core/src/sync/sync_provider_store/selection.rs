//! Compatible provider selection retains the requested preference as domain policy.
use super::{ReplicationType, StorageProviderData};
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderId(String);
impl From<String> for ProviderId {
    fn from(value: String) -> Self {
        Self(value)
    }
}
impl From<&str> for ProviderId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}
impl ProviderId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProviderSelectionPolicy {
    FirstCompatible,
    Prefer(ProviderId),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProviderSelection {
    Unavailable,
    Selected(ProviderId),
}
pub struct ProviderSelectionRequest<'a> {
    pub providers: &'a [StorageProviderData],
    pub replication_type: ReplicationType,
    pub policy: ProviderSelectionPolicy,
}
impl ProviderSelectionRequest<'_> {
    #[must_use]
    pub fn select(self) -> ProviderSelection {
        let Self {
            providers,
            replication_type,
            policy,
        } = self;
        if let ProviderSelectionPolicy::Prefer(preferred_id) = policy
            && let Some(provider) = providers.iter().find(|provider| {
                provider.id == preferred_id.as_str()
                    && provider.supports_replication(replication_type)
            })
        {
            return ProviderSelection::Selected(provider.id.clone().into());
        }
        match providers
            .iter()
            .find(|provider| provider.supports_replication(replication_type))
        {
            Some(provider) => ProviderSelection::Selected(provider.id.clone().into()),
            None => ProviderSelection::Unavailable,
        }
    }
}
