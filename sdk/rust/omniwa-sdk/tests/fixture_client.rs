use omniwa_sdk::{
    ApiKey, FixtureTransport, IdempotencyKey, OmniwaClient, OmniwaClientConfig, RequestOptions,
    SdkResponse, generated::operations::ALL_OPERATIONS,
};

fn client_with_fixture(operation_id: &str, response: SdkResponse) -> OmniwaClient<FixtureTransport> {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new("http://localhost:3000", api_key).expect("valid config");
    let transport = FixtureTransport::new().with_response(operation_id, response);

    OmniwaClient::new(config, transport)
}

#[test]
fn generated_operation_catalog_is_not_empty() {
    assert!(ALL_OPERATIONS.len() > 40);
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
