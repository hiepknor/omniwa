use crate::auth::ApiKey;
use crate::error::{ApiFailure, SdkError};
use crate::generated::operations::Operation;
use crate::idempotency::IdempotencyKey;
use crate::resources::{
    chats::ChatsClient, contacts::ContactsClient, dashboard::DashboardClient, events::EventsClient,
    groups::GroupsClient, health::HealthClient, instances::InstancesClient, jobs::JobsClient,
    labels::LabelsClient, messages::MessagesClient, webhooks::WebhooksClient,
};
use crate::transport::{SdkRequest, SdkResponse, Transport};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OmniwaClientConfig {
    pub base_url: String,
    pub api_key: ApiKey,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RequestOptions {
    pub request_id: Option<String>,
    pub correlation_id: Option<String>,
    pub trace_id: Option<String>,
    pub idempotency_key: Option<IdempotencyKey>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestBody {
    Json(String),
}

pub struct OmniwaClient<TTransport> {
    config: OmniwaClientConfig,
    transport: TTransport,
}

impl OmniwaClientConfig {
    pub fn new(base_url: impl Into<String>, api_key: ApiKey) -> Result<Self, SdkError> {
        let base_url = base_url.into().trim().trim_end_matches('/').to_owned();

        if base_url.is_empty() {
            return Err(SdkError::invalid_configuration(
                "Base URL must be a non-empty string.",
            ));
        }

        Ok(Self { base_url, api_key })
    }
}

impl<TTransport> OmniwaClient<TTransport>
where
    TTransport: Transport,
{
    pub fn new(config: OmniwaClientConfig, transport: TTransport) -> Self {
        Self { config, transport }
    }

    pub fn health(&self) -> HealthClient<'_, TTransport> {
        HealthClient::new(self)
    }

    pub fn dashboard(&self) -> DashboardClient<'_, TTransport> {
        DashboardClient::new(self)
    }

    pub fn events(&self) -> EventsClient<'_, TTransport> {
        EventsClient::new(self)
    }

    pub fn chats(&self) -> ChatsClient<'_, TTransport> {
        ChatsClient::new(self)
    }

    pub fn contacts(&self) -> ContactsClient<'_, TTransport> {
        ContactsClient::new(self)
    }

    pub fn groups(&self) -> GroupsClient<'_, TTransport> {
        GroupsClient::new(self)
    }

    pub fn labels(&self) -> LabelsClient<'_, TTransport> {
        LabelsClient::new(self)
    }

    pub fn instances(&self) -> InstancesClient<'_, TTransport> {
        InstancesClient::new(self)
    }

    pub fn messages(&self) -> MessagesClient<'_, TTransport> {
        MessagesClient::new(self)
    }

    pub fn jobs(&self) -> JobsClient<'_, TTransport> {
        JobsClient::new(self)
    }

    pub fn webhooks(&self) -> WebhooksClient<'_, TTransport> {
        WebhooksClient::new(self)
    }

    pub fn execute(
        &self,
        operation: Operation,
        path_params: &[(&str, &str)],
        query: &[(&str, &str)],
        body: Option<RequestBody>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        let path = expand_path(operation.path, path_params)?;
        let url = build_url(&self.config.base_url, &path, query);
        let body = body.map(|request_body| match request_body {
            RequestBody::Json(value) => value,
        });
        let request = SdkRequest {
            operation_id: operation.operation_id.to_owned(),
            method: operation.method.to_owned(),
            path,
            url,
            headers: build_headers(&self.config.api_key, body.is_some(), options),
            body,
        };
        let response = self.transport.send(request)?;

        if response.is_success() {
            return Ok(response);
        }

        Err(SdkError::Api(api_failure_from_response(response)))
    }
}

fn api_failure_from_response(response: SdkResponse) -> ApiFailure {
    let status_code = response.status_code;
    let request_id = response.header("x-request-id").map(str::to_owned);
    let correlation_id = response.header("x-correlation-id").map(str::to_owned);
    let body = response.body.clone();

    match response.error_envelope() {
        Ok(envelope) => ApiFailure {
            status_code,
            code: Some(envelope.error.code),
            message: Some(envelope.error.message),
            category: envelope.error.details.category,
            retryable: envelope.error.details.retryable,
            request_id: Some(envelope.meta.request_id),
            correlation_id: Some(envelope.meta.correlation_id),
            body,
        },
        Err(_) => ApiFailure {
            status_code,
            code: None,
            message: None,
            category: None,
            retryable: None,
            request_id,
            correlation_id,
            body,
        },
    }
}

fn expand_path(template: &str, path_params: &[(&str, &str)]) -> Result<String, SdkError> {
    let mut path = template.to_owned();

    for (name, value) in path_params {
        path = path.replace(&format!("{{{name}}}"), &encode_path_segment(value));
    }

    if path.contains('{') || path.contains('}') {
        return Err(SdkError::invalid_request(format!(
            "Missing path parameter for {template}."
        )));
    }

    Ok(path)
}

fn build_url(base_url: &str, path: &str, query: &[(&str, &str)]) -> String {
    if query.is_empty() {
        return format!("{base_url}{path}");
    }

    let query_string = query
        .iter()
        .map(|(name, value)| format!("{}={}", encode_query_value(name), encode_query_value(value)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{base_url}{path}?{query_string}")
}

fn build_headers(
    api_key: &ApiKey,
    has_body: bool,
    options: RequestOptions,
) -> Vec<(String, String)> {
    let mut headers = vec![
        ("accept".to_owned(), "application/json".to_owned()),
        (
            "x-api-key".to_owned(),
            api_key.expose_header_value().to_owned(),
        ),
    ];

    if has_body {
        headers.push(("content-type".to_owned(), "application/json".to_owned()));
    }

    if let Some(request_id) = options.request_id {
        headers.push(("x-request-id".to_owned(), request_id));
    }

    if let Some(correlation_id) = options.correlation_id {
        headers.push(("x-correlation-id".to_owned(), correlation_id));
    }

    if let Some(trace_id) = options.trace_id {
        headers.push(("x-trace-id".to_owned(), trace_id));
    }

    if let Some(idempotency_key) = options.idempotency_key {
        headers.push((
            "idempotency-key".to_owned(),
            idempotency_key.as_header_value().to_owned(),
        ));
    }

    headers
}

fn encode_path_segment(value: &str) -> String {
    encode_component(value)
}

fn encode_query_value(value: &str) -> String {
    encode_component(value)
}

fn encode_component(value: &str) -> String {
    let mut encoded = String::new();

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }

    encoded
}
