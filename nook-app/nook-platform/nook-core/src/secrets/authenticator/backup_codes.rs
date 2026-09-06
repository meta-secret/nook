#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ValidationError;
use nook_authenticator_domain::BackupCodeAttachMode;
use std::mem;
use zeroize::Zeroizing;

/// Maximum recovery codes accepted on a single authenticator item.
pub const MAX_AUTHENTICATOR_BACKUP_CODES: usize = 64;
/// Maximum Unicode scalar count for one recovery code.
pub const MAX_AUTHENTICATOR_BACKUP_CODE_LEN: usize = 64;

/// Borrowed recovery codes awaiting normalization; no enrollment bounds are implied.
pub struct BackupCodeInput<'a> {
    codes: &'a [String],
}

impl<'a> BackupCodeInput<'a> {
    #[must_use]
    pub fn new(codes: &'a [String]) -> Self {
        Self { codes }
    }

    /// Trim, drop empties, and dedupe without enforcing enrollment bounds.
    #[must_use]
    pub(super) fn soft_normalized(&self) -> Vec<String> {
        let codes = self.codes;
        let mut normalized = Vec::new();
        for code in codes {
            let trimmed = code.trim();
            if !trimmed.is_empty() && !normalized.iter().any(|existing| existing == trimmed) {
                normalized.push(trimmed.to_owned());
            }
        }
        normalized
    }

    /// Normalize recovery codes and reject oversized values or sets.
    pub fn normalize(&self) -> Result<Vec<String>, ValidationError> {
        let mut normalized = Zeroizing::new(self.soft_normalized());
        if normalized.len() > MAX_AUTHENTICATOR_BACKUP_CODES {
            return Err(ValidationError::AuthenticatorBackupCodesInvalid);
        }
        for code in normalized.iter() {
            if code.chars().count() > MAX_AUTHENTICATOR_BACKUP_CODE_LEN {
                return Err(ValidationError::AuthenticatorBackupCodesInvalid);
            }
        }
        Ok(mem::take(&mut *normalized))
    }
}

/// The existing set, reviewed input, and selected attachment policy.
pub struct BackupCodeApplication<'a> {
    pub existing: &'a [String],
    pub incoming: &'a [String],
    pub mode: BackupCodeAttachMode,
}

impl BackupCodeApplication<'_> {
    pub fn apply(self) -> Result<Vec<String>, ValidationError> {
        let mut incoming = Zeroizing::new(BackupCodeInput::new(self.incoming).normalize()?);
        match self.mode {
            BackupCodeAttachMode::Replace => Ok(mem::take(&mut *incoming)),
            BackupCodeAttachMode::Merge => {
                let mut combined =
                    Zeroizing::new(BackupCodeInput::new(self.existing).soft_normalized());
                combined.extend(mem::take(&mut *incoming));
                BackupCodeInput::new(&combined).normalize()
            }
        }
    }
}

/// Verify that encrypted persistence retained both the intended result and the reviewed input.
pub struct BackupCodePersistenceVerification<'a> {
    pub persisted: &'a [String],
    pub intended: &'a [String],
    pub reviewed: &'a [String],
    pub mode: BackupCodeAttachMode,
}

impl BackupCodePersistenceVerification<'_> {
    pub fn verify(&self) -> Result<(), ValidationError> {
        let verification = self;
        if verification.persisted != verification.intended {
            return Err(ValidationError::AuthenticatorBackupCodesInvalid);
        }
        let reviewed_matches = match verification.mode {
            BackupCodeAttachMode::Replace => verification.persisted == verification.reviewed,
            BackupCodeAttachMode::Merge => verification
                .reviewed
                .iter()
                .all(|code| verification.persisted.contains(code)),
        };
        if reviewed_matches {
            Ok(())
        } else {
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BackupCodeApplication, BackupCodeInput, BackupCodePersistenceVerification,
        MAX_AUTHENTICATOR_BACKUP_CODE_LEN, MAX_AUTHENTICATOR_BACKUP_CODES,
    };
    use crate::ValidationError;
    use nook_authenticator_domain::BackupCodeAttachMode;

    #[test]
    fn backup_code_replace_and_merge_enforce_bounds() -> anyhow::Result<()> {
        let existing = vec!["keep-me".to_owned(), "old-code".to_owned()];
        let incoming = vec![
            "  new-code ".to_owned(),
            "keep-me".to_owned(),
            String::new(),
        ];
        assert_eq!(
            BackupCodeApplication {
                existing: &existing,
                incoming: &incoming,
                mode: BackupCodeAttachMode::Replace
            }
            .apply()?,
            ["new-code", "keep-me"]
        );
        assert_eq!(
            BackupCodeApplication {
                existing: &existing,
                incoming: &incoming,
                mode: BackupCodeAttachMode::Merge
            }
            .apply()?,
            ["keep-me", "old-code", "new-code"]
        );

        let too_long = vec!["a".repeat(MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1)];
        assert!(BackupCodeInput::new(&too_long).normalize().is_err());
        let too_many = (0..=MAX_AUTHENTICATOR_BACKUP_CODES)
            .map(|index| format!("code-{index}"))
            .collect::<Vec<_>>();
        assert!(BackupCodeInput::new(&too_many).normalize().is_err());
        assert!(BackupCodeAttachMode::parse("append").is_err());

        let persisted = vec!["old-code".to_owned(), "new-code".to_owned()];
        assert!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &["new-code".to_owned()],
                mode: BackupCodeAttachMode::Merge,
            }
            .verify()
            .is_ok()
        );
        assert!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &["wrong-code".to_owned()],
                mode: BackupCodeAttachMode::Merge,
            }
            .verify()
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn normalization_preserves_first_occurrence_case_and_unicode() -> anyhow::Result<()> {
        let codes = vec![
            " A ".to_owned(),
            "a".to_owned(),
            "A".to_owned(),
            "\u{2003}".to_owned(),
            " 密碼 ".to_owned(),
        ];
        assert_eq!(
            BackupCodeInput::new(&codes).normalize()?,
            ["A", "a", "密碼"]
        );
        assert_eq!(codes[0], " A ");
        Ok(())
    }

    #[test]
    fn bounds_apply_after_deduplication_and_count_unicode_scalars() -> anyhow::Result<()> {
        let code = "密".repeat(MAX_AUTHENTICATOR_BACKUP_CODE_LEN);
        let duplicates = vec![code.clone(); MAX_AUTHENTICATOR_BACKUP_CODES + 1];
        assert_eq!(BackupCodeInput::new(&duplicates).normalize()?, [code]);
        let too_long = vec!["密".repeat(MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1)];
        assert!(matches!(
            BackupCodeInput::new(&too_long).normalize(),
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        ));
        let at_limit = (0..MAX_AUTHENTICATOR_BACKUP_CODES)
            .map(|index| format!("code-{index}"))
            .collect::<Vec<_>>();
        assert_eq!(BackupCodeInput::new(&at_limit).normalize()?, at_limit);
        Ok(())
    }

    #[test]
    fn soft_normalization_keeps_oversized_legacy_codes() {
        let codes = vec!["x".repeat(MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1)];
        let input = BackupCodeInput::new(&codes);
        assert_eq!(input.soft_normalized(), codes);
        assert!(matches!(
            input.normalize(),
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        ));
        assert_eq!(codes[0].len(), MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1);
    }

    #[test]
    fn replace_ignores_invalid_legacy_values_but_merge_checks_the_union() -> anyhow::Result<()> {
        let existing = vec!["x".repeat(MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1)];
        let incoming = vec![" valid ".to_owned()];
        assert_eq!(
            BackupCodeApplication {
                existing: &existing,
                incoming: &incoming,
                mode: BackupCodeAttachMode::Replace
            }
            .apply()?,
            ["valid"]
        );
        assert!(matches!(
            BackupCodeApplication {
                existing: &existing,
                incoming: &incoming,
                mode: BackupCodeAttachMode::Merge
            }
            .apply(),
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        ));
        assert_eq!(existing[0].len(), MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1);
        assert_eq!(incoming, [" valid "]);
        Ok(())
    }

    #[test]
    fn verification_requires_exact_intended_order_even_for_merge() {
        let persisted = vec!["a".to_owned(), "b".to_owned()];
        let reversed = vec!["b".to_owned(), "a".to_owned()];
        assert!(matches!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &reversed,
                reviewed: &persisted,
                mode: BackupCodeAttachMode::Merge
            }
            .verify(),
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        ));
        assert!(matches!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &reversed,
                mode: BackupCodeAttachMode::Replace
            }
            .verify(),
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        ));
        assert!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &reversed,
                mode: BackupCodeAttachMode::Merge
            }
            .verify()
            .is_ok()
        );
    }

    #[test]
    fn empty_review_does_not_bypass_intended_equality() {
        let persisted = vec!["a".to_owned()];
        assert!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &[],
                mode: BackupCodeAttachMode::Merge
            }
            .verify()
            .is_ok()
        );
        assert!(matches!(
            BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &[],
                reviewed: &[],
                mode: BackupCodeAttachMode::Merge
            }
            .verify(),
            Err(ValidationError::AuthenticatorBackupCodesInvalid)
        ));
        assert!(
            BackupCodeApplication {
                existing: &persisted,
                incoming: &[],
                mode: BackupCodeAttachMode::Replace
            }
            .apply()
            .is_ok_and(|codes| codes.is_empty())
        );
    }
}
