#![allow(dead_code)]

pub struct ExternalId(u64);

pub struct RawRecord {
    pub raw: u32,
    pub id: ExternalId,
}

pub struct CleanRecord {
    pub id: ExternalId,
}

pub trait RawDefault {
    fn inherited(&self, _raw: u64) {}
}

pub trait RawBound: Iterator<Item = u64> {}

pub trait CleanBound: Iterator<Item = ExternalId> {}

pub trait CleanDefault {
    fn inherited(&self, _id: ExternalId) {}
}

pub mod raw_module {
    pub fn raw(_value: i32) {}
    fn private_raw(_value: u128) {}
}
