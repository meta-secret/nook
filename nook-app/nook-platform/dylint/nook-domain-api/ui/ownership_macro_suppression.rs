#![allow(dead_code)]
#![deny(unowned_function)]
#![warn(invalid_unowned_function_suppression)]

// A local macro must not bypass suppression auditing. This expectation is
// fulfilled only when the companion lint diagnoses the generated allowance.
macro_rules! invalid_callback {
    () => {
        #[expect(
            invalid_unowned_function_suppression,
            reason = "fixture verifies local macro suppression auditing"
        )]
        #[allow(unowned_function)]
        fn callback() {}
    };
}
invalid_callback!();

// A valid generated callback must actually trigger the ownership lint so the
// compiler fulfills this checked boundary expectation.
macro_rules! required_callback {
    () => {
        #[expect(unowned_function, reason = "FFI boundary: runtime callback symbol")]
        fn required_callback() {}
    };
}
required_callback!();
fn main() {}
