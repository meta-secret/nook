#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use std::collections::BTreeSet;

use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::errors::{MultiDeviceError, MultiDeviceResult};

use super::{DIGEST_BYTES, DIGEST_INDEX, SECRET_INDEX};

#[derive(Clone)]
pub(super) struct RawShare {
    pub(super) index: u8,
    pub(super) value: Vec<u8>,
}

pub(super) struct SecretPolynomial;

impl SecretPolynomial {
    pub(super) fn split(
        threshold: u8,
        share_count: u8,
        secret: &[u8],
    ) -> MultiDeviceResult<Vec<RawShare>> {
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
            RandomBytes::fill(&mut value)?;
            shares.push(RawShare {
                index: u8::try_from(index)
                    .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?,
                value,
            });
        }

        let mut random_part = vec![0_u8; secret.len() - DIGEST_BYTES];
        RandomBytes::fill(&mut random_part)?;
        let digest = ShareDigest::new(&random_part, secret).compute();
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
                value: Self::interpolate(&base_points, index)?,
            });
        }
        random_part.zeroize();
        Ok(shares)
    }

    pub(super) fn recover(threshold: u8, shares: &[RawShare]) -> MultiDeviceResult<Vec<u8>> {
        if threshold == 0 || shares.len() < usize::from(threshold) {
            return Err(MultiDeviceError::NotEnoughSentinelShares {
                threshold: threshold.into(),
                available: shares.len().into(),
            });
        }
        if threshold == 1 {
            return shares
                .first()
                .map(|share| share.value.clone())
                .ok_or(MultiDeviceError::InvalidSentinelShareEncoding);
        }

        let secret = Self::interpolate(shares, SECRET_INDEX)?;
        let digest_share = Self::interpolate(shares, DIGEST_INDEX)?;
        if digest_share.len() < DIGEST_BYTES
            || digest_share[..DIGEST_BYTES]
                != ShareDigest::new(&digest_share[DIGEST_BYTES..], &secret).compute()
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        Ok(secret)
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
                    basis = FieldElement::multiply(
                        basis,
                        FieldElement::divide(numerator, denominator)?,
                    );
                }
            }
            for (output, value) in result.iter_mut().zip(&share.value) {
                *output ^= FieldElement::multiply(*value, basis);
            }
        }
        Ok(result)
    }
}

pub(super) struct RandomBytes;

impl RandomBytes {
    pub(super) fn fill(bytes: &mut [u8]) -> MultiDeviceResult<()> {
        getrandom::fill(bytes).map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))
    }
}

struct ShareDigest<'a> {
    random_part: &'a [u8],
    secret: &'a [u8],
}

impl<'a> ShareDigest<'a> {
    fn new(random_part: &'a [u8], secret: &'a [u8]) -> Self {
        Self {
            random_part,
            secret,
        }
    }

    fn compute(&self) -> [u8; DIGEST_BYTES] {
        let digest = HmacInput::new(self.random_part, self.secret).digest();
        [digest[0], digest[1], digest[2], digest[3]]
    }
}

struct HmacInput<'a> {
    key: &'a [u8],
    message: &'a [u8],
}

impl<'a> HmacInput<'a> {
    fn new(key: &'a [u8], message: &'a [u8]) -> Self {
        Self { key, message }
    }

    fn digest(&self) -> [u8; 32] {
        const BLOCK_BYTES: usize = 64;
        let mut normalized = [0_u8; BLOCK_BYTES];
        if self.key.len() > BLOCK_BYTES {
            normalized[..32].copy_from_slice(&Sha256::digest(self.key));
        } else {
            normalized[..self.key.len()].copy_from_slice(self.key);
        }
        let mut inner_pad = [0x36_u8; BLOCK_BYTES];
        let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
        for index in 0..BLOCK_BYTES {
            inner_pad[index] ^= normalized[index];
            outer_pad[index] ^= normalized[index];
        }
        let mut inner = Sha256::new();
        inner.update(inner_pad);
        inner.update(self.message);
        let inner_hash = inner.finalize();
        let mut outer = Sha256::new();
        outer.update(outer_pad);
        outer.update(inner_hash);
        normalized.zeroize();
        inner_pad.zeroize();
        outer_pad.zeroize();
        outer.finalize().into()
    }
}

struct FieldElement;

impl FieldElement {
    fn multiply(mut left: u8, mut right: u8) -> u8 {
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

    fn power(mut value: u8, mut exponent: u8) -> u8 {
        let mut result = 1_u8;
        while exponent != 0 {
            if exponent & 1 != 0 {
                result = Self::multiply(result, value);
            }
            value = Self::multiply(value, value);
            exponent >>= 1;
        }
        result
    }

    fn divide(numerator: u8, denominator: u8) -> MultiDeviceResult<u8> {
        if denominator == 0 {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        if numerator == 0 {
            return Ok(0);
        }
        Ok(Self::multiply(numerator, Self::power(denominator, 254)))
    }
}
