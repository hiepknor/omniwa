use omniwa_sdk::{
    generated::operations::ALL_OPERATIONS, parse_sse_events, ApiKey, FixtureTransport,
    GroupMemberResource, IdempotencyKey, InstanceResource, OmniwaClient, OmniwaClientConfig,
    PublicData, PublicOperationData, RequestOptions, SdkError, SdkResponse,
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
    let envelope = response
        .success_envelope::<PublicData>()
        .expect("typed success envelope");

    assert_eq!(response.status_code, 200);
    assert_eq!(envelope.meta.request_id, "req_demo");
    assert_eq!(envelope.data["status"], "ok");
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
fn message_client_exposes_retry_and_cancel_mutations() {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new("http://localhost:3000", api_key).expect("valid config");
    let transport = FixtureTransport::new()
        .with_response(
            "retryMessage",
            SdkResponse::json(
                202,
                r#"{"data":{"resourceType":"message","resourceId":"msg_failed","operationStatus":"queued","accepted":true,"retryable":false,"async":true,"resultRef":"msg_retry"},"meta":{"requestId":"req_retry","correlationId":"corr_retry","timestamp":"2026-07-04T00:00:00.000Z"}}"#,
            ),
        )
        .with_response(
            "cancelMessage",
            SdkResponse::json(
                202,
                r#"{"data":{"resourceType":"message","resourceId":"msg_queued","operationStatus":"accepted","accepted":true,"retryable":false,"async":true,"resultRef":"msg_queued"},"meta":{"requestId":"req_cancel","correlationId":"corr_cancel","timestamp":"2026-07-04T00:00:00.000Z"}}"#,
            ),
        );
    let client = OmniwaClient::new(config, transport);
    let retry_options = RequestOptions {
        idempotency_key: Some(
            IdempotencyKey::new("idem-retry-demo").expect("valid retry idempotency key"),
        ),
        ..RequestOptions::default()
    };
    let cancel_options = RequestOptions {
        idempotency_key: Some(
            IdempotencyKey::new("idem-cancel-demo").expect("valid cancel idempotency key"),
        ),
        ..RequestOptions::default()
    };

    let retry = client
        .messages()
        .retry_json("msg_failed", "{}", retry_options)
        .expect("retry fixture response")
        .success_envelope::<PublicOperationData>()
        .expect("retry operation envelope");
    let cancel = client
        .messages()
        .cancel_json("msg_queued", "{}", cancel_options)
        .expect("cancel fixture response")
        .success_envelope::<PublicOperationData>()
        .expect("cancel operation envelope");

    assert_eq!(retry.data.operation_status, "queued");
    assert_eq!(retry.data.result_ref.as_deref(), Some("msg_retry"));
    assert_eq!(cancel.data.operation_status, "accepted");
    assert_eq!(cancel.data.result_ref.as_deref(), Some("msg_queued"));
}

#[test]
fn webhooks_client_exposes_delivery_retry_mutation() {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new("http://localhost:3000", api_key).expect("valid config");
    let transport = FixtureTransport::new().with_response(
        "retryWebhookDelivery",
        SdkResponse::json(
            202,
            r#"{"data":{"resourceType":"webhookDelivery","resourceId":"webhook_delivery_demo","operationStatus":"queued","accepted":true,"retryable":false,"async":true,"resultRef":"webhook_delivery_demo"},"meta":{"requestId":"req_webhook_retry","correlationId":"corr_webhook_retry","timestamp":"2026-07-05T00:00:00.000Z"}}"#,
        ),
    );
    let client = OmniwaClient::new(config, transport);
    let options = RequestOptions {
        idempotency_key: Some(
            IdempotencyKey::new("idem-webhook-retry-demo")
                .expect("valid webhook retry idempotency key"),
        ),
        ..RequestOptions::default()
    };

    let retry = client
        .webhooks()
        .retry_delivery_json("webhook_delivery_demo", "{}", options)
        .expect("webhook delivery retry fixture response")
        .success_envelope::<PublicOperationData>()
        .expect("webhook delivery retry operation envelope");

    assert_eq!(retry.data.operation_status, "queued");
    assert_eq!(
        retry.data.result_ref.as_deref(),
        Some("webhook_delivery_demo")
    );
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
    match error {
        SdkError::Api(failure) => {
            assert_eq!(failure.code.as_deref(), Some("missing_or_invalid_api_key"));
            assert_eq!(
                failure.message.as_deref(),
                Some("API request requires a valid x-api-key header.")
            );
            assert_eq!(failure.category.as_deref(), Some("authentication"));
            assert_eq!(failure.request_id.as_deref(), Some("req_demo"));
            assert_eq!(failure.correlation_id.as_deref(), Some("corr_demo"));
        }
        unexpected => panic!("unexpected error: {unexpected:?}"),
    }
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
fn groups_client_exposes_controlled_mutations() {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new("http://localhost:3000", api_key).expect("valid config");
    let operation_fixture = |result_ref: &'static str, operation_status: &'static str| {
        SdkResponse::json(
            202,
            format!(
                r#"{{"data":{{"resourceType":"group","resourceId":"group_demo","operationStatus":"{}","accepted":true,"retryable":false,"async":false,"resultRef":"{}"}},"meta":{{"requestId":"req_group","correlationId":"corr_group","timestamp":"2026-07-04T00:00:00.000Z"}}}}"#,
                operation_status, result_ref
            ),
        )
    };
    let transport = FixtureTransport::new()
        .with_response("updateGroup", operation_fixture("group_demo", "completed"))
        .with_response(
            "updateGroupLocalState",
            operation_fixture("group_demo", "completed"),
        )
        .with_response(
            "addGroupMember",
            operation_fixture("group_demo", "accepted"),
        )
        .with_response(
            "promoteGroupMember",
            operation_fixture("group_demo", "accepted"),
        )
        .with_response(
            "demoteGroupMember",
            operation_fixture("group_demo", "accepted"),
        )
        .with_response(
            "removeGroupMember",
            operation_fixture("group_demo", "accepted"),
        );
    let client = OmniwaClient::new(config, transport);
    let options = || RequestOptions {
        idempotency_key: Some(
            IdempotencyKey::new("idem-group-demo").expect("valid group idempotency key"),
        ),
        ..RequestOptions::default()
    };

    assert_eq!(
        client
            .groups()
            .update_json("group_demo", r#"{"subject":"Support"}"#, options())
            .expect("update group fixture")
            .status_code,
        202,
    );
    assert_eq!(
        client
            .groups()
            .update_local_state_json("group_demo", r#"{"archived":true}"#, options())
            .expect("update local state fixture")
            .status_code,
        202,
    );
    let added = client
        .groups()
        .add_member_json(
            "group_demo",
            r#"{"jid":"12025550123@s.whatsapp.net"}"#,
            options(),
        )
        .expect("add member fixture")
        .success_envelope::<PublicOperationData>()
        .expect("add member operation envelope");
    assert_eq!(added.data.operation_status, "accepted");
    assert_eq!(
        client
            .groups()
            .promote_member("group_demo", "group_demo:member:1", "{}", options())
            .expect("promote member fixture")
            .status_code,
        202,
    );
    assert_eq!(
        client
            .groups()
            .demote_member("group_demo", "group_demo:member:1", "{}", options())
            .expect("demote member fixture")
            .status_code,
        202,
    );
    assert_eq!(
        client
            .groups()
            .remove_member("group_demo", "group_demo:member:1", "{}", options())
            .expect("remove member fixture")
            .status_code,
        202,
    );
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

#[test]
fn collection_envelope_decodes_into_cursor_page() {
    let response = SdkResponse::json(
        200,
        r#"{"data":[{"id":"one"},{"id":"two"}],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z","pagination":{"nextCursor":"next_1","previousCursor":null,"hasMore":true,"limit":200,"sort":"-createdAt","search":"demo","filters":{"status":"connected"}}}}"#,
    );
    let envelope = response
        .collection_envelope::<PublicData>()
        .expect("typed collection envelope");
    let pagination = envelope
        .meta
        .pagination
        .clone()
        .expect("pagination metadata");
    let page = envelope.into_page();

    assert_eq!(page.items.len(), 2);
    assert_eq!(page.cursor.next_cursor.as_deref(), Some("next_1"));
    assert!(page.cursor.has_more);
    assert_eq!(pagination.limit, Some(200));
    assert_eq!(pagination.sort.as_deref(), Some("-createdAt"));
    assert_eq!(pagination.search.as_deref(), Some("demo"));
    assert_eq!(pagination.filters["status"], "connected");
}

#[test]
fn public_resource_dtos_decode_without_json_shape_guessing() {
    let operation_response = SdkResponse::json(
        202,
        r#"{"data":{"resourceType":"message","resourceId":"inst_demo","operationStatus":"queued","accepted":true,"retryable":false,"async":true,"resultRef":"cmd_demo:result"},"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
    );
    let operation = operation_response
        .success_envelope::<PublicOperationData>()
        .expect("operation envelope");

    assert_eq!(operation.data.resource_type, "message");
    assert_eq!(operation.data.operation_status, "queued");
    assert!(operation.data.accepted);
    assert_eq!(operation.data.asynchronous, Some(true));

    let instances_response = SdkResponse::json(
        200,
        r#"{"data":[{"resourceType":"instance","id":"inst_demo","status":"connected","displayName":"Demo instance"}],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z","pagination":{"nextCursor":null,"previousCursor":null,"hasMore":false,"limit":50}}}"#,
    );
    let instances = instances_response
        .collection_envelope::<InstanceResource>()
        .expect("instance collection envelope");

    assert_eq!(instances.data[0].id, "inst_demo");
    assert_eq!(
        instances.data[0].display_name.as_deref(),
        Some("Demo instance")
    );

    let members_response = SdkResponse::json(
        200,
        r#"{"data":[{"resourceType":"groupMember","id":"member_demo","groupId":"group_demo","role":"admin","status":"active","displayName":"Admin"}],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z","pagination":{"nextCursor":null,"previousCursor":null,"hasMore":false,"limit":50}}}"#,
    );
    let members = members_response
        .collection_envelope::<GroupMemberResource>()
        .expect("group member collection envelope");

    assert_eq!(members.data[0].id, "member_demo");
    assert_eq!(members.data[0].role.as_deref(), Some("admin"));
}
