use crate::errors::{MultiDeviceError, MultiDeviceResult};
use std::fmt;
use zeroize::Zeroize;

#[derive(PartialEq, Eq)]
pub(super) struct IndexedShare {
    pub(super) index: u8,
    pub(super) bytes: Vec<u8>,
}

/// Named values required by IndexedShare::validate_sentinel_threshold.
pub(super) struct SentinelShareThreshold {
    pub(super) threshold: u8,
    pub(super) required_participants: u8,
}

/// Named values required by IndexedShare::split_secret_bytes.
pub(super) struct SentinelSecretSplit<'a> {
    pub(super) secret: &'a [u8],
    pub(super) threshold: u8,
    pub(super) required_participants: u8,
}

/// Named values required by IndexedShare::reconstruct_secret_bytes.
pub(super) struct SentinelSecretReconstruction<'a> {
    pub(super) shares: &'a [IndexedShare],
    pub(super) threshold: u8,
}

/// Named values required by IndexedShare::gf_mul.
pub(super) struct ShareFieldProduct {
    pub(super) a: u8,
    pub(super) b: u8,
}

/// Named values required by IndexedShare::gf_pow.
pub(super) struct ShareFieldPower {
    pub(super) base: u8,
    pub(super) exponent: u8,
}

impl IndexedShare {
    pub(super) fn validate_sentinel_threshold(
        request: SentinelShareThreshold,
    ) -> MultiDeviceResult<()> {
        let SentinelShareThreshold {
            threshold,
            required_participants,
        } = request;
        if !crate::SentinelThreshold::from(threshold).is_valid_for(required_participants.into()) {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(())
    }
}

impl IndexedShare {
    pub(super) fn split_secret_bytes(
        request: SentinelSecretSplit<'_>,
    ) -> MultiDeviceResult<Vec<IndexedShare>> {
        let SentinelSecretSplit {
            secret,
            threshold,
            required_participants,
        } = request;
        IndexedShare::validate_sentinel_threshold(SentinelShareThreshold {
            threshold: threshold,
            required_participants: required_participants,
        })?;
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
                    power = IndexedShare::gf_mul(ShareFieldProduct {
                        a: power,
                        b: share.index,
                    });
                    y ^= IndexedShare::gf_mul(ShareFieldProduct {
                        a: *coefficient,
                        b: power,
                    });
                }
                share.bytes.push(y);
            }
        }
        Ok(shares)
    }
}

impl IndexedShare {
    pub(super) fn reconstruct_secret_bytes(
        request: SentinelSecretReconstruction<'_>,
    ) -> MultiDeviceResult<Vec<u8>> {
        let SentinelSecretReconstruction { shares, threshold } = request;
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
                    numerator = IndexedShare::gf_mul(ShareFieldProduct {
                        a: numerator,
                        b: share_j.index,
                    });
                    denominator = IndexedShare::gf_mul(ShareFieldProduct {
                        a: denominator,
                        b: share_i.index ^ share_j.index,
                    });
                }
                if denominator == 0 {
                    return Err(MultiDeviceError::InvalidSentinelShareEncoding);
                }
                let coefficient = IndexedShare::gf_mul(ShareFieldProduct {
                    a: numerator,
                    b: IndexedShare::gf_inv(denominator),
                });
                value ^= IndexedShare::gf_mul(ShareFieldProduct {
                    a: share_i.bytes[byte_index],
                    b: coefficient,
                });
            }
            *secret_byte = value;
        }
        Ok(secret)
    }
}

impl IndexedShare {
    fn gf_mul(request: ShareFieldProduct) -> u8 {
        let ShareFieldProduct { mut a, mut b } = request;
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
}

impl IndexedShare {
    fn gf_pow(request: ShareFieldPower) -> u8 {
        let ShareFieldPower {
            mut base,
            mut exponent,
        } = request;
        let mut result = 1u8;
        while exponent != 0 {
            if exponent & 1 != 0 {
                result = IndexedShare::gf_mul(ShareFieldProduct { a: result, b: base });
            }
            base = IndexedShare::gf_mul(ShareFieldProduct { a: base, b: base });
            exponent >>= 1;
        }
        result
    }
}

impl IndexedShare {
    fn gf_inv(value: u8) -> u8 {
        debug_assert_ne!(value, 0);
        IndexedShare::gf_pow(ShareFieldPower {
            base: value,
            exponent: 254,
        })
    }
}

impl Drop for IndexedShare {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_subset_reconstructs_exact_secret() -> anyhow::Result<()> {
        let secret = b"threshold-owned secret";
        let shares = IndexedShare::split_secret_bytes(SentinelSecretSplit {
            secret,
            threshold: 2,
            required_participants: 3,
        })?;
        let restored = IndexedShare::reconstruct_secret_bytes(SentinelSecretReconstruction {
            shares: &shares[1..],
            threshold: 2,
        })?;
        assert_eq!(restored, secret);
        Ok(())
    }

    #[test]
    fn rejects_invalid_threshold_before_split() {
        assert!(matches!(
            IndexedShare::split_secret_bytes(SentinelSecretSplit {
                secret: b"secret",
                threshold: 1,
                required_participants: 3,
            }),
            Err(MultiDeviceError::InvalidSentinelThreshold)
        ));
    }

    #[test]
    fn duplicate_share_indexes_cannot_reconstruct() {
        let shares = [
            IndexedShare {
                index: 1,
                bytes: vec![7],
            },
            IndexedShare {
                index: 1,
                bytes: vec![8],
            },
        ];
        assert!(matches!(
            IndexedShare::reconstruct_secret_bytes(SentinelSecretReconstruction {
                shares: &shares,
                threshold: 2,
            }),
            Err(MultiDeviceError::InvalidSentinelShareEncoding)
        ));
    }
}

impl fmt::Debug for IndexedShare {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IndexedShare")
            .field("index", &self.index)
            .field("bytes", &"[REDACTED]")
            .finish()
    }
}
