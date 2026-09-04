#![allow(dead_code)]
#![expect(
    raw_numeric_public_api,
    reason = "FFI boundary: crate-wide escape hatch"
)]

pub fn crate_suppressed(_raw: u8) {}

#[expect(
    raw_numeric_public_api,
    reason = "database boundary: module-wide escape hatch"
)]
mod broad_module {
    pub fn module_suppressed(_raw: u16) {}
}

#[expect(raw_numeric_public_api)]
pub fn reasonless(_raw: u32) {}

#[expect(
    raw_numeric_public_api,
    reason = "domain boundary: not an infrastructure edge"
)]
pub fn wrong_category(_raw: u64) {}

#[allow(
    raw_numeric_public_api,
    reason = "serialization boundary: allow is too broad"
)]
pub fn allow_instead_of_expect(_raw: u128) {}

fn main() {}
