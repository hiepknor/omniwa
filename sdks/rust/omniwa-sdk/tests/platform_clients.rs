use omniwa_sdk::{
    parse_sse_events, platform_client_profile, validate_platform_client_profile, ApiKey,
    FixtureTransport, OmniwaClient, OmniwaClientConfig, PlatformClientKind, SdkResponse,
    PLATFORM_CLIENT_PROFILES,
};

fn fixture_response() -> SdkResponse {
    SdkResponse::json(
        200,
        r#"{"data":[],"meta":{"requestId":"req_demo","correlationId":"corr_demo","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
    )
}

fn client_with_phase_j_fixtures() -> OmniwaClient<FixtureTransport> {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new("http://localhost:3000", api_key).expect("valid config");
    let transport = FixtureTransport::new()
        .with_response("getDashboardSummary", fixture_response())
        .with_response("listInstances", fixture_response())
        .with_response("listInstanceChats", fixture_response())
        .with_response("listInstanceContacts", fixture_response())
        .with_response("listInstanceGroups", fixture_response())
        .with_response("listJobs", fixture_response())
        .with_response(
            "streamEvents",
            SdkResponse {
                status_code: 200,
                headers: vec![("content-type".to_owned(), "text/event-stream".to_owned())],
                body:
                    "id: cursor_1\nevent: dashboard.updated.v1\ndata: {\"cursor\":\"cursor_1\"}\n\n"
                        .to_owned(),
            },
        );

    OmniwaClient::new(config, transport)
}

#[test]
fn platform_client_profiles_reference_only_generated_sdk_operations() {
    assert_eq!(PLATFORM_CLIENT_PROFILES.len(), 4);

    for profile in PLATFORM_CLIENT_PROFILES {
        assert!(
            !profile.surfaces.is_empty(),
            "{} must declare client surfaces",
            profile.id,
        );
        assert_eq!(validate_platform_client_profile(*profile), []);

        for surface in profile.surfaces {
            assert!(
                !surface.operation_ids.is_empty(),
                "{}:{} must declare SDK operations",
                profile.id,
                surface.id,
            );
            for operation_id in surface.operation_ids {
                assert!(
                    operation_id
                        .chars()
                        .next()
                        .is_some_and(|character| character.is_ascii_lowercase()),
                    "{operation_id} must be public operationId style, not Application command/query style",
                );
            }
        }
    }
}

#[test]
fn phase_j_profiles_cover_tui_cli_web_and_mcp_clients() {
    assert_eq!(
        platform_client_profile(PlatformClientKind::Tui).id,
        "omniwa-tui"
    );
    assert_eq!(
        platform_client_profile(PlatformClientKind::Cli).id,
        "omniwa-cli"
    );
    assert_eq!(
        platform_client_profile(PlatformClientKind::WebDashboard).id,
        "omniwa-web-dashboard",
    );
    assert_eq!(
        platform_client_profile(PlatformClientKind::McpServer).id,
        "omniwa-mcp-server",
    );
}

#[test]
fn tui_foundation_can_drive_core_screens_through_sdk_resources() {
    let client = client_with_phase_j_fixtures();

    assert_eq!(client.dashboard().get().unwrap().status_code, 200);
    assert_eq!(client.instances().list().unwrap().status_code, 200);
    assert_eq!(
        client
            .chats()
            .list_for_instance("instance_demo")
            .unwrap()
            .status_code,
        200,
    );
    assert_eq!(
        client
            .contacts()
            .list_for_instance("instance_demo")
            .unwrap()
            .status_code,
        200,
    );
    assert_eq!(
        client
            .groups()
            .list_for_instance("instance_demo")
            .unwrap()
            .status_code,
        200,
    );
    assert_eq!(client.jobs().list().unwrap().status_code, 200);

    let events = client.events().stream().unwrap();
    assert_eq!(parse_sse_events(&events.body).unwrap().len(), 1);
}
