// aux-build: external_api.rs

#![feature(associated_type_defaults)]
#![allow(dead_code)]
#![allow(private_interfaces)]

pub extern crate external_api;

pub type RawAlias = u128;
pub type RawSink = dyn Fn(u64) -> RawAlias;

pub struct Wrapper<T>(T);

pub type EveryNumericPrimitive = (
    u8,
    u16,
    u32,
    u64,
    u128,
    i8,
    i16,
    i32,
    i64,
    i128,
    usize,
    isize,
    f32,
    f64,
);

pub fn every_numeric_primitive(_value: EveryNumericPrimitive) {}

pub fn direct_parameter(_id: u64) -> Option<Result<Vec<(u16, i32)>, f64>> {
    None
}

pub fn aliased_return() -> RawAlias {
    0
}

pub fn tuple_parameter(_value: (UserId, u32)) -> [i16; 2] {
    [0; 2]
}

pub fn borrowed_slice(_value: &[u8]) -> &UserId {
    panic!()
}

pub fn callback_parameter(_callback: fn(u16) -> i8, _pointer: *const i64) {}

unsafe extern "C" {
    pub fn raw_foreign(_raw: u32) -> i32;
}

pub trait PublicTrait {
    fn retry_count(&self) -> usize;

    fn default_timeout(&self) -> u64 {
        0
    }
}

pub struct UserId(u64);

impl UserId {
    pub fn exposed_method(&self, _count: Option<u32>) {}
}

pub struct PublicRecord {
    pub direct: usize,
    pub nested: Wrapper<Option<[i8; 4]>>,
    private_implementation: u32,
}

pub struct PublicTuple(pub isize, u32);

pub enum PublicEvent {
    Direct(f32),
    Nested { values: Result<Vec<u8>, i64> },
}

mod reachable_only {
    pub struct Leaked {
        pub raw: u64,
    }
}

pub fn leak_reachable_type() -> reachable_only::Leaked {
    reachable_only::Leaked { raw: 0 }
}

pub async fn async_raw_output() -> Option<RawAlias> {
    None
}

pub struct ProjectedField {
    pub values: Box<RawSink>,
}

pub struct Defaulted<T = RawAlias>(pub UserId, std::marker::PhantomData<T>);

pub trait LocalRaw: Iterator<Item = RawAlias> {}

pub fn named_bound<T: LocalRaw>() {}

pub fn external_named_bound<T: external_api::RawBound>() {}

pub fn unresolved_external_projection<D: external_api::RawAssociatedDecoder>() -> D::Error {
    unimplemented!()
}

pub fn nested_unresolved_external_projection<D: external_api::RawAssociatedDecoder>()
-> Result<UserId, D::Error> {
    unimplemented!()
}

pub fn nested_bound_projection<D: external_api::NestedRawAssociatedDecoder>() -> D::Error {
    unimplemented!()
}

pub fn inline_projection<T: Iterator<Item = RawAlias>>() {}

pub fn where_projection<T>()
where
    T: Iterator<Item = RawAlias>,
{
}

pub trait AssociatedBound {
    type Values: Iterator<Item = RawAlias>;
}

pub trait AssociatedDefault {
    type Value = RawAlias;
}

pub trait GenericAssociatedType {
    type Values<T: Iterator<Item = RawAlias>>;
}

pub trait LocalGenericDefault<T> {
    fn inherited(&self, _value: T) {}
}

pub trait EnclosingTrait<T>
where
    T: Iterator<Item = RawAlias>,
{
    fn clean(&self);
}

impl<T> Wrapper<T>
where
    T: Iterator<Item = RawAlias>,
{
    pub fn clean(&self) {}
}

pub use external_api::RawRecord;
pub use external_api::raw_module::*;
pub use external_api::{RawInherent, raw_opaque};

impl external_api::RawDefault for UserId {}
impl external_api::GenericDefault<u64> for UserId {}
impl external_api::ReferenceRawDefault for &UserId {}
impl LocalGenericDefault<u64> for Wrapper<UserId> {}

pub struct Pair(u64, u64);

impl From<u64> for Pair {
    fn from(value: u64) -> Self {
        Self(value, value)
    }
}

pub trait FromLike<T> {
    fn from_like(value: T) -> Self;
}

impl FromLike<u64> for UserId {
    fn from_like(value: u64) -> Self {
        Self(value)
    }
}

pub struct PredicateCount(usize);

impl From<usize> for PredicateCount
where
    usize: Copy,
{
    fn from(value: usize) -> Self {
        Self(value)
    }
}

fn main() {}
