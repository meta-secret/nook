// Migration foundation: unactivated scopes keep both lints allow-by-default.
#![allow(dead_code)]
#[allow(unowned_function)]
fn unmigrated() {}
fn main() {}
