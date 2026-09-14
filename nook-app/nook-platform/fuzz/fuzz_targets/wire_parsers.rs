#![no_main]

use libfuzzer_sys::fuzz_target;
use nook_auth2::{DeviceSigningPublicKey, IsoTimestamp, Sha256Hex};
use std::str;

fuzz_target!(|data: &[u8]| {
    if let Ok(candidate) = str::from_utf8(data) {
        drop(DeviceSigningPublicKey::parse(candidate));
        drop(IsoTimestamp::parse(candidate));
        drop(Sha256Hex::parse(candidate));
    }
});
