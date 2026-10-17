//! Failure reason categories read from the site's own visible message.
//!
//! The reading fails closed: unclear text, or text naming more than one
//! consequence (locked, rate limited, extra verification), is `Unknown`.
//! Credential wording is a cause, not a consequence: lock and rate-limit
//! messages routinely explain themselves with "failed password" attempts, so a
//! consequence category takes precedence over wrong-credential wording.

use serde::{Deserialize, Serialize};

use super::vocabulary::{SignInAttemptNormalizedText, SignInAttemptTermMatch, SignInAttemptTerms};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInFailureReason {
    WrongCredentials,
    AccountLocked,
    RateLimited,
    ChallengeRequired,
    Unknown,
}

/// The reason category plus whether any category vocabulary was present.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SignInFailureReasonReading {
    pub(crate) reason: SignInFailureReason,
    pub(crate) vocabulary: SignInAttemptTermMatch,
}

impl SignInFailureReason {
    /// Matched only at word starts, so "blocked", "unlocked", and
    /// "разблокировка" (unblocking) do not read as a lock.
    const ACCOUNT_LOCKED: SignInAttemptTerms = SignInAttemptTerms(&[
        "locked",
        "lockout",
        "lock out",
        "suspended",
        "deactivated",
        "account disabled",
        "account is disabled",
        "account has been disabled",
        "заблокирован",
        "блокировк",
        "приостановлен",
        "деактивирован",
    ]);
    const RATE_LIMITED: SignInAttemptTerms = SignInAttemptTerms(&[
        "too many",
        "rate limit",
        "rate-limit",
        "slow down",
        "слишком много",
        "слишком част",
    ]);
    const CHALLENGE_REQUIRED: SignInAttemptTerms = SignInAttemptTerms(&[
        "captcha",
        "security check",
        "verify it's you",
        "verify that it's you",
        "verify your identity",
        "confirm it's you",
        "confirm your identity",
        "verification required",
        "verification code",
        "additional verification",
        "two-factor",
        "two-step",
        "2-step",
        "2fa",
        "one-time code",
        "security code",
        "капч",
        "проверка безопасности",
        "подтвердите, что это вы",
        "подтвердите личность",
        "подтверждение входа",
        "код подтверждения",
        "двухфактор",
        "двухэтап",
        "одноразовый код",
    ]);
    const WRONG_CREDENTIALS: SignInAttemptTerms = SignInAttemptTerms(&[
        "incorrect",
        "invalid",
        "wrong password",
        "wrong username",
        "wrong user name",
        "wrong email",
        "wrong e-mail",
        "wrong login",
        "wrong credentials",
        "password is wrong",
        "username is wrong",
        "not match",
        "n't match",
        "not recognized",
        "not recognised",
        "unrecognized",
        "couldn't find your",
        "could not find your",
        "no account",
        "account not found",
        "user not found",
        "unknown user",
        "bad credentials",
        "неверн",
        "неправильн",
        "не совпада",
        "не найден",
        "не удалось найти",
        "не существует",
    ]);
}

impl From<&SignInAttemptNormalizedText> for SignInFailureReasonReading {
    fn from(text: &SignInAttemptNormalizedText) -> Self {
        use SignInAttemptTermMatch::{Matched, Unmatched};
        let locked = SignInFailureReason::ACCOUNT_LOCKED.find_word_start_in(text);
        let limited = SignInFailureReason::RATE_LIMITED.find_in(text);
        let challenge = SignInFailureReason::CHALLENGE_REQUIRED.find_in(text);
        let wrong = SignInFailureReason::WRONG_CREDENTIALS.find_in(text);
        // Exactly one consequence wins over credential wording; two conflict.
        let reason = match (locked, limited, challenge, wrong) {
            (Matched, Unmatched, Unmatched, Matched | Unmatched) => {
                SignInFailureReason::AccountLocked
            }
            (Unmatched, Matched, Unmatched, Matched | Unmatched) => {
                SignInFailureReason::RateLimited
            }
            (Unmatched, Unmatched, Matched, Matched | Unmatched) => {
                SignInFailureReason::ChallengeRequired
            }
            (Unmatched, Unmatched, Unmatched, Matched) => SignInFailureReason::WrongCredentials,
            (Unmatched, Unmatched, Unmatched, Unmatched)
            | (Matched, Matched, Matched | Unmatched, Matched | Unmatched)
            | (Matched, Unmatched, Matched, Matched | Unmatched)
            | (Unmatched, Matched, Matched, Matched | Unmatched) => SignInFailureReason::Unknown,
        };
        let vocabulary = match (locked, limited, challenge, wrong) {
            (Unmatched, Unmatched, Unmatched, Unmatched) => Unmatched,
            (Matched, Matched | Unmatched, Matched | Unmatched, Matched | Unmatched)
            | (Unmatched, Matched, Matched | Unmatched, Matched | Unmatched)
            | (Unmatched, Unmatched, Matched, Matched | Unmatched)
            | (Unmatched, Unmatched, Unmatched, Matched) => Matched,
        };
        Self { reason, vocabulary }
    }
}

#[cfg(test)]
mod tests {
    use super::{SignInFailureReason, SignInFailureReasonReading};
    use crate::sign_in_attempt::vocabulary::{SignInAttemptNormalizedText, SignInAttemptTermMatch};

    struct ReasonCase {
        text: &'static str,
        reason: SignInFailureReason,
    }

    impl ReasonCase {
        fn assert_reason(&self) {
            let reading =
                SignInFailureReasonReading::from(&SignInAttemptNormalizedText::from(self.text));
            assert_eq!(reading.reason, self.reason, "{}", self.text);
        }
    }

    #[test]
    fn namecheap_lock_banner_is_account_locked_despite_failed_password_wording() {
        ReasonCase {
            text: "Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use Password Reset option...",
            reason: SignInFailureReason::AccountLocked,
        }
        .assert_reason();
    }

    #[test]
    fn english_and_russian_vocabulary_select_one_category() {
        use SignInFailureReason::{
            AccountLocked, ChallengeRequired, RateLimited, WrongCredentials,
        };
        for case in [
            ReasonCase {
                text: "Incorrect username or password.",
                reason: WrongCredentials,
            },
            ReasonCase {
                text: "The email and password you entered don\u{2019}t match.",
                reason: WrongCredentials,
            },
            ReasonCase {
                text: "We couldn't find your account",
                reason: WrongCredentials,
            },
            ReasonCase {
                text: "Неверный логин или пароль",
                reason: WrongCredentials,
            },
            ReasonCase {
                text: "Аккаунт заблокирован",
                reason: AccountLocked,
            },
            ReasonCase {
                text: "Your account has been suspended",
                reason: AccountLocked,
            },
            ReasonCase {
                text: "Too many requests. Please try again later.",
                reason: RateLimited,
            },
            ReasonCase {
                text: "Слишком много попыток входа. Попробуйте позже.",
                reason: RateLimited,
            },
            ReasonCase {
                text: "Too many failed password attempts",
                reason: RateLimited,
            },
            ReasonCase {
                text: "Please complete the CAPTCHA",
                reason: ChallengeRequired,
            },
            ReasonCase {
                text: "Введите код подтверждения",
                reason: ChallengeRequired,
            },
        ] {
            case.assert_reason();
        }
    }

    #[test]
    fn timing_advice_alone_is_not_rate_limiting_and_lock_stems_are_word_bounded() {
        use SignInFailureReason::{AccountLocked, Unknown};
        for case in [
            ReasonCase {
                text: "Something went wrong. Please try again later.",
                reason: Unknown,
            },
            ReasonCase {
                text: "Account locked. Try again in 30 minutes.",
                reason: AccountLocked,
            },
            ReasonCase {
                text: "Произошла ошибка. Попробуйте позже.",
                reason: Unknown,
            },
            ReasonCase {
                text: "Your account was unlocked",
                reason: Unknown,
            },
            ReasonCase {
                text: "Pop-up blocked by your browser",
                reason: Unknown,
            },
            ReasonCase {
                text: "Разблокировка аккаунта выполнена",
                reason: Unknown,
            },
            ReasonCase {
                text: "Ваш аккаунт заблокирован",
                reason: AccountLocked,
            },
        ] {
            case.assert_reason();
        }
    }

    #[test]
    fn unclear_or_conflicting_text_fails_closed_to_unknown() {
        for text in [
            "Something went wrong",
            "Error 500",
            "Произошла ошибка",
            "Too many failed attempts. Your account has been locked.",
            "Account locked. Complete the CAPTCHA to continue.",
            "",
        ] {
            ReasonCase {
                text,
                reason: SignInFailureReason::Unknown,
            }
            .assert_reason();
        }
    }

    #[test]
    fn vocabulary_presence_is_reported_even_when_the_reason_is_unknown() {
        let conflicting = SignInFailureReasonReading::from(&SignInAttemptNormalizedText::from(
            "Too many attempts; account locked",
        ));
        assert_eq!(conflicting.reason, SignInFailureReason::Unknown);
        assert_eq!(conflicting.vocabulary, SignInAttemptTermMatch::Matched);
        let plain = SignInFailureReasonReading::from(&SignInAttemptNormalizedText::from(
            "By signing in you agree to the Terms",
        ));
        assert_eq!(plain.vocabulary, SignInAttemptTermMatch::Unmatched);
    }
}
