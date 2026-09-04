use crate::errors::{MultiDeviceError, MultiDeviceResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct IndexedShare {
    pub(super) index: u8,
    pub(super) bytes: Vec<u8>,
}

pub(super) fn validate_sentinel_threshold(
    threshold: u8,
    required_participants: u8,
) -> MultiDeviceResult<()> {
    if threshold <= 1 || required_participants == 0 || threshold > required_participants {
        return Err(MultiDeviceError::InvalidSentinelThreshold);
    }
    Ok(())
}

pub(super) fn split_secret_bytes(
    secret: &[u8],
    threshold: u8,
    required_participants: u8,
) -> MultiDeviceResult<Vec<IndexedShare>> {
    validate_sentinel_threshold(threshold, required_participants)?;
    let mut shares: Vec<IndexedShare> = (1..=required_participants)
        .map(|index| IndexedShare {
            index,
            bytes: Vec::with_capacity(secret.len()),
        })
        .collect();
    let degree = usize::from(threshold - 1);
    for &byte in secret {
        let mut coefficients = vec![0u8; degree];
        getrandom::fill(&mut coefficients)
            .map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))?;
        for share in &mut shares {
            let mut y = byte;
            let mut power = 1u8;
            for coefficient in &coefficients {
                power = gf_mul(power, share.index);
                y ^= gf_mul(*coefficient, power);
            }
            share.bytes.push(y);
        }
    }
    Ok(shares)
}

pub(super) fn reconstruct_secret_bytes(
    shares: &[IndexedShare],
    threshold: u8,
) -> MultiDeviceResult<Vec<u8>> {
    if shares.len() < usize::from(threshold) {
        return Err(MultiDeviceError::NotEnoughSentinelShares {
            threshold: threshold.into(),
            available: shares.len().into(),
        });
    }
    let length = shares
        .first()
        .map(|share| share.bytes.len())
        .ok_or(MultiDeviceError::InvalidSentinelShareEncoding)?;
    if shares
        .iter()
        .any(|share| share.index == 0 || share.bytes.len() != length)
    {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    let mut secret = vec![0u8; length];
    for (byte_index, secret_byte) in secret.iter_mut().enumerate().take(length) {
        let mut value = 0u8;
        for (i, share_i) in shares.iter().take(usize::from(threshold)).enumerate() {
            let mut numerator = 1u8;
            let mut denominator = 1u8;
            for (j, share_j) in shares.iter().take(usize::from(threshold)).enumerate() {
                if i == j {
                    continue;
                }
                numerator = gf_mul(numerator, share_j.index);
                denominator = gf_mul(denominator, share_i.index ^ share_j.index);
            }
            if denominator == 0 {
                return Err(MultiDeviceError::InvalidSentinelShareEncoding);
            }
            let coefficient = gf_mul(numerator, gf_inv(denominator));
            value ^= gf_mul(share_i.bytes[byte_index], coefficient);
        }
        *secret_byte = value;
    }
    Ok(secret)
}

fn gf_mul(mut a: u8, mut b: u8) -> u8 {
    let mut product = 0u8;
    while b != 0 {
        if b & 1 != 0 {
            product ^= a;
        }
        let carry = a & 0x80 != 0;
        a <<= 1;
        if carry {
            a ^= 0x1b;
        }
        b >>= 1;
    }
    product
}

fn gf_pow(mut base: u8, mut exponent: u8) -> u8 {
    let mut result = 1u8;
    while exponent != 0 {
        if exponent & 1 != 0 {
            result = gf_mul(result, base);
        }
        base = gf_mul(base, base);
        exponent >>= 1;
    }
    result
}

fn gf_inv(value: u8) -> u8 {
    debug_assert_ne!(value, 0);
    gf_pow(value, 254)
}
