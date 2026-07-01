use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::Duration;

use crate::error::SdkError;
use crate::models::{CollectionEnvelope, ErrorEnvelope, SuccessEnvelope};

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

    pub fn json_body<T>(&self) -> Result<T, SdkError>
    where
        T: serde::de::DeserializeOwned,
    {
        serde_json::from_str(&self.body)
            .map_err(|error| SdkError::decode(format!("Failed to decode JSON response: {error}")))
    }

    pub fn success_envelope<T>(&self) -> Result<SuccessEnvelope<T>, SdkError>
    where
        T: serde::de::DeserializeOwned,
    {
        self.json_body()
    }

    pub fn collection_envelope<T>(&self) -> Result<CollectionEnvelope<T>, SdkError>
    where
        T: serde::de::DeserializeOwned,
    {
        self.json_body()
    }

    pub fn error_envelope(&self) -> Result<ErrorEnvelope, SdkError> {
        self.json_body()
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

#[derive(Clone, Debug)]
pub struct BlockingHttpTransport {
    agent: ureq::Agent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BlockingHttpTransportConfig {
    pub timeout: Duration,
}

impl Default for BlockingHttpTransportConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
        }
    }
}

impl BlockingHttpTransport {
    pub fn new() -> Self {
        Self::with_config(BlockingHttpTransportConfig::default())
    }

    pub fn with_config(config: BlockingHttpTransportConfig) -> Self {
        Self {
            agent: ureq::AgentBuilder::new().timeout(config.timeout).build(),
        }
    }
}

impl Default for BlockingHttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for BlockingHttpTransport {
    fn send(&self, request: SdkRequest) -> Result<SdkResponse, SdkError> {
        let mut http_request = self.agent.request(&request.method, &request.url);

        for (name, value) in &request.headers {
            http_request = http_request.set(name, value);
        }

        let response = match request.body.as_deref() {
            Some(body) => http_request.send_string(body),
            None => http_request.call(),
        };

        match response {
            Ok(response) => sdk_response_from_http(response),
            Err(ureq::Error::Status(_, response)) => sdk_response_from_http(response),
            Err(error) => Err(SdkError::transport(format!(
                "HTTP transport failed for {} {}: {error}",
                request.method, request.url,
            ))),
        }
    }
}

fn sdk_response_from_http(response: ureq::Response) -> Result<SdkResponse, SdkError> {
    let status_code = response.status();
    let headers = response
        .headers_names()
        .into_iter()
        .filter_map(|name| {
            response
                .header(&name)
                .map(|value| (name.to_ascii_lowercase(), value.to_owned()))
        })
        .collect();
    let body = response.into_string().map_err(|error| {
        SdkError::transport(format!("Failed to read HTTP response body: {error}"))
    })?;

    Ok(SdkResponse {
        status_code,
        headers,
        body,
    })
}
