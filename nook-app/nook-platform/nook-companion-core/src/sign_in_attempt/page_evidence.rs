//! Bounded, non-secret page facts collected by the content-script sensor.
//!
//! The sensor applies only structural bounds. Whether a message is an error,
//! its reason category, and whether a link resets a password are Rust
//! decisions. Every bound is enforced at decoding, so an over-bound request
//! never reaches lifecycle policy.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::request::{SignInAttemptAuthFields, SignInAttemptRequestError};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignInAttemptPageEvidence {
    pub document: SignInAttemptDocumentRelation,
    pub auth_fields: SignInAttemptAuthFields,
    /// CAPTCHA / verification (existing manual-checkpoint classifier result).
    pub manual_checkpoint_present: bool,
    /// Existing `data-nook-auth-outcome` success adapter.
    pub success_marker_present: bool,
    /// Existing `data-nook-auth-outcome` error adapter.
    pub error_marker_present: bool,
    pub messages: SignInPageMessages,
    pub links: SignInPageLinks,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
pub enum SignInAttemptDocumentRelation {
    /// Observed by the content-script instance that performed the submit.
    SameDocument,
    /// Observed by an instance that resumed the attempt after a load.
    NewDocument,
}

/// Raw, bounded, non-secret structural facts of one visible text block.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignInPageMessage {
    pub text: SignInPageMessageText,
    pub source: SignInPageMessageSource,
    pub placement: SignInPageMessagePlacement,
    pub tokens: SignInPageMessageTokens,
    pub foreground: SignInPageColor,
    pub background: SignInPageColor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
pub enum SignInPageMessageSource {
    /// `role=alert` / `role=status`.
    Alert,
    /// `aria-live` polite or assertive region.
    LiveRegion,
    /// `aria-errormessage` / `aria-describedby` target of an auth input.
    FieldReference,
    /// Plain element inside or near the auth form.
    Container,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
pub enum SignInPageMessagePlacement {
    InsideAuthForm,
    NearAuthForm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SignInPageColor {
    pub red: SignInPageColorChannel,
    pub green: SignInPageColorChannel,
    pub blue: SignInPageColorChannel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct SignInPageColorChannel(u8);

impl From<u8> for SignInPageColorChannel {
    fn from(channel: u8) -> Self {
        Self(channel)
    }
}

/// Whether a computed color reads as an error tone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInPageColorTone {
    Reddish,
    Neutral,
}

impl SignInPageColor {
    /// Saturated red/orange-red, or a light red tint with balanced green and blue.
    pub(crate) fn tone(self) -> SignInPageColorTone {
        let Self {
            red: SignInPageColorChannel(red),
            green: SignInPageColorChannel(green),
            blue: SignInPageColorChannel(blue),
        } = self;
        let over_green = red.saturating_sub(green);
        let over_blue = red.saturating_sub(blue);
        match (red, over_green, over_blue, green.abs_diff(blue)) {
            (128..=255, 60..=255, 60..=255, _) | (200..=255, 10..=255, 10..=255, 0..=12) => {
                SignInPageColorTone::Reddish
            }
            _ => SignInPageColorTone::Neutral,
        }
    }
}

/// Visible, whitespace-normalized message text, at most 300 characters.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct SignInPageMessageText(String);

impl SignInPageMessageText {
    pub(crate) const MAX_CHARS: usize = 300;

    pub(crate) fn text(&self) -> &str {
        let Self(text) = self;
        text
    }
}

impl TryFrom<String> for SignInPageMessageText {
    type Error = SignInAttemptRequestError;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        match text.chars().count() {
            0..=Self::MAX_CHARS => Ok(Self(text)),
            _ => Err(SignInAttemptRequestError::PageTextTooLong),
        }
    }
}

/// Lowercase class or id token of the element or one of two ancestors.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct SignInPageMessageToken(String);

impl SignInPageMessageToken {
    pub(crate) const MAX_CHARS: usize = 48;

    pub(crate) fn text(&self) -> &str {
        let Self(token) = self;
        token
    }
}

impl TryFrom<String> for SignInPageMessageToken {
    type Error = SignInAttemptRequestError;

    fn try_from(token: String) -> Result<Self, Self::Error> {
        match token.chars().count() {
            0..=Self::MAX_CHARS => Ok(Self(token)),
            _ => Err(SignInAttemptRequestError::PageTextTooLong),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "Vec<SignInPageMessageToken>")]
#[tsify(type = "string[]")]
pub struct SignInPageMessageTokens(Vec<SignInPageMessageToken>);

impl SignInPageMessageTokens {
    pub(crate) const MAX_TOKENS: usize = 12;

    pub(crate) fn iter(&self) -> impl Iterator<Item = &SignInPageMessageToken> {
        let Self(tokens) = self;
        tokens.iter()
    }
}

impl TryFrom<Vec<SignInPageMessageToken>> for SignInPageMessageTokens {
    type Error = SignInAttemptRequestError;

    fn try_from(tokens: Vec<SignInPageMessageToken>) -> Result<Self, Self::Error> {
        match tokens.len() {
            0..=Self::MAX_TOKENS => Ok(Self(tokens)),
            _ => Err(SignInAttemptRequestError::PageEvidenceTooLarge),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "Vec<SignInPageMessage>")]
#[tsify(type = "SignInPageMessage[]")]
pub struct SignInPageMessages(Vec<SignInPageMessage>);

impl SignInPageMessages {
    pub(crate) const MAX_MESSAGES: usize = 6;

    pub(crate) fn iter(&self) -> impl Iterator<Item = &SignInPageMessage> {
        let Self(messages) = self;
        messages.iter()
    }
}

impl TryFrom<Vec<SignInPageMessage>> for SignInPageMessages {
    type Error = SignInAttemptRequestError;

    fn try_from(messages: Vec<SignInPageMessage>) -> Result<Self, Self::Error> {
        match messages.len() {
            0..=Self::MAX_MESSAGES => Ok(Self(messages)),
            _ => Err(SignInAttemptRequestError::PageEvidenceTooLarge),
        }
    }
}

/// A visible link inside or near the auth form, or inside a captured message.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignInPageLink {
    pub index: SignInPageLinkIndex,
    pub text: SignInPageLinkText,
    pub href: SignInPageLinkHref,
}

/// Content-script-local handle of a collected link; meaningful only in the
/// document instance that collected it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct SignInPageLinkIndex(u32);

impl From<u32> for SignInPageLinkIndex {
    fn from(index: u32) -> Self {
        Self(index)
    }
}

/// Visible link text or accessible name, at most 80 characters.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct SignInPageLinkText(String);

impl SignInPageLinkText {
    pub(crate) const MAX_CHARS: usize = 80;

    pub(crate) fn text(&self) -> &str {
        let Self(text) = self;
        text
    }
}

impl TryFrom<String> for SignInPageLinkText {
    type Error = SignInAttemptRequestError;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        match text.chars().count() {
            0..=Self::MAX_CHARS => Ok(Self(text)),
            _ => Err(SignInAttemptRequestError::PageTextTooLong),
        }
    }
}

/// Absolute link URL without query and fragment, at most 300 characters.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct SignInPageLinkHref(String);

impl SignInPageLinkHref {
    pub(crate) const MAX_CHARS: usize = 300;

    pub(crate) fn text(&self) -> &str {
        let Self(href) = self;
        href
    }
}

impl TryFrom<String> for SignInPageLinkHref {
    type Error = SignInAttemptRequestError;

    fn try_from(href: String) -> Result<Self, Self::Error> {
        match href.chars().count() {
            0..=Self::MAX_CHARS => Ok(Self(href)),
            _ => Err(SignInAttemptRequestError::PageTextTooLong),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(try_from = "Vec<SignInPageLink>")]
#[tsify(type = "SignInPageLink[]")]
pub struct SignInPageLinks(Vec<SignInPageLink>);

impl SignInPageLinks {
    pub(crate) const MAX_LINKS: usize = 8;

    pub(crate) fn iter(&self) -> impl Iterator<Item = &SignInPageLink> {
        let Self(links) = self;
        links.iter()
    }
}

impl TryFrom<Vec<SignInPageLink>> for SignInPageLinks {
    type Error = SignInAttemptRequestError;

    fn try_from(links: Vec<SignInPageLink>) -> Result<Self, Self::Error> {
        match links.len() {
            0..=Self::MAX_LINKS => Ok(Self(links)),
            _ => Err(SignInAttemptRequestError::PageEvidenceTooLarge),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SignInPageColor, SignInPageColorChannel, SignInPageColorTone, SignInPageLinkHref,
        SignInPageLinkText, SignInPageLinks, SignInPageMessageText, SignInPageMessageToken,
        SignInPageMessageTokens, SignInPageMessages,
    };
    use crate::SignInAttemptPageEvidence;

    struct ColorCase {
        red: u8,
        green: u8,
        blue: u8,
        tone: SignInPageColorTone,
    }

    impl ColorCase {
        fn assert_tone(&self) {
            let color = SignInPageColor {
                red: SignInPageColorChannel::from(self.red),
                green: SignInPageColorChannel::from(self.green),
                blue: SignInPageColorChannel::from(self.blue),
            };
            assert_eq!(
                color.tone(),
                self.tone,
                "rgb({}, {}, {})",
                self.red,
                self.green,
                self.blue
            );
        }
    }

    #[test]
    fn error_tones_cover_saturated_reds_and_light_red_tints_only() {
        use SignInPageColorTone::{Neutral, Reddish};
        for case in [
            ColorCase {
                red: 211,
                green: 47,
                blue: 47,
                tone: Reddish,
            },
            ColorCase {
                red: 169,
                green: 68,
                blue: 66,
                tone: Reddish,
            },
            ColorCase {
                red: 222,
                green: 55,
                blue: 35,
                tone: Reddish,
            },
            ColorCase {
                red: 242,
                green: 222,
                blue: 222,
                tone: Reddish,
            },
            ColorCase {
                red: 253,
                green: 236,
                blue: 234,
                tone: Reddish,
            },
            ColorCase {
                red: 255,
                green: 255,
                blue: 255,
                tone: Neutral,
            },
            ColorCase {
                red: 51,
                green: 51,
                blue: 51,
                tone: Neutral,
            },
            ColorCase {
                red: 250,
                green: 235,
                blue: 215,
                tone: Neutral,
            },
            ColorCase {
                red: 0,
                green: 102,
                blue: 204,
                tone: Neutral,
            },
            ColorCase {
                red: 139,
                green: 0,
                blue: 0,
                tone: Reddish,
            },
            ColorCase {
                red: 110,
                green: 0,
                blue: 0,
                tone: Neutral,
            },
        ] {
            case.assert_tone();
        }
    }

    #[test]
    fn text_bounds_count_characters_not_bytes() {
        assert!(
            SignInPageMessageText::try_from("ж".repeat(SignInPageMessageText::MAX_CHARS)).is_ok()
        );
        assert!(
            SignInPageMessageText::try_from("ж".repeat(SignInPageMessageText::MAX_CHARS + 1))
                .is_err()
        );
        assert!(
            SignInPageMessageToken::try_from("t".repeat(SignInPageMessageToken::MAX_CHARS + 1))
                .is_err()
        );
        assert!(
            SignInPageLinkText::try_from("l".repeat(SignInPageLinkText::MAX_CHARS + 1)).is_err()
        );
        assert!(
            SignInPageLinkHref::try_from("h".repeat(SignInPageLinkHref::MAX_CHARS + 1)).is_err()
        );
    }

    #[test]
    fn collection_bounds_reject_over_bound_vectors() {
        assert!(SignInPageMessages::try_from(Vec::new()).is_ok());
        assert!(SignInPageLinks::try_from(Vec::new()).is_ok());
        let tokens = (0..=SignInPageMessageTokens::MAX_TOKENS)
            .map(|_| SignInPageMessageToken::try_from("error".to_owned()))
            .collect::<Result<Vec<_>, _>>();
        assert!(tokens.is_ok_and(|tokens| SignInPageMessageTokens::try_from(tokens).is_err()));
    }

    /// Deliberately raw decoder input: the bound under test is the wire bound.
    struct RawPageDocument {
        messages: usize,
        links: usize,
    }

    impl RawPageDocument {
        const MESSAGE: &'static str = r#"{"text":"Error","source":"Alert","placement":"InsideAuthForm","tokens":[],"foreground":{"red":0,"green":0,"blue":0},"background":{"red":255,"green":255,"blue":255}}"#;
        const LINK: &'static str = r#"{"index":1,"text":"Reset","href":"https://a.example/reset"}"#;

        fn json(&self) -> String {
            format!(
                r#"{{"document":"NewDocument","authFields":{{"usernamePresent":true,"currentPasswordPresent":true,"oneTimeCodePresent":false}},"manualCheckpointPresent":false,"successMarkerPresent":false,"errorMarkerPresent":false,"messages":[{}],"links":[{}]}}"#,
                vec![Self::MESSAGE; self.messages].join(","),
                vec![Self::LINK; self.links].join(",")
            )
        }
    }

    #[test]
    fn page_evidence_decoding_rejects_over_bound_messages_and_links() {
        let at_bound = RawPageDocument {
            messages: 6,
            links: 8,
        }
        .json();
        assert!(serde_json::from_str::<SignInAttemptPageEvidence>(&at_bound).is_ok());
        let messages_over = RawPageDocument {
            messages: 7,
            links: 8,
        }
        .json();
        assert!(serde_json::from_str::<SignInAttemptPageEvidence>(&messages_over).is_err());
        let links_over = RawPageDocument {
            messages: 6,
            links: 9,
        }
        .json();
        assert!(serde_json::from_str::<SignInAttemptPageEvidence>(&links_over).is_err());
        let over_bound_channel = RawPageDocument {
            messages: 1,
            links: 0,
        }
        .json()
        .replace(r#""red":0"#, r#""red":256"#);
        assert!(serde_json::from_str::<SignInAttemptPageEvidence>(&over_bound_channel).is_err());
    }
}
