#[derive(Debug, PartialEq, Eq)]
pub struct CompiledValue(String);

impl CompiledValue {
    #[must_use]
    pub fn render() -> Self {
        Self(hex::encode(b"placeholder"))
    }

    #[must_use]
    pub fn expected_real_source() -> Self {
        Self("7265616c20736f75726365".to_owned())
    }
}
