use omniwa_sdk::{
    generated::operations::ALL_OPERATIONS, parse_sse_events, ApiKey, FixtureTransport,
    IdempotencyKey, OmniwaClient, OmniwaClientConfig, RequestOptions, SdkResponse,
};

fn client_with_fixture(
    operation_id: &str,
    response: SdkResponse,
) -> OmniwaClient<FixtureTransport> {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new("http://localhost:3000", api_key).expect("valid config");
    let transport = FixtureTransport::new().with_response(operation_id, response);

    OmniwaClient::new(config, transport)
}

#[test]
fn generated_operation_catalog_is_not_empty() {
    assert!(ALL_OPERATIONS.len() >= 71);
}

#[test]
fn health_client_calls_fixture_with_api_key() {
    let client = client_with_fixture(
        "getHealth",
        SdkResponse::json(
            200,
            r#"{"data":{"status":"ok"},"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );

    let response = client.health().get().expect("fixture response");

    assert_eq!(response.status_code, 200);
}

#[test]
fn message_client_sends_idempotency_key() {
    let client = client_with_fixture(
        "sendInstanceTextMessage",
        SdkResponse::json(
            202,
            r#"{"data":{"accepted":true},"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );
    let options = RequestOptions {
        idempotency_key: Some(IdempotencyKey::new("idem-demo").expect("valid idempotency key")),
        ..RequestOptions::default()
    };

    let response = client
        .messages()
        .send_text_json(
            "instance_demo",
            r#"{"to":"contact_ref_demo","text":"Hello from OmniWA"}"#,
            options,
        )
        .expect("fixture response");

    assert_eq!(response.status_code, 202);
}

#[test]
fn api_error_maps_to_sdk_error() {
    let client = client_with_fixture(
        "listInstances",
        SdkResponse::json(
            401,
            r#"{"error":{"code":"missing_or_invalid_api_key","message":"API request requires a valid x-api-key header.","details":{"category":"authentication"}},"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );

    let error = client.instances().list().expect_err("API error");

    assert!(format!("{error}").contains("OmniWA API error"));
}

#[test]
fn projection_read_clients_use_generated_operations() {
    let dashboard_client = client_with_fixture(
        "getDashboardSummary",
        SdkResponse::json(
            200,
            r#"{"data":{"status":"ok"},"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );
    let jobs_client = client_with_fixture(
        "listJobs",
        SdkResponse::json(
            200,
            r#"{"data":[],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );

    assert_eq!(dashboard_client.dashboard().get().unwrap().status_code, 200);
    assert_eq!(jobs_client.jobs().list().unwrap().status_code, 200);
}

#[test]
fn events_client_streams_sse_fixture() {
    let client = client_with_fixture(
        "streamEvents",
        SdkResponse {
            status_code: 200,
            headers: vec![("content-type".to_owned(), "text/event-stream".to_owned())],
            body: "id: cursor_1\nevent: message.delivered.v1\ndata: {\"cursor\":\"cursor_1\"}\n\n"
                .to_owned(),
        },
    );

    let response = client.events().stream().expect("fixture response");
    let events = parse_sse_events(&response.body).expect("valid SSE");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id.as_deref(), Some("cursor_1"));
    assert_eq!(events[0].event.as_deref(), Some("message.delivered.v1"));
}

#[test]
fn groups_client_uses_resource_operations() {
    let client = client_with_fixture(
        "listInstanceGroups",
        SdkResponse::json(
            200,
            r#"{"data":[],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );

    let response = client
        .groups()
        .list_for_instance("instance_demo")
        .expect("fixture response");

    assert_eq!(response.status_code, 200);
}

#[test]
fn navigation_clients_use_phase_i_resource_operations() {
    let chat_client = client_with_fixture(
        "listInstanceChats",
        SdkResponse::json(
            200,
            r#"{"data":[],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );
    let contact_client = client_with_fixture(
        "getContact",
        SdkResponse::json(
            200,
            r#"{"data":{"id":"contact_demo"},"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );
    let label_client = client_with_fixture(
        "listLabels",
        SdkResponse::json(
            200,
            r#"{"data":[],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
        ),
    );

    assert_eq!(
        chat_client
            .chats()
            .list_for_instance("instance_demo")
            .unwrap()
            .status_code,
        200,
    );
    assert_eq!(
        contact_client
            .contacts()
            .get("contact_demo")
            .unwrap()
            .status_code,
        200,
    );
    assert_eq!(label_client.labels().list().unwrap().status_code, 200);
}
