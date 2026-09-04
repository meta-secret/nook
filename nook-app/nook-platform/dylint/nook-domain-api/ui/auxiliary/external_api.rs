#![allow(dead_code)]

pub struct ExternalId(u64);

pub struct RawRecord {
    pub raw: u32,
    pub id: ExternalId,
}

pub struct CleanRecord {
    pub id: ExternalId,
}

pub struct RawInherent {
    id: ExternalId,
}

impl RawInherent {
    pub fn raw_id(&self) -> u64 {
        0
    }
}

pub struct CleanInherent {
    id: ExternalId,
}

impl CleanInherent {
    pub fn id(&self) -> ExternalId {
        ExternalId(0)
    }
}

pub trait RawDefault {
    fn inherited(&self, _raw: u64) {}
}

pub trait RawBound: Iterator<Item = u64> {}

pub trait CleanBound: Iterator<Item = ExternalId> {}

pub trait CleanDefault {
    fn inherited(&self, _id: ExternalId) {}
}

pub trait GenericDefault<T> {
    fn inherited(&self, _value: T) {}
}

pub trait ReferenceRawDefault {
    fn inherited(&self) -> u64 {
        0
    }
}

pub trait ExternalMarker<T> {}

struct Marker;

impl ExternalMarker<u64> for Marker {}

pub fn raw_opaque() -> impl ExternalMarker<u64> {
    Marker
}

pub mod raw_module {
    pub fn raw(_value: i32) {}
    fn private_raw(_value: u128) {}
}
