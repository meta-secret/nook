// aux-build: external_api.rs

#![feature(associated_type_defaults)]
#![allow(dead_code)]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]

extern crate external_api;

pub struct UserId(u64);
pub struct AccountBalance(u64);
pub struct Wrapper<T>(T);
pub type DomainAlias = UserId;

pub fn user<const N: usize>(id: [UserId; N]) -> Option<AccountBalance> {
    let _ = id;
    None
}

pub struct DefaultedDomain<T = DomainAlias>(pub UserId, std::marker::PhantomData<T>);
pub struct ConstDefault<const N: usize = 4>(pub [UserId; N]);

pub trait DomainBound: Iterator<Item = DomainAlias> {}
pub trait TransitiveDomainBound: DomainBound {}

pub fn transitive_domain_bound<T: TransitiveDomainBound>() {}
pub fn external_domain_bound<T: external_api::CleanBound>() {}

pub fn external_domain_projection<D: external_api::CleanAssociatedDecoder>() -> D::Error {
    unimplemented!()
}

pub trait AssociatedDomain {
    type Values: Iterator<Item = DomainAlias>;
}

pub trait AssociatedDomainDefault {
    type Value = DomainAlias;
}

pub trait GenericAssociatedDomain {
    type Values<T: Iterator<Item = DomainAlias>>;
}

pub trait LocalGenericDefault<T> {
    fn inherited(&self, _value: T) {}
}

impl<T: DomainBound> Wrapper<T> {
    pub fn clean(&self) {}
}

struct PrivateWrapper<T>(T);

impl<T> PrivateWrapper<T>
where
    T: Iterator<Item = u64>,
{
    pub fn private_type_method(&self) {}
}

impl<T> Wrapper<T>
where
    T: Iterator<Item = u64>,
{
    fn private_method(&self) {}
}

pub use external_api::{CleanInherent, CleanRecord};

impl external_api::CleanDefault for AccountBalance {}
impl external_api::GenericDefault<UserId> for AccountBalance {}
impl LocalGenericDefault<UserId> for Wrapper<UserId> {}

pub trait GenericAssociatedError {
    type Error;

    fn inherited<D>(&self) -> Result<UserId, D::Error>
    where
        D: Decoder,
    {
        Err(unimplemented!())
    }
}

pub trait Decoder {
    type Error;
}

impl GenericAssociatedError for AccountBalance {
    type Error = DomainError;
}

pub fn wrapped_user(id: Wrapper<UserId>) -> Result<(AccountBalance, UserId), DomainError> {
    let _ = id;
    Err(DomainError)
}

pub struct PublicRecord {
    pub user_id: UserId,
    private_implementation_count: usize,
}

pub enum PublicEvent {
    Balance(AccountBalance),
    User { id: UserId },
}

pub union PublicFfiUnion {
    pub raw_abi_storage: u64,
}

pub struct SerializedRecord {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: stores the validated version in its wire representation"
        )
    )]
    pub wire_version: u32,
}

mod private_implementation {
    pub fn helper(raw: Option<u64>) -> Vec<u32> {
        let _ = raw;
        Vec::new()
    }

    pub struct PrivateRecord {
        pub count: usize,
    }
}

unsafe extern "C" {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: receives an integer owned by the external ABI"
        )
    )]
    pub fn ffi_boundary(raw: u64);
}

#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "database boundary: converts a checked row identifier at the adapter edge"
    )
)]
pub fn database_boundary(raw: i64) {
    let _ = raw;
}

pub struct DomainError;

#[warn(raw_numeric_public_api)]
mod enabling_warn_is_not_suppression {}

#[deny(raw_numeric_public_api)]
mod enabling_deny_is_not_suppression {}

#[forbid(raw_numeric_public_api)]
mod enabling_forbid_is_not_suppression {}

pub async fn async_domain_output<T: Iterator<Item = DomainAlias>>() -> Option<DomainAlias> {
    None
}

pub struct DomainProjection {
    pub values: Box<dyn Iterator<Item = DomainAlias>>,
}

fn main() {}
