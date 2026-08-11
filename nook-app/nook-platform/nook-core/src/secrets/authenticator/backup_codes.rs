use crate::ValidationError;
use nook_authenticator_domain::BackupCodeAttachMode;

/// Maximum recovery codes accepted on a single authenticator item.
pub const MAX_AUTHENTICATOR_BACKUP_CODES: usize = 64;
/// Maximum Unicode scalar count for one recovery code.
pub const MAX_AUTHENTICATOR_BACKUP_CODE_LEN: usize = 64;

/// Trim, drop empties, and dedupe recovery codes without enforcing enrollment bounds.
pub(super) fn soft_normalize_backup_codes(codes: &[String]) -> Vec<String> {
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
pub fn normalize_backup_codes(codes: &[String]) -> Result<Vec<String>, ValidationError> {
    let normalized = soft_normalize_backup_codes(codes);
    if normalized.len() > MAX_AUTHENTICATOR_BACKUP_CODES {
        return Err(ValidationError::AuthenticatorBackupCodesInvalid);
    }
    for code in &normalized {
        if code.chars().count() > MAX_AUTHENTICATOR_BACKUP_CODE_LEN {
            return Err(ValidationError::AuthenticatorBackupCodesInvalid);
        }
    }
    Ok(normalized)
}

/// Apply a confirmed recovery-code set with replace or merge semantics.
pub fn apply_backup_codes(
    existing: &[String],
    incoming: &[String],
    mode: BackupCodeAttachMode,
) -> Result<Vec<String>, ValidationError> {
    let incoming = normalize_backup_codes(incoming)?;
    match mode {
        BackupCodeAttachMode::Replace => Ok(incoming),
        BackupCodeAttachMode::Merge => {
            let mut combined = soft_normalize_backup_codes(existing);
            combined.extend(incoming);
            normalize_backup_codes(&combined)
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

pub fn verify_persisted_backup_codes(
    verification: &BackupCodePersistenceVerification<'_>,
) -> Result<(), ValidationError> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_code_replace_and_merge_enforce_bounds() -> anyhow::Result<()> {
        let existing = vec!["keep-me".to_owned(), "old-code".to_owned()];
        let incoming = vec![
            "  new-code ".to_owned(),
            "keep-me".to_owned(),
            String::new(),
        ];
        assert_eq!(
            apply_backup_codes(&existing, &incoming, BackupCodeAttachMode::Replace)?,
            ["new-code", "keep-me"]
        );
        assert_eq!(
            apply_backup_codes(&existing, &incoming, BackupCodeAttachMode::Merge)?,
            ["keep-me", "old-code", "new-code"]
        );

        let too_long = vec!["a".repeat(MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1)];
        assert!(normalize_backup_codes(&too_long).is_err());
        let too_many = (0..=MAX_AUTHENTICATOR_BACKUP_CODES)
            .map(|index| format!("code-{index}"))
            .collect::<Vec<_>>();
        assert!(normalize_backup_codes(&too_many).is_err());
        assert!(BackupCodeAttachMode::parse("append").is_err());

        let persisted = vec!["old-code".to_owned(), "new-code".to_owned()];
        assert!(
            verify_persisted_backup_codes(&BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &["new-code".to_owned()],
                mode: BackupCodeAttachMode::Merge,
            },)
            .is_ok()
        );
        assert!(
            verify_persisted_backup_codes(&BackupCodePersistenceVerification {
                persisted: &persisted,
                intended: &persisted,
                reviewed: &["wrong-code".to_owned()],
                mode: BackupCodeAttachMode::Merge,
            },)
            .is_err()
        );
        Ok(())
    }
}
