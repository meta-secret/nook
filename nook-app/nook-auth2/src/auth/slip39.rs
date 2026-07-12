//! Nook-owned SLIP-0039 current-format, single-group implementation.
//!
//! This module deliberately exposes only the shape used by Nexus genesis:
//! 256-bit secrets, extendable backups (`ext = 1`), an empty passphrase, one
//! group (`GT = G = 1`), and a configurable member `T-of-N` policy.
//!
//! The implementation follows the final SLIP-0039 specification and was
//! cross-checked against the MIT-licensed `SatoshiLabs`
//! `python-shamir-mnemonic` reference implementation and its official test
//! vectors (Copyright 2018 Andrew R. Kozlik and contributors). No code or
//! dependency from a GPL-licensed implementation is used here.

use crate::{MultiDeviceError, MultiDeviceResult};
use pbkdf2::{pbkdf2_hmac, sha2::Sha256 as Pbkdf2Sha256};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use zeroize::Zeroize;

const WORDLIST: &str = include_str!("slip39_wordlist.txt");
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

#[derive(Clone)]
struct RawShare {
    index: u8,
    value: Vec<u8>,
}

#[derive(Clone)]
struct Share {
    identifier: u16,
    iteration_exponent: u8,
    member_index: u8,
    member_threshold: u8,
    value: Vec<u8>,
}

/// Split a 256-bit Nexus root into current-format SLIP-0039 mnemonics.
///
/// Every returned mnemonic has `ext = 1`, `e = 0`, `GT = G = 1`, and uses an
/// empty SLIP-0039 passphrase. `2 <= threshold <= share_count <= 16`.
pub(crate) fn split_sentinel_secret(
    master_secret: &[u8; SECRET_BYTES],
    threshold: u8,
    share_count: u8,
) -> MultiDeviceResult<Vec<String>> {
    validate_sentinel_policy(threshold, share_count)?;

    let mut identifier_bytes = [0_u8; 2];
    getrandom::getrandom(&mut identifier_bytes)
        .map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))?;
    let identifier = u16::from_be_bytes(identifier_bytes) & 0x7fff;

    let mut encrypted = encrypt_master_secret(master_secret, b"", ITERATION_EXPONENT);
    let raw_shares = split_secret(threshold, share_count, &encrypted)?;
    encrypted.zeroize();

    raw_shares
        .into_iter()
        .map(|raw| {
            encode_share(&Share {
                identifier,
                iteration_exponent: ITERATION_EXPONENT,
                member_index: raw.index,
                member_threshold: threshold,
                value: raw.value,
            })
        })
        .collect()
}

/// Recover a 256-bit Nexus root from any quorum of compatible mnemonics.
pub(crate) fn recover_sentinel_secret(
    mnemonics: &[String],
) -> MultiDeviceResult<[u8; SECRET_BYTES]> {
    if let Some(first) = mnemonics.first()
        && decode_share(first)?.member_threshold < 2
    {
        return Err(MultiDeviceError::InvalidSentinelThreshold);
    }
    recover_with_passphrase(mnemonics, b"")
}

fn recover_with_passphrase(
    mnemonics: &[String],
    passphrase: &[u8],
) -> MultiDeviceResult<[u8; SECRET_BYTES]> {
    validate_passphrase(passphrase)?;
    let shares = mnemonics
        .iter()
        .map(|mnemonic| decode_share(mnemonic))
        .collect::<MultiDeviceResult<Vec<_>>>()?;
    let first = shares
        .first()
        .ok_or(MultiDeviceError::NotEnoughNexusShares {
            threshold: 2,
            available: 0,
        })?;

    if shares.iter().any(|share| {
        share.identifier != first.identifier
            || share.iteration_exponent != first.iteration_exponent
            || share.member_threshold != first.member_threshold
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
    let required = usize::from(first.member_threshold);
    if shares.len() < required {
        return Err(MultiDeviceError::NotEnoughNexusShares {
            threshold: first.member_threshold,
            available: shares.len(),
        });
    }

    // Extra compatible shares do not alter the result. Selecting a quorum
    // keeps the application API ergonomic while preserving standard recovery.
    let raw = shares
        .iter()
        .take(required)
        .map(|share| RawShare {
            index: share.member_index,
            value: share.value.clone(),
        })
        .collect::<Vec<_>>();
    let mut encrypted = recover_secret(first.member_threshold, &raw)?;
    let decrypted = decrypt_master_secret(&encrypted, passphrase, first.iteration_exponent)?;
    encrypted.zeroize();
    decrypted
        .try_into()
        .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)
}

fn validate_sentinel_policy(threshold: u8, share_count: u8) -> MultiDeviceResult<()> {
    if threshold < 2 || threshold > share_count || share_count > 16 {
        return Err(MultiDeviceError::InvalidSentinelThreshold);
    }
    Ok(())
}

fn validate_passphrase(passphrase: &[u8]) -> MultiDeviceResult<()> {
    if passphrase.iter().all(|byte| (32..=126).contains(byte)) || passphrase.is_empty() {
        Ok(())
    } else {
        Err(MultiDeviceError::InvalidSentinelShareEncoding)
    }
}

fn split_secret(threshold: u8, share_count: u8, secret: &[u8]) -> MultiDeviceResult<Vec<RawShare>> {
    if threshold == 0
        || threshold > share_count
        || share_count > 16
        || secret.len() < 16
        || !secret.len().is_multiple_of(2)
    {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    if threshold == 1 {
        return Ok((0..share_count)
            .map(|index| RawShare {
                index,
                value: secret.to_vec(),
            })
            .collect());
    }

    let random_share_count = usize::from(threshold - 2);
    let mut shares = Vec::with_capacity(usize::from(share_count));
    for index in 0..random_share_count {
        let mut value = vec![0_u8; secret.len()];
        fill_random(&mut value)?;
        shares.push(RawShare {
            index: u8::try_from(index)
                .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?,
            value,
        });
    }

    let mut random_part = vec![0_u8; secret.len() - DIGEST_BYTES];
    fill_random(&mut random_part)?;
    let digest = share_digest(&random_part, secret);
    let mut digest_share = Vec::with_capacity(secret.len());
    digest_share.extend_from_slice(&digest);
    digest_share.extend_from_slice(&random_part);

    let mut base_points = shares.clone();
    base_points.push(RawShare {
        index: DIGEST_INDEX,
        value: digest_share,
    });
    base_points.push(RawShare {
        index: SECRET_INDEX,
        value: secret.to_vec(),
    });

    for index in random_share_count..usize::from(share_count) {
        let index =
            u8::try_from(index).map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
        shares.push(RawShare {
            index,
            value: interpolate(&base_points, index)?,
        });
    }
    random_part.zeroize();
    Ok(shares)
}

fn recover_secret(threshold: u8, shares: &[RawShare]) -> MultiDeviceResult<Vec<u8>> {
    if threshold == 0 || shares.len() < usize::from(threshold) {
        return Err(MultiDeviceError::NotEnoughNexusShares {
            threshold,
            available: shares.len(),
        });
    }
    if threshold == 1 {
        return shares
            .first()
            .map(|share| share.value.clone())
            .ok_or(MultiDeviceError::InvalidSentinelShareEncoding);
    }

    let secret = interpolate(shares, SECRET_INDEX)?;
    let digest_share = interpolate(shares, DIGEST_INDEX)?;
    if digest_share.len() < DIGEST_BYTES
        || digest_share[..DIGEST_BYTES] != share_digest(&digest_share[DIGEST_BYTES..], &secret)
    {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    Ok(secret)
}

fn fill_random(bytes: &mut [u8]) -> MultiDeviceResult<()> {
    getrandom::getrandom(bytes).map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))
}

fn share_digest(random_part: &[u8], secret: &[u8]) -> [u8; DIGEST_BYTES] {
    hmac_sha256(random_part, secret)[..DIGEST_BYTES]
        .try_into()
        .expect("digest prefix length is fixed")
}

// Minimal local HMAC avoids adding a second public crypto dependency merely
// for the four-byte SLIP-0039 share digest.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK_BYTES: usize = 64;
    let mut normalized = [0_u8; BLOCK_BYTES];
    if key.len() > BLOCK_BYTES {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
    for index in 0..BLOCK_BYTES {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    normalized.zeroize();
    inner_pad.zeroize();
    outer_pad.zeroize();
    outer.finalize().into()
}

fn interpolate(shares: &[RawShare], target: u8) -> MultiDeviceResult<Vec<u8>> {
    let length = shares
        .first()
        .map(|share| share.value.len())
        .ok_or(MultiDeviceError::InvalidSentinelShareEncoding)?;
    let indexes = shares
        .iter()
        .map(|share| share.index)
        .collect::<BTreeSet<_>>();
    if indexes.len() != shares.len() || shares.iter().any(|share| share.value.len() != length) {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    if let Some(share) = shares.iter().find(|share| share.index == target) {
        return Ok(share.value.clone());
    }

    let mut result = vec![0_u8; length];
    for share in shares {
        let mut basis = 1_u8;
        for other in shares {
            if other.index != share.index {
                let numerator = target ^ other.index;
                let denominator = share.index ^ other.index;
                basis = gf_mul(basis, gf_div(numerator, denominator)?);
            }
        }
        for (output, value) in result.iter_mut().zip(&share.value) {
            *output ^= gf_mul(*value, basis);
        }
    }
    Ok(result)
}

fn gf_mul(mut left: u8, mut right: u8) -> u8 {
    let mut product = 0_u8;
    while right != 0 {
        if right & 1 != 0 {
            product ^= left;
        }
        let high = left & 0x80;
        left <<= 1;
        if high != 0 {
            left ^= 0x1b;
        }
        right >>= 1;
    }
    product
}

fn gf_pow(mut value: u8, mut exponent: u8) -> u8 {
    let mut result = 1_u8;
    while exponent != 0 {
        if exponent & 1 != 0 {
            result = gf_mul(result, value);
        }
        value = gf_mul(value, value);
        exponent >>= 1;
    }
    result
}

fn gf_div(numerator: u8, denominator: u8) -> MultiDeviceResult<u8> {
    if denominator == 0 {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    if numerator == 0 {
        return Ok(0);
    }
    Ok(gf_mul(numerator, gf_pow(denominator, 254)))
}

fn encrypt_master_secret(secret: &[u8], passphrase: &[u8], exponent: u8) -> Vec<u8> {
    feistel(secret, passphrase, exponent, 0..ROUND_COUNT)
}

fn decrypt_master_secret(
    encrypted: &[u8],
    passphrase: &[u8],
    exponent: u8,
) -> MultiDeviceResult<Vec<u8>> {
    if encrypted.len() != SECRET_BYTES || !encrypted.len().is_multiple_of(2) {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    Ok(feistel(
        encrypted,
        passphrase,
        exponent,
        (0..ROUND_COUNT).rev(),
    ))
}

fn feistel(
    input: &[u8],
    passphrase: &[u8],
    exponent: u8,
    rounds: impl Iterator<Item = u8>,
) -> Vec<u8> {
    let middle = input.len() / 2;
    let mut left = input[..middle].to_vec();
    let mut right = input[middle..].to_vec();
    for round in rounds {
        let mut derived = round_function(round, passphrase, exponent, &right);
        let next_right = xor(&left, &derived);
        left.zeroize();
        left = right;
        right = next_right;
        derived.zeroize();
    }
    let mut output = right;
    output.extend_from_slice(&left);
    left.zeroize();
    output
}

fn round_function(round: u8, passphrase: &[u8], exponent: u8, right: &[u8]) -> Vec<u8> {
    let mut password = Vec::with_capacity(passphrase.len() + 1);
    password.push(round);
    password.extend_from_slice(passphrase);
    let iterations = ROUND_ITERATIONS << exponent;
    let mut output = vec![0_u8; right.len()];
    // `ext = 1` means the identifier is not part of the salt prefix.
    pbkdf2_hmac::<Pbkdf2Sha256>(&password, right, iterations, &mut output);
    password.zeroize();
    output
}

fn xor(left: &[u8], right: &[u8]) -> Vec<u8> {
    left.iter().zip(right).map(|(a, b)| a ^ b).collect()
}

fn encode_share(share: &Share) -> MultiDeviceResult<String> {
    if share.value.len() != SECRET_BYTES
        || share.member_threshold == 0
        || share.member_threshold > 16
        || share.member_index > 15
        || share.iteration_exponent > 15
    {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    let id_ext_exponent =
        (u32::from(share.identifier) << 5) | (1_u32 << 4) | u32::from(share.iteration_exponent);
    // GI=0, GT-1=0, G-1=0, followed by I and T-1.
    let group_member_parameters =
        (u32::from(share.member_index) << 4) | u32::from(share.member_threshold - 1);
    let mut indices = integer_words(id_ext_exponent, 2);
    indices.extend(integer_words(group_member_parameters, 2));
    indices.extend(bytes_to_words(&share.value));
    indices.extend(create_checksum(&indices));
    let words = wordlist();
    indices
        .into_iter()
        .map(|index| {
            words
                .get(usize::from(index))
                .copied()
                .ok_or(MultiDeviceError::InvalidSentinelShareEncoding)
        })
        .collect::<MultiDeviceResult<Vec<_>>>()
        .map(|mnemonic| mnemonic.join(" "))
}

fn decode_share(mnemonic: &str) -> MultiDeviceResult<Share> {
    let words = wordlist();
    let indices = mnemonic
        .split_whitespace()
        .map(|word| {
            words
                .binary_search(&word)
                .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)
                .and_then(|index| {
                    u16::try_from(index).map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)
                })
        })
        .collect::<MultiDeviceResult<Vec<_>>>()?;
    if indices.len() != MNEMONIC_WORDS_256 || !verify_checksum(&indices) {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }

    let id_ext_exponent = words_to_u32(&indices[..2]);
    let identifier = u16::try_from(id_ext_exponent >> 5)
        .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
    let extendable = (id_ext_exponent >> 4) & 1;
    let iteration_exponent = (id_ext_exponent & 0x0f) as u8;
    if identifier > 0x7fff || extendable != 1 {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }

    let parameters = words_to_u32(&indices[2..METADATA_WORDS]);
    let group_index = ((parameters >> 16) & 0x0f) as u8;
    let group_threshold = ((parameters >> 12) & 0x0f) as u8 + 1;
    let group_count = ((parameters >> 8) & 0x0f) as u8 + 1;
    let member_index = ((parameters >> 4) & 0x0f) as u8;
    let member_threshold = (parameters & 0x0f) as u8 + 1;
    if group_index != 0 || group_threshold != 1 || group_count != 1 {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }

    let value_words = &indices[METADATA_WORDS..indices.len() - CHECKSUM_WORDS];
    let value = words_to_bytes(value_words)?;
    if value.len() != SECRET_BYTES {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    Ok(Share {
        identifier,
        iteration_exponent,
        member_index,
        member_threshold,
        value,
    })
}

fn wordlist() -> Vec<&'static str> {
    WORDLIST.lines().collect()
}

fn integer_words(value: u32, count: usize) -> Vec<u16> {
    (0..count)
        .rev()
        .map(|position| ((value >> (position * 10)) & 1023) as u16)
        .collect()
}

fn words_to_u32(words: &[u16]) -> u32 {
    words
        .iter()
        .fold(0_u32, |value, word| (value << 10) | u32::from(*word))
}

fn bytes_to_words(bytes: &[u8]) -> Vec<u16> {
    let word_count = (bytes.len() * 8).div_ceil(10);
    let padding = word_count * 10 - bytes.len() * 8;
    let mut words = vec![0_u16; word_count];
    for bit in 0..bytes.len() * 8 {
        if bytes[bit / 8] & (1 << (7 - bit % 8)) != 0 {
            let padded_bit = padding + bit;
            words[padded_bit / 10] |= 1 << (9 - padded_bit % 10);
        }
    }
    words
}

fn words_to_bytes(words: &[u16]) -> MultiDeviceResult<Vec<u8>> {
    let padded_bits = words.len() * 10;
    let padding = padded_bits % 16;
    if padding > 8 || words.iter().any(|word| *word > 1023) {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    for bit in 0..padding {
        if words[bit / 10] & (1 << (9 - bit % 10)) != 0 {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
    }
    let byte_count = (padded_bits - padding) / 8;
    if byte_count < 16 {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    let mut bytes = vec![0_u8; byte_count];
    for bit in 0..byte_count * 8 {
        let source = padding + bit;
        if words[source / 10] & (1 << (9 - source % 10)) != 0 {
            bytes[bit / 8] |= 1 << (7 - bit % 8);
        }
    }
    Ok(bytes)
}

fn polymod(values: impl IntoIterator<Item = u16>) -> u32 {
    const GENERATORS: [u32; 10] = [
        0x00e0_e040,
        0x01c1_c080,
        0x0383_8100,
        0x0707_0200,
        0x0e0e_0009,
        0x1c0c_2412,
        0x3808_6c24,
        0x3090_fc48,
        0x21b1_f890,
        0x03f3_f120,
    ];
    let mut checksum = 1_u32;
    for value in values {
        let top = checksum >> 20;
        checksum = ((checksum & 0x000f_ffff) << 10) ^ u32::from(value);
        for (index, generator) in GENERATORS.iter().enumerate() {
            if (top >> index) & 1 != 0 {
                checksum ^= generator;
            }
        }
    }
    checksum
}

fn create_checksum(data: &[u16]) -> [u16; CHECKSUM_WORDS] {
    let values = EXTENDABLE_CUSTOMIZATION
        .iter()
        .map(|byte| u16::from(*byte))
        .chain(data.iter().copied())
        .chain([0_u16; CHECKSUM_WORDS]);
    let checksum = polymod(values) ^ 1;
    [
        ((checksum >> 20) & 1023) as u16,
        ((checksum >> 10) & 1023) as u16,
        (checksum & 1023) as u16,
    ]
}

fn verify_checksum(data: &[u16]) -> bool {
    polymod(
        EXTENDABLE_CUSTOMIZATION
            .iter()
            .map(|byte| u16::from(*byte))
            .chain(data.iter().copied()),
    ) == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    // Official current vectors from SatoshiLabs python-shamir-mnemonic
    // vectors.json. Valid vectors use the mandated "TREZOR" passphrase.
    const OFFICIAL_EXTENDABLE_1_OF_1: &str = "impulse calcium academic academic alcohol sugar lyrics pajamas column facility finance tension extend space birthday rainbow swimming purple syndrome facility trial warn duration snapshot shadow hormone rhyme public spine counter easy hawk album";
    const OFFICIAL_EXTENDABLE_2_OF_3_A: &str = "western apart academic always artist resident briefing sugar woman oven coding club ajar merit pecan answer prisoner artist fraction amount desktop mild false necklace muscle photo wealthy alpha category unwrap spew losing making";
    const OFFICIAL_EXTENDABLE_2_OF_3_B: &str = "western apart academic acid answer ancient auction flip image penalty oasis beaver multiple thunder problem switch alive heat inherit superior teaspoon explain blanket pencil numb lend punish endless aunt garlic humidity kidney observe";

    #[test]
    fn official_extendable_256_bit_one_of_one_vector_recovers() {
        let mnemonics = vec![OFFICIAL_EXTENDABLE_1_OF_1.to_owned()];
        let recovered = recover_with_passphrase(&mnemonics, b"TREZOR").unwrap();
        assert_eq!(
            hex::encode(recovered),
            "8340611602fe91af634a5f4608377b5235fa2d757c51d720c0c7656249a3035f"
        );
        assert!(matches!(
            recover_sentinel_secret(&mnemonics),
            Err(MultiDeviceError::InvalidSentinelThreshold)
        ));
    }

    #[test]
    fn official_extendable_256_bit_two_of_three_vector_recovers() {
        let mnemonics = vec![
            OFFICIAL_EXTENDABLE_2_OF_3_A.to_owned(),
            OFFICIAL_EXTENDABLE_2_OF_3_B.to_owned(),
        ];
        let recovered = recover_with_passphrase(&mnemonics, b"TREZOR").unwrap();
        assert_eq!(
            hex::encode(recovered),
            "8dc652d6d6cd370d8c963141f6d79ba440300f25c467302c1d966bff8f62300d"
        );
    }

    #[test]
    fn nexus_round_trip_is_current_ext_one_and_any_quorum_recovers() {
        let root = core::array::from_fn(|index| u8::try_from(index).unwrap());
        let shares = split_sentinel_secret(&root, 3, 5).unwrap();
        assert_eq!(shares.len(), 5);
        assert!(
            shares
                .iter()
                .all(|share| share.split_whitespace().count() == 33)
        );
        for share in &shares {
            let decoded = decode_share(share).unwrap();
            assert_eq!(decoded.iteration_exponent, 0);
            assert_eq!(decoded.member_threshold, 3);
        }
        assert_eq!(recover_sentinel_secret(&shares[1..4]).unwrap(), root);
        assert!(recover_sentinel_secret(&shares[..2]).is_err());
    }

    #[test]
    fn checksum_and_padding_corruption_are_rejected() {
        let root = [42_u8; SECRET_BYTES];
        let mut shares = split_sentinel_secret(&root, 2, 3).unwrap();
        let last = shares[0].rfind(' ').unwrap() + 1;
        let replacement = if &shares[0][last..] == "academic" {
            "acid"
        } else {
            "academic"
        };
        shares[0].replace_range(last.., replacement);
        assert!(recover_sentinel_secret(&shares[..2]).is_err());

        let mut valid = split_sentinel_secret(&root, 2, 3).unwrap();
        let mut indices = valid[0]
            .split_whitespace()
            .map(|word| u16::try_from(wordlist().binary_search(&word).unwrap()).unwrap())
            .collect::<Vec<_>>();
        indices[METADATA_WORDS] |= 1 << 9;
        let data_len = indices.len() - CHECKSUM_WORDS;
        let checksum = create_checksum(&indices[..data_len]);
        indices[data_len..].copy_from_slice(&checksum);
        valid[0] = indices
            .into_iter()
            .map(|index| wordlist()[usize::from(index)])
            .collect::<Vec<_>>()
            .join(" ");
        assert!(recover_sentinel_secret(&valid[..2]).is_err());
    }

    #[test]
    fn rejects_mixed_sets_duplicates_and_invalid_policy() {
        let left = split_sentinel_secret(&[1_u8; SECRET_BYTES], 2, 3).unwrap();
        let right = split_sentinel_secret(&[2_u8; SECRET_BYTES], 2, 3).unwrap();
        assert!(recover_sentinel_secret(&[left[0].clone(), right[1].clone()]).is_err());
        assert!(recover_sentinel_secret(&[left[0].clone(), left[0].clone()]).is_err());
        assert!(split_sentinel_secret(&[0_u8; SECRET_BYTES], 1, 3).is_err());
        assert!(split_sentinel_secret(&[0_u8; SECRET_BYTES], 3, 2).is_err());
        assert!(split_sentinel_secret(&[0_u8; SECRET_BYTES], 2, 17).is_err());
    }
}
