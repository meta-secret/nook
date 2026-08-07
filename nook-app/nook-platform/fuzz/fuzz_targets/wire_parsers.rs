#![no_main]

use libfuzzer_sys::fuzz_target;
use nook_auth2::{DeviceSigningPublicKey, IsoTimestamp, Sha256Hex};

fuzz_target!(|data: &[u8]| {
    if let Ok(candidate) = std::str::from_utf8(data) {
        let _ = DeviceSigningPublicKey::parse(candidate);
        let _ = IsoTimestamp::parse(candidate);
        let _ = Sha256Hex::parse(candidate);
    }
});
