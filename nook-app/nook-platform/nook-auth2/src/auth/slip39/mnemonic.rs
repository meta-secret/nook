#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::errors::{MultiDeviceError, MultiDeviceResult};

use super::{
    CHECKSUM_WORDS, EXTENDABLE_CUSTOMIZATION, METADATA_WORDS, MNEMONIC_WORDS_256, SECRET_BYTES,
};

const WORDLIST: &str = include_str!("../slip39_wordlist.txt");

#[derive(Clone)]
pub(super) struct Share {
    pub(super) identifier: u16,
    pub(super) iteration_exponent: u8,
    pub(super) member_index: u8,
    pub(super) member_threshold: u8,
    pub(super) value: Vec<u8>,
}

impl Share {
    pub(super) fn encode(&self) -> MultiDeviceResult<String> {
        if self.value.len() != SECRET_BYTES
            || self.member_threshold == 0
            || self.member_threshold > 16
            || self.member_index > 15
            || self.iteration_exponent > 15
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        let id_ext_exponent =
            (u32::from(self.identifier) << 5) | (1_u32 << 4) | u32::from(self.iteration_exponent);
        // GI=0, GT-1=0, G-1=0, followed by I and T-1.
        let group_member_parameters =
            (u32::from(self.member_index) << 4) | u32::from(self.member_threshold - 1);
        let mut indices = MnemonicWords::integer_words(id_ext_exponent, 2);
        indices.extend(MnemonicWords::integer_words(group_member_parameters, 2));
        indices.extend(MnemonicWords::bytes_to_words(&self.value));
        indices.extend(Checksum::create(&indices));
        let words = WordList::values();
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

    pub(super) fn decode(mnemonic: &str) -> MultiDeviceResult<Self> {
        let words = WordList::values();
        let indices = mnemonic
            .split_whitespace()
            .map(|word| {
                words
                    .binary_search(&word)
                    .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)
                    .and_then(|index| {
                        u16::try_from(index)
                            .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)
                    })
            })
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        if indices.len() != MNEMONIC_WORDS_256 || !Checksum::verify(&indices) {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }

        let id_ext_exponent = MnemonicWords::words_to_u32(&indices[..2]);
        let identifier = u16::try_from(id_ext_exponent >> 5)
            .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
        let extendable = (id_ext_exponent >> 4) & 1;
        let iteration_exponent = (id_ext_exponent & 0x0f) as u8;
        if identifier > 0x7fff || extendable != 1 {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }

        let parameters = MnemonicWords::words_to_u32(&indices[2..METADATA_WORDS]);
        let group_index = ((parameters >> 16) & 0x0f) as u8;
        let group_threshold = ((parameters >> 12) & 0x0f) as u8 + 1;
        let group_count = ((parameters >> 8) & 0x0f) as u8 + 1;
        let member_index = ((parameters >> 4) & 0x0f) as u8;
        let member_threshold = (parameters & 0x0f) as u8 + 1;
        if group_index != 0 || group_threshold != 1 || group_count != 1 {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }

        let value_words = &indices[METADATA_WORDS..indices.len() - CHECKSUM_WORDS];
        let value = MnemonicWords::words_to_bytes(value_words)?;
        if value.len() != SECRET_BYTES {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        Ok(Self {
            identifier,
            iteration_exponent,
            member_index,
            member_threshold,
            value,
        })
    }
}

pub(super) struct WordList;

impl WordList {
    pub(super) fn values() -> Vec<&'static str> {
        WORDLIST.lines().collect()
    }
}

struct MnemonicWords;

impl MnemonicWords {
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
                bytes[bit / 8] |= 1 << (7 - source % 10);
            }
        }
        Ok(bytes)
    }
}

pub(super) struct Checksum;

impl Checksum {
    pub(super) fn create(data: &[u16]) -> [u16; CHECKSUM_WORDS] {
        let values = EXTENDABLE_CUSTOMIZATION
            .iter()
            .map(|byte| u16::from(*byte))
            .chain(data.iter().copied())
            .chain([0_u16; CHECKSUM_WORDS]);
        let checksum = Self::polymod(values) ^ 1;
        [
            ((checksum >> 20) & 1023) as u16,
            ((checksum >> 10) & 1023) as u16,
            (checksum & 1023) as u16,
        ]
    }

    pub(super) fn verify(data: &[u16]) -> bool {
        Self::polymod(
            EXTENDABLE_CUSTOMIZATION
                .iter()
                .map(|byte| u16::from(*byte))
                .chain(data.iter().copied()),
        ) == 1
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
}
