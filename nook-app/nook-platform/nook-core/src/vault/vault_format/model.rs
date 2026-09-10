use serde::{Deserialize, Serialize};

/// On-disk vault serialization format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultFormat {
    Yaml,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum VaultStoreIdentity {
    #[default]
    Unassigned,
    Assigned(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultStoreIdentityRef<'a> {
    Unassigned,
    Assigned(&'a str),
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum VaultName {
    #[default]
    Unnamed,
    Named(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultNameRef<'a> {
    Unnamed,
    Named(&'a str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultVersionWrite {
    Initial,
    Version(crate::VaultVersion),
}

impl VaultFormat {
    #[must_use]
    pub fn from_path(path: &str) -> Self {
        let _ = path;
        Self::Yaml
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    #[test]
    fn format_from_path() {
        assert_eq!(
            VaultFormat::from_path("nook-events.yaml"),
            VaultFormat::Yaml
        );
        assert_eq!(
            VaultFormat::from_path("nook-events.backup"),
            VaultFormat::Yaml
        );
        assert_eq!(VaultFormat::from_path("nook-events.yml"), VaultFormat::Yaml);
        assert_eq!(
            VaultFormat::from_path("/data/user/nook-events.yaml"),
            VaultFormat::Yaml
        );
    }
}

impl VaultStoreIdentity {
    pub(super) fn is_unassigned(&self) -> bool {
        matches!(self, Self::Unassigned)
    }
}
impl VaultName {
    pub(super) fn is_unnamed(&self) -> bool {
        matches!(self, Self::Unnamed)
    }
}
