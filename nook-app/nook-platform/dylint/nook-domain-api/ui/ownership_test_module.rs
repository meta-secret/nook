// compile-flags: --test --deny=unowned_function
#![allow(dead_code)]
#![deny(unowned_function)]

#[cfg(test)]
mod tests {
    fn helper() {}

    #[test]
    fn test_helpers_are_test_owned() {
        helper();
    }
}
