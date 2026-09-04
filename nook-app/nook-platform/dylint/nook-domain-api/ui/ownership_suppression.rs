// compile-flags: --warn=unowned_function --warn=invalid_unowned_function_suppression
#![allow(dead_code, unfulfilled_lint_expectations)]
#![expect(unowned_function, reason = "FFI boundary: blanket crate exception")]

#[expect(
    unowned_function,
    reason = "framework boundary: blanket module exception"
)]
mod broad {
    // Blanket expectations are invalid even on an empty module.
}
#[expect(unowned_function, reason = "FFI boundary: a type is not a callback")]
struct Owner;
impl Owner {
    #[expect(
        unowned_function,
        reason = "FFI boundary: an owned method needs no exception"
    )]
    fn method() {}
}
#[expect(unowned_function)]
fn missing_reason() {}
#[expect(unowned_function, reason = "FFI boundary:   ")]
fn empty_detail() {}
#[expect(unowned_function, reason = "domain boundary: utility convenience")]
fn unrelated_reason() {}
#[allow(unowned_function, reason = "FFI boundary: use a checked expectation")]
fn blanket_allow() {}
#[expect(
    unowned_function,
    reason = "FFI boundary: main is already externally owned"
)]
fn main() {}
