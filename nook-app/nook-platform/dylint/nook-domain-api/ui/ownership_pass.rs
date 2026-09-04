// aux-build: ownership_external.rs
#![allow(dead_code)]
#![deny(unowned_function)]
#![forbid(invalid_unowned_function_suppression)]

extern crate ownership_external;
ownership_external::framework_functions!();

struct Draft;
struct Ready;
impl Draft {
    fn validate(self) -> Ready {
        let finish = || Ready;
        finish()
    }
}
impl Ready {
    fn finish(self) {}
}
trait Action {
    fn perform(self);
    fn describe(&self) {}
}
impl Action for Ready {
    fn perform(self) {
        self.finish();
    }
}
unsafe extern "C" {
    fn foreign_callback();
}
#[expect(
    unowned_function,
    reason = "FFI boundary: C loader resolves this symbol"
)]
#[unsafe(no_mangle)]
extern "C" fn loader_callback() {}
#[expect(
    unowned_function,
    reason = "framework boundary: router registers this free callback"
)]
fn framework_callback() {
    #[expect(unowned_function, reason = "FFI boundary: nested C runtime callback")]
    extern "C" fn nested_callback() {}
    let invoke = || nested_callback();
    invoke();
}
fn main() {
    Draft.validate().perform();
}
