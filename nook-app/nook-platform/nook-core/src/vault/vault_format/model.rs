/// On-disk vault serialization format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultFormat {
    Yaml,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultStoreIdentity {
    Unassigned,
    Assigned(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultStoreIdentityRef<'a> {
    Unassigned,
    Assigned(&'a str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultName {
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
    Version(u64),
}

impl VaultFormat {
    #[must_use]
    pub fn from_path(path: &str) -> Self {
        let _ = path;
        Self::Yaml
    }
}
