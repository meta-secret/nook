//! Whether a protected local identity belongs to the app it is used for.

use crate::AppId;
use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq)]
pub enum AppProtectionAppBinding {
    Matched,
    DifferentApp,
}

pub struct AppProtectionAppBindingRequest<'a> {
    pub observed: &'a AppId,
    pub expected: &'a AppId,
}

impl AppProtectionAppBindingRequest<'_> {
    #[must_use]
    pub fn classify(self) -> AppProtectionAppBinding {
        match self.observed.cmp(self.expected) {
            Ordering::Equal => AppProtectionAppBinding::Matched,
            Ordering::Less | Ordering::Greater => AppProtectionAppBinding::DifferentApp,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppKey;

    #[test]
    fn app_binding_names_matching_and_foreign_app_outcomes() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let foreign = AppKey::generate()?;
        assert_eq!(
            AppProtectionAppBindingRequest {
                observed: app.app_id(),
                expected: app.app_id()
            }
            .classify(),
            AppProtectionAppBinding::Matched
        );
        assert_eq!(
            AppProtectionAppBindingRequest {
                observed: app.app_id(),
                expected: foreign.app_id()
            }
            .classify(),
            AppProtectionAppBinding::DifferentApp
        );
        Ok(())
    }
}
