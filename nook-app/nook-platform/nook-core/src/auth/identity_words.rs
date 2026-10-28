//! Three words that name an identity, so people can tell identities apart at
//! a glance.
//!
//! The words come from the public identity id alone: a provider listing and
//! the identity card show the same words for the same identity without any
//! key. They are for recognition, not verification, and reveal nothing the
//! id does not.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use bip39::Language;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tsify::Tsify;

use crate::IdentityId;

const IDENTITY_WORD_COUNT: u32 = 3;
/// A BIP39 word list holds 2^11 words.
const BITS_PER_WORD: u32 = 11;
const WORD_INDEX_MASK: u64 = (1 << BITS_PER_WORD) - 1;

/// Three BIP39 English words derived from an identity id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string[]")]
pub struct IdentityWords(Vec<String>);

impl IdentityWords {
    /// The words for one identity: the leading 33 bits of the id's SHA-256,
    /// eleven bits per word.
    #[must_use]
    pub fn of(identity_id: &IdentityId) -> Self {
        let digest: [u8; 32] = Sha256::digest(identity_id.as_str().as_bytes()).into();
        let (leading, _) = digest.split_at(8);
        let leading = leading
            .iter()
            .fold(0_u64, |bits, byte| (bits << 8) | u64::from(*byte));
        let words = Language::English.word_list();
        Self(
            (1..=IDENTITY_WORD_COUNT)
                .filter_map(|position| {
                    // The mask keeps every index below the list's 2048 words.
                    let index =
                        (leading >> (u64::BITS - position * BITS_PER_WORD)) & WORD_INDEX_MASK;
                    usize::try_from(index)
                        .ok()
                        .and_then(|index| words.get(index))
                })
                .map(|word| (*word).to_owned())
                .collect(),
        )
    }

    #[must_use]
    pub fn words(&self) -> &[String] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(unowned_function, reason = "framework boundary: test function")
    )]
    fn every_identity_gets_three_stable_words_of_its_own() -> anyhow::Result<()> {
        let personal = IdentityId::generate()?;
        let work = IdentityId::generate()?;

        let words = IdentityWords::of(&personal);
        assert_eq!(words.words().len(), 3);
        assert!(
            words
                .words()
                .iter()
                .all(|word| Language::English.find_word(word).is_some())
        );
        // The same id always reads the same; another id reads differently.
        assert_eq!(IdentityWords::of(&personal), words);
        assert_ne!(IdentityWords::of(&work), words);
        Ok(())
    }
}
