#[derive(Debug, PartialEq, Eq)]
pub struct CompiledValue(String);

impl CompiledValue {
    #[must_use]
    pub fn render() -> Self {
        Self(hex::encode(b"placeholder"))
    }
}
