use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApiFailure {
    pub status_code: u16,
    pub code: Option<String>,
    pub message: Option<String>,
    pub category: Option<String>,
    pub retryable: Option<bool>,
    pub request_id: Option<String>,
    pub correlation_id: Option<String>,
    pub body: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SdkError {
    InvalidConfiguration { message: String },
    InvalidRequest { message: String },
    Transport { message: String },
    Api(ApiFailure),
}

impl SdkError {
    pub fn invalid_configuration(message: impl Into<String>) -> Self {
        Self::InvalidConfiguration {
            message: message.into(),
        }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::InvalidRequest {
            message: message.into(),
        }
    }

    pub fn transport(message: impl Into<String>) -> Self {
        Self::Transport {
            message: message.into(),
        }
    }
}

impl Display for SdkError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            SdkError::InvalidConfiguration { message } => {
                write!(formatter, "invalid SDK configuration: {message}")
            }
            SdkError::InvalidRequest { message } => {
                write!(formatter, "invalid SDK request: {message}")
            }
            SdkError::Transport { message } => write!(formatter, "transport error: {message}"),
            SdkError::Api(failure) => {
                let code = failure.code.as_deref().unwrap_or("unknown_api_error");
                write!(formatter, "OmniWA API error {code} ({})", failure.status_code)
            }
        }
    }
}

impl Error for SdkError {}
