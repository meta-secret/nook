#![allow(dead_code)]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]

pub struct UserId(u64);
pub struct AccountBalance(u64);
pub struct Wrapper<T>(T);
pub type DomainAlias = UserId;
pub trait DeferredRawBound: Iterator<Item = u64> {}

pub fn user<const N: usize>(id: [UserId; N]) -> Option<AccountBalance> {
    let _ = id;
    None
}

pub fn phase_two_predicate<T: DeferredRawBound>() {}

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
