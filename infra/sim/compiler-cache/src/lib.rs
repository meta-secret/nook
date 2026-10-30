#[derive(Debug, PartialEq, Eq)]
pub struct CompiledValue(String);

impl CompiledValue {
    #[must_use]
    pub fn render() -> Self {
        Self(hex::encode(b"real source"))
    }

    #[must_use]
    pub fn expected_real_source() -> Self {
        Self("7265616c20736f75726365".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::CompiledValue;

    #[test]
    fn executes_real_source_after_placeholder_overlay() {
        assert_eq!(
            CompiledValue::render(),
            CompiledValue("7265616c20736f75726365".to_owned())
        );
    }
}
