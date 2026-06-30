use crate::error::SdkError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdempotencyKey {
    value: String,
}

impl IdempotencyKey {
    pub fn new(value: impl Into<String>) -> Result<Self, SdkError> {
        let value = value.into().trim().to_owned();

        if value.is_empty() {
            return Err(SdkError::invalid_request(
                "Idempotency key must be a non-empty string.",
            ));
        }

        Ok(Self { value })
    }

    pub fn as_header_value(&self) -> &str {
        &self.value
    }
}
