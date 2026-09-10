//! Optional wire labels retain explicit unnamed membership in the domain.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum MemberLabelState {
    Named(String),
    #[default]
    Unnamed,
}

impl MemberLabelState {
    pub fn is_unnamed(&self) -> bool {
        matches!(self, Self::Unnamed)
    }
    pub fn into_display_text(self) -> String {
        match self {
            Self::Named(label) => label,
            Self::Unnamed => String::new(),
        }
    }
}
