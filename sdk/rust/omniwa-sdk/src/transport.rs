use std::cell::RefCell;
use std::collections::BTreeMap;

use crate::error::SdkError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SdkRequest {
    pub operation_id: String,
    pub method: String,
    pub path: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

impl SdkRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SdkResponse {
    pub status_code: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl SdkResponse {
    pub fn json(status_code: u16, body: impl Into<String>) -> Self {
        Self {
            status_code,
            headers: vec![(
                "content-type".to_owned(),
                "application/json; charset=utf-8".to_owned(),
            )],
            body: body.into(),
        }
    }

    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status_code)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub trait Transport {
    fn send(&self, request: SdkRequest) -> Result<SdkResponse, SdkError>;
}

#[derive(Debug, Default)]
pub struct FixtureTransport {
    responses: BTreeMap<String, SdkResponse>,
    requests: RefCell<Vec<SdkRequest>>,
}

impl FixtureTransport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_response(mut self, operation_id: impl Into<String>, response: SdkResponse) -> Self {
        self.responses.insert(operation_id.into(), response);
        self
    }

    pub fn recorded_requests(&self) -> Vec<SdkRequest> {
        self.requests.borrow().clone()
    }
}

impl Transport for FixtureTransport {
    fn send(&self, request: SdkRequest) -> Result<SdkResponse, SdkError> {
        let operation_id = request.operation_id.clone();
        let response = self.responses.get(&operation_id).cloned().ok_or_else(|| {
            SdkError::transport(format!("No fixture for operation {operation_id}."))
        })?;

        self.requests.borrow_mut().push(request);

        Ok(response)
    }
}
