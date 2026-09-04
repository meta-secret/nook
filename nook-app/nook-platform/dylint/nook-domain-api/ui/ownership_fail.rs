// compile-flags: --warn=unowned_function
#![allow(dead_code)]

pub fn public_operation() {}
fn private_operation() {}
mod lookalikes {
    pub fn main() {}
    pub fn test_helper() {}
}
struct Owner;
impl Owner {
    fn perform() {
        fn nested_operation() {}
        nested_operation();
    }
}
macro_rules! local_functions {
    ($name:ident) => {
        fn $name() {}
    };
}
local_functions!(macro_operation);
fn main() {}
