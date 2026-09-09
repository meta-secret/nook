//! English page-copy recognition. Literal phrases belong only to this lexical boundary;
//! callers receive semantic subjects, preservation actions, and candidate observations.
use crate::{AuthenticationBackupCodesObservation, AuthenticationControlText};

/// Non-secret evidence that candidate material exists; never carries the codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupCodeCandidatePresence {
    Absent,
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecoveryCodeSubject {
    Backup,
    Recovery,
    Emergency,
}
impl RecoveryCodeSubject {
    const ALL: [Self; 3] = [Self::Backup, Self::Recovery, Self::Emergency];
    fn singular_phrase(self) -> &'static str {
        match self {
            Self::Backup => "backup code",
            Self::Recovery => "recovery code",
            Self::Emergency => "emergency code",
        }
    }
    fn plural_phrase(self) -> &'static str {
        match self {
            Self::Backup => "backup codes",
            Self::Recovery => "recovery codes",
            Self::Emergency => "emergency codes",
        }
    }
    fn matches_hint(self, normalized: &str) -> bool {
        let text = AuthenticationControlText::new(normalized);
        text.contains_word_phrase(self.singular_phrase())
            || text.contains_word_phrase(self.plural_phrase())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreservationInstruction {
    Save,
    Store,
    Keep,
    Download,
    Print,
    Copy,
    Generated,
}
impl PreservationInstruction {
    const ALL: [Self; 7] = [
        Self::Save,
        Self::Store,
        Self::Keep,
        Self::Download,
        Self::Print,
        Self::Copy,
        Self::Generated,
    ];
    fn token(self) -> &'static str {
        match self {
            Self::Save => "save",
            Self::Store => "store",
            Self::Keep => "keep",
            Self::Download => "download",
            Self::Print => "print",
            Self::Copy => "copy",
            Self::Generated => "generated",
        }
    }
    fn matches(self, normalized: &str) -> bool {
        normalized
            .split(|character: char| !character.is_ascii_alphanumeric())
            .any(|token| token == self.token())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecoverySubjectObservation {
    Absent,
    Observed(RecoveryCodeSubject),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreservationObservation {
    Absent,
    Observed(PreservationInstruction),
}

pub(crate) struct RecoveryCopyRecognition {
    subject: RecoverySubjectObservation,
    preservation: PreservationObservation,
}
impl RecoveryCopyRecognition {
    pub(crate) fn from_text(text: &str) -> Self {
        let normalized = text.to_ascii_lowercase();
        // Recovery offers intentionally retain plural substring recognition. This
        // is distinct from the word-phrase boundary used to exclude prose candidates.
        let subject = match RecoveryCodeSubject::ALL
            .into_iter()
            .find(|subject| normalized.contains(subject.plural_phrase()))
        {
            Some(subject) => RecoverySubjectObservation::Observed(subject),
            None => RecoverySubjectObservation::Absent,
        };
        let preservation = match PreservationInstruction::ALL
            .into_iter()
            .find(|instruction| instruction.matches(&normalized))
        {
            Some(instruction) => PreservationObservation::Observed(instruction),
            None => PreservationObservation::Absent,
        };
        Self {
            subject,
            preservation,
        }
    }
    pub(crate) fn classify(
        self,
        candidates: BackupCodeCandidatePresence,
    ) -> AuthenticationBackupCodesObservation {
        match (self.subject, self.preservation, candidates) {
            (RecoverySubjectObservation::Absent, _, _) => {
                AuthenticationBackupCodesObservation::Absent
            }
            (RecoverySubjectObservation::Observed(_), PreservationObservation::Observed(_), _)
            | (
                RecoverySubjectObservation::Observed(_),
                PreservationObservation::Absent,
                BackupCodeCandidatePresence::Present,
            ) => AuthenticationBackupCodesObservation::Present,
            (
                RecoverySubjectObservation::Observed(_),
                PreservationObservation::Absent,
                BackupCodeCandidatePresence::Absent,
            ) => AuthenticationBackupCodesObservation::Absent,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthenticationCodeSubject {
    Recovery(RecoveryCodeSubject),
    OneTime,
    TwoFactor,
    MultiFactor,
    Authenticator,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthenticationCodeHint {
    Absent,
    Observed(AuthenticationCodeSubject),
}
impl AuthenticationCodeSubject {
    // Preserve the historical recognition priority, including one-time aliases.
    const ALL: [Self; 7] = [
        Self::Recovery(RecoveryCodeSubject::Backup),
        Self::Recovery(RecoveryCodeSubject::Recovery),
        Self::OneTime,
        Self::Recovery(RecoveryCodeSubject::Emergency),
        Self::TwoFactor,
        Self::MultiFactor,
        Self::Authenticator,
    ];
    fn matches_hint(self, normalized: &str) -> bool {
        let text = AuthenticationControlText::new(normalized);
        match self {
            Self::Recovery(subject) => subject.matches_hint(normalized),
            Self::OneTime => {
                text.contains_word_phrase("one-time code")
                    || text.contains_word_phrase("one-time codes")
                    || text.contains_word_phrase("one time code")
                    || text.contains_word_phrase("one time codes")
            }
            Self::TwoFactor => {
                text.contains_word_phrase("2fa code") || text.contains_word_phrase("2fa codes")
            }
            Self::MultiFactor => {
                text.contains_word_phrase("mfa code") || text.contains_word_phrase("mfa codes")
            }
            Self::Authenticator => {
                text.contains_word_phrase("authenticator code")
                    || text.contains_word_phrase("authenticator codes")
            }
        }
    }
    pub(crate) fn recognize_hint(text: &str) -> AuthenticationCodeHint {
        let normalized = text.to_ascii_lowercase();
        match Self::ALL
            .into_iter()
            .find(|subject| subject.matches_hint(&normalized))
        {
            Some(subject) => AuthenticationCodeHint::Observed(subject),
            None => AuthenticationCodeHint::Absent,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preservation_actions_have_whole_token_boundaries() {
        for instruction in PreservationInstruction::ALL {
            assert!(instruction.matches(&format!("({})!", instruction.token())));
            assert!(!instruction.matches(&format!("x{}x", instruction.token())));
        }
    }
    #[test]
    fn recovery_offers_keep_plural_substrings_and_candidate_assistance() {
        for subject in RecoveryCodeSubject::ALL {
            let copy =
                RecoveryCopyRecognition::from_text(&format!("SAVE {}", subject.plural_phrase()));
            assert_eq!(
                copy.classify(BackupCodeCandidatePresence::Absent),
                AuthenticationBackupCodesObservation::Present
            );
            assert_eq!(
                RecoveryCopyRecognition::from_text(subject.plural_phrase())
                    .classify(BackupCodeCandidatePresence::Present),
                AuthenticationBackupCodesObservation::Present
            );
            assert_eq!(
                RecoveryCopyRecognition::from_text(subject.plural_phrase())
                    .classify(BackupCodeCandidatePresence::Absent),
                AuthenticationBackupCodesObservation::Absent
            );
            assert_eq!(
                RecoveryCopyRecognition::from_text(&format!("save {}", subject.singular_phrase()))
                    .classify(BackupCodeCandidatePresence::Absent),
                AuthenticationBackupCodesObservation::Absent
            );
        }
    }
    #[test]
    fn general_code_hints_remain_broader_than_recovery_offers() {
        for phrase in [
            "one-time code",
            "one time codes",
            "2fa codes",
            "mfa code",
            "authenticator codes",
        ] {
            assert!(matches!(
                AuthenticationCodeSubject::recognize_hint(phrase),
                AuthenticationCodeHint::Observed(_)
            ));
            assert_eq!(
                RecoveryCopyRecognition::from_text(phrase)
                    .classify(BackupCodeCandidatePresence::Present),
                AuthenticationBackupCodesObservation::Absent
            );
        }
        assert_eq!(
            AuthenticationCodeSubject::recognize_hint("notbackup codessuffix"),
            AuthenticationCodeHint::Absent
        );
        // Offer recognition historically accepts plural substrings, unlike hints.
        assert_eq!(
            RecoveryCopyRecognition::from_text("save notbackup codessuffix")
                .classify(BackupCodeCandidatePresence::Absent),
            AuthenticationBackupCodesObservation::Present
        );
    }
}
