#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

//! Nook-owned SLIP-0039 current-format, single-group implementation.
//!
//! This module deliberately exposes only the shape used by Sentinel genesis:
//! 256-bit secrets, extendable backups (`ext = 1`), an empty passphrase, one
//! group (`GT = G = 1`), and a configurable member `T-of-N` policy.
//!
//! The implementation follows the final SLIP-0039 specification and was
//! cross-checked against the MIT-licensed `SatoshiLabs`
//! `python-shamir-mnemonic` reference implementation and its official test
//! vectors (Copyright 2018 Andrew R. Kozlik and contributors). No code or
//! dependency from a GPL-licensed implementation is used here.

use std::collections::BTreeSet;

use zeroize::Zeroize;

use crate::{MultiDeviceError, MultiDeviceResult};

mod cipher;
mod mnemonic;
mod polynomial;

use cipher::MasterSecretCipher;
use mnemonic::Share;
use polynomial::{RandomBytes, RawShare, SecretPolynomial};

const EXTENDABLE_CUSTOMIZATION: &[u8] = b"shamir_extendable";
const ITERATION_EXPONENT: u8 = 0;
const ROUND_COUNT: u8 = 4;
const ROUND_ITERATIONS: u32 = 2_500;
const SECRET_BYTES: usize = 32;
const DIGEST_BYTES: usize = 4;
const DIGEST_INDEX: u8 = 254;
const SECRET_INDEX: u8 = 255;
const CHECKSUM_WORDS: usize = 3;
const METADATA_WORDS: usize = 4;
const MNEMONIC_WORDS_256: usize = 33;

/// Borrowed Sentinel root and policy awaiting SLIP-0039 issuance.
pub(crate) struct SentinelSecretSplitRequest<'a> {
    master_secret: &'a [u8; SECRET_BYTES],
    threshold: u8,
    share_count: u8,
}

impl<'a> SentinelSecretSplitRequest<'a> {
    #[must_use]
    pub(crate) fn new(
        master_secret: &'a [u8; SECRET_BYTES],
        threshold: u8,
        share_count: u8,
    ) -> Self {
        Self {
            master_secret,
            threshold,
            share_count,
        }
    }

    /// Validate policy, encrypt the root, and consume the request into shares.
    pub(crate) fn issue(self) -> MultiDeviceResult<Vec<String>> {
        Self::validate_policy(self.threshold, self.share_count)?;

        let mut identifier_bytes = [0_u8; 2];
        RandomBytes::fill(&mut identifier_bytes)?;
        let identifier = u16::from_be_bytes(identifier_bytes) & 0x7fff;

        let mut encrypted =
            MasterSecretCipher::new(b"", ITERATION_EXPONENT).encrypt(self.master_secret);
        let raw_shares = SecretPolynomial::split(self.threshold, self.share_count, &encrypted)?;
        encrypted.zeroize();

        raw_shares
            .into_iter()
            .map(|raw| {
                Share {
                    identifier,
                    iteration_exponent: ITERATION_EXPONENT,
                    member_index: raw.index,
                    member_threshold: self.threshold,
                    value: raw.value,
                }
                .encode()
            })
            .collect()
    }

    fn validate_policy(threshold: u8, share_count: u8) -> MultiDeviceResult<()> {
        crate::SentinelUnlockPolicy {
            threshold: threshold.into(),
            required_participants: share_count.into(),
        }
        .validate()
    }
}

/// Borrowed mnemonic set and passphrase awaiting quorum admission and recovery.
pub(crate) struct SentinelSecretRecoveryRequest<'a> {
    mnemonics: &'a [String],
    passphrase: &'a [u8],
    threshold_policy: RecoveryThresholdPolicy,
}

impl<'a> SentinelSecretRecoveryRequest<'a> {
    #[must_use]
    pub(crate) fn sentinel(mnemonics: &'a [String]) -> Self {
        Self {
            mnemonics,
            passphrase: b"",
            threshold_policy: RecoveryThresholdPolicy::SentinelQuorum,
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_passphrase(mnemonics: &'a [String], passphrase: &'a [u8]) -> Self {
        Self {
            mnemonics,
            passphrase,
            threshold_policy: RecoveryThresholdPolicy::InteroperabilityVector,
        }
    }

    /// Validate the passphrase, admit a private quorum, and consume it to recover the root.
    pub(crate) fn recover(self) -> MultiDeviceResult<[u8; SECRET_BYTES]> {
        Self::validate_passphrase(self.passphrase)?;
        if matches!(
            self.threshold_policy,
            RecoveryThresholdPolicy::SentinelQuorum
        ) && let Some(first) = self.mnemonics.first()
            && Share::decode(first)?.member_threshold < 2
        {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        AdmittedQuorum::admit(self.mnemonics)?.recover(self.passphrase)
    }

    fn validate_passphrase(passphrase: &[u8]) -> MultiDeviceResult<()> {
        if passphrase.iter().all(|byte| (32..=126).contains(byte)) || passphrase.is_empty() {
            Ok(())
        } else {
            Err(MultiDeviceError::InvalidSentinelShareEncoding)
        }
    }
}

/// A private, non-cloneable quorum admitted from compatible decoded shares.
struct AdmittedQuorum {
    threshold: u8,
    iteration_exponent: u8,
    shares: Vec<RawShare>,
}

impl AdmittedQuorum {
    fn admit(mnemonics: &[String]) -> MultiDeviceResult<Self> {
        let shares = mnemonics
            .iter()
            .map(|mnemonic| Share::decode(mnemonic))
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        let first = shares
            .first()
            .ok_or(MultiDeviceError::NotEnoughSentinelShares {
                threshold: 2.into(),
                available: 0.into(),
            })?;
        let identifier = first.identifier;
        let iteration_exponent = first.iteration_exponent;
        let threshold = first.member_threshold;

        if shares.iter().any(|share| {
            share.identifier != identifier
                || share.iteration_exponent != iteration_exponent
                || share.member_threshold != threshold
                || share.value.len() != SECRET_BYTES
        }) {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }

        let mut indexes = BTreeSet::new();
        if shares
            .iter()
            .any(|share| !indexes.insert(share.member_index))
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        let required = usize::from(threshold);
        if shares.len() < required {
            return Err(MultiDeviceError::NotEnoughSentinelShares {
                threshold: threshold.into(),
                available: shares.len().into(),
            });
        }

        // Extra compatible shares do not alter the result. Selecting a quorum
        // keeps the application API ergonomic while preserving standard recovery.
        let shares = shares
            .into_iter()
            .take(required)
            .map(|share| RawShare {
                index: share.member_index,
                value: share.value,
            })
            .collect();
        Ok(Self {
            threshold,
            iteration_exponent,
            shares,
        })
    }

    fn recover(self, passphrase: &[u8]) -> MultiDeviceResult<[u8; SECRET_BYTES]> {
        let mut encrypted = SecretPolynomial::recover(self.threshold, &self.shares)?;
        let decrypted =
            MasterSecretCipher::new(passphrase, self.iteration_exponent).decrypt(&encrypted)?;
        encrypted.zeroize();
        decrypted
            .try_into()
            .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::mnemonic::WordList;
    use super::*;

    // Official current vectors from SatoshiLabs python-shamir-mnemonic
    // vectors.json. Valid vectors use the mandated "TREZOR" passphrase.
    const OFFICIAL_EXTENDABLE_1_OF_1: &str = "impulse calcium academic academic alcohol sugar lyrics pajamas column facility finance tension extend space birthday rainbow swimming purple syndrome facility trial warn duration snapshot shadow hormone rhyme public spine counter easy hawk album";
    const OFFICIAL_EXTENDABLE_2_OF_3_A: &str = "western apart academic always artist resident briefing sugar woman oven coding club ajar merit pecan answer prisoner artist fraction amount desktop mild false necklace muscle photo wealthy alpha category unwrap spew losing making";
    const OFFICIAL_EXTENDABLE_2_OF_3_B: &str = "western apart academic acid answer ancient auction flip image penalty oasis beaver multiple thunder problem switch alive heat inherit superior teaspoon explain blanket pencil numb lend punish endless aunt garlic humidity kidney observe";

    #[test]
    fn official_extendable_256_bit_one_of_one_vector_recovers() -> anyhow::Result<()> {
        let mnemonics = vec![OFFICIAL_EXTENDABLE_1_OF_1.to_owned()];
        let recovered =
            SentinelSecretRecoveryRequest::with_passphrase(&mnemonics, b"TREZOR").recover()?;
        assert_eq!(
            hex::encode(recovered),
            "8340611602fe91af634a5f4608377b5235fa2d757c51d720c0c7656249a3035f"
        );
        assert!(matches!(
            SentinelSecretRecoveryRequest::sentinel(&mnemonics).recover(),
            Err(MultiDeviceError::InvalidSentinelThreshold)
        ));
        Ok(())
    }

    #[test]
    fn official_extendable_256_bit_two_of_three_vector_recovers() -> anyhow::Result<()> {
        let mnemonics = vec![
            OFFICIAL_EXTENDABLE_2_OF_3_A.to_owned(),
            OFFICIAL_EXTENDABLE_2_OF_3_B.to_owned(),
        ];
        let recovered =
            SentinelSecretRecoveryRequest::with_passphrase(&mnemonics, b"TREZOR").recover()?;
        assert_eq!(
            hex::encode(recovered),
            "8dc652d6d6cd370d8c963141f6d79ba440300f25c467302c1d966bff8f62300d"
        );
        Ok(())
    }

    #[test]
    fn sentinel_round_trip_is_current_ext_one_and_any_quorum_recovers() -> anyhow::Result<()> {
        let mut root = [0_u8; 32];
        for (index, byte) in root.iter_mut().enumerate() {
            *byte = u8::try_from(index)?;
        }
        let shares = SentinelSecretSplitRequest::new(&root, 3, 5).issue()?;
        assert_eq!(shares.len(), 5);
        assert!(
            shares
                .iter()
                .all(|share| share.split_whitespace().count() == 33)
        );
        for share in &shares {
            let decoded = Share::decode(share)?;
            assert_eq!(decoded.iteration_exponent, 0);
            assert_eq!(decoded.member_threshold, 3);
        }
        let quorum = shares
            .get(1..4)
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a three-share quorum"))?;
        assert_eq!(
            SentinelSecretRecoveryRequest::sentinel(quorum).recover()?,
            root
        );
        let insufficient = shares
            .get(..2)
            .ok_or_else(|| anyhow::anyhow!("fixture must contain two shares"))?;
        assert!(
            SentinelSecretRecoveryRequest::sentinel(insufficient)
                .recover()
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn checksum_and_padding_corruption_are_rejected() -> anyhow::Result<()> {
        let root = [42_u8; SECRET_BYTES];
        let mut shares = SentinelSecretSplitRequest::new(&root, 2, 3).issue()?;
        let first = shares
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a share"))?;
        let last = first
            .rfind(' ')
            .ok_or_else(|| io::Error::other("share must contain words"))?
            + 1;
        let replacement = if first
            .get(last..)
            .ok_or_else(|| anyhow::anyhow!("last word must start at a character boundary"))?
            == "academic"
        {
            "acid"
        } else {
            "academic"
        };
        first.replace_range(last.., replacement);
        let quorum = shares
            .get(..2)
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a two-share quorum"))?;
        assert!(
            SentinelSecretRecoveryRequest::sentinel(quorum)
                .recover()
                .is_err()
        );

        let mut valid = SentinelSecretSplitRequest::new(&root, 2, 3).issue()?;
        let mut indices = valid
            .first()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a valid share"))?
            .split_whitespace()
            .map(|word| {
                WordList::values()
                    .binary_search(&word)
                    .map_err(|_| io::Error::other("word must exist in SLIP-0039 wordlist"))
                    .and_then(|index| {
                        u16::try_from(index)
                            .map_err(|_| io::Error::other("word index must fit into u16"))
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        *indices
            .get_mut(METADATA_WORDS)
            .ok_or_else(|| anyhow::anyhow!("share must contain metadata words"))? |= 1 << 9;
        let data_len = indices
            .len()
            .checked_sub(CHECKSUM_WORDS)
            .ok_or_else(|| anyhow::anyhow!("share must contain checksum words"))?;
        let checksum = mnemonic::Checksum::create(
            indices
                .get(..data_len)
                .ok_or_else(|| anyhow::anyhow!("share data range must be valid"))?,
        );
        indices
            .get_mut(data_len..)
            .ok_or_else(|| anyhow::anyhow!("share checksum range must be valid"))?
            .copy_from_slice(&checksum);
        let rewritten = indices
            .into_iter()
            .map(|index| {
                WordList::values()
                    .get(usize::from(index))
                    .copied()
                    .ok_or_else(|| anyhow::anyhow!("share word index must be valid"))
            })
            .collect::<anyhow::Result<Vec<_>>>()?
            .join(" ");
        *valid
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a valid share"))? = rewritten;
        let quorum = valid
            .get(..2)
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a two-share quorum"))?;
        assert!(
            SentinelSecretRecoveryRequest::sentinel(quorum)
                .recover()
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_mixed_sets_duplicates_and_invalid_policy() -> anyhow::Result<()> {
        let left = SentinelSecretSplitRequest::new(&[1_u8; SECRET_BYTES], 2, 3).issue()?;
        let right = SentinelSecretSplitRequest::new(&[2_u8; SECRET_BYTES], 2, 3).issue()?;
        let left_first = left
            .first()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("left fixture must contain its first share"))?;
        let left_duplicate = left_first.clone();
        let right_second = right
            .get(1)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("right fixture must contain its second share"))?;
        assert!(
            SentinelSecretRecoveryRequest::sentinel(&[left_first.clone(), right_second])
                .recover()
                .is_err()
        );
        assert!(
            SentinelSecretRecoveryRequest::sentinel(&[left_first, left_duplicate])
                .recover()
                .is_err()
        );
        assert!(
            SentinelSecretSplitRequest::new(&[0_u8; SECRET_BYTES], 1, 3)
                .issue()
                .is_err()
        );
        assert!(
            SentinelSecretSplitRequest::new(&[0_u8; SECRET_BYTES], 3, 2)
                .issue()
                .is_err()
        );
        assert!(
            SentinelSecretSplitRequest::new(&[0_u8; SECRET_BYTES], 2, 17)
                .issue()
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn invalid_passphrase_is_rejected_before_share_decoding() {
        let mnemonics = vec!["not a mnemonic".to_owned()];
        assert!(matches!(
            SentinelSecretRecoveryRequest::with_passphrase(&mnemonics, &[0]).recover(),
            Err(MultiDeviceError::InvalidSentinelShareEncoding)
        ));
    }
}

/// The relaxed policy is constructible only by existing test-vector admission.
#[derive(Clone, Copy)]
enum RecoveryThresholdPolicy {
    SentinelQuorum,
    #[cfg(test)]
    InteroperabilityVector,
}
