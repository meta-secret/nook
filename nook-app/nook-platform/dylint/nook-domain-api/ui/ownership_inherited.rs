// compile-flags: --forbid=invalid_unowned_function_suppression
#![allow(dead_code)]
#![deny(unowned_function)]

#[expect(unowned_function, reason = "FFI boundary: C loader callback")]
extern "C" fn callback() {
    fn helper() {}
    let invoke = || helper();
    invoke();
}
fn main() {}
