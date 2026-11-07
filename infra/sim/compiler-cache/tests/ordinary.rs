use nook_compiler_cache_proof::CompiledValue;

#[test]
fn ordinary_rlib_contains_real_source() {
    assert_eq!(
        CompiledValue::render(),
        CompiledValue::expected_real_source()
    );
}
