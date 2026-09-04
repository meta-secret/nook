#![allow(dead_code)]
#![allow(private_interfaces)]

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

pub trait Raw: Iterator<Item = RawAlias> {}

pub fn leak_reachable_type<T: Raw>() -> reachable_only::Leaked {
    reachable_only::Leaked { raw: 0 }
}

pub async fn async_raw_output() -> Option<RawAlias> {
    None
}

pub struct ProjectedField {
    pub values: Box<RawSink>,
}

fn main() {}
