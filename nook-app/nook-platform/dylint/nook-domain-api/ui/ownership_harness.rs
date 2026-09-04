// compile-flags: --test --warn=unowned_function
#![allow(dead_code)]
#![forbid(invalid_unowned_function_suppression)]

#[test]
fn registered_test() {
    // A nested function is not a test even when it shadows a registered name.
    fn registered_test() {}
    registered_test();
}
fn test_helper() {}
struct Fixture;
impl Fixture {
    fn prepare() {}
}
