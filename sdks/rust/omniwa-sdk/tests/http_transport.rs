use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

use omniwa_sdk::{
    ApiKey, BlockingHttpTransport, OmniwaClient, OmniwaClientConfig, PublicData, SdkError,
};

fn spawn_http_server(status: u16, body: &'static str) -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let address = listener.local_addr().expect("local address");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept test request");
        let mut buffer = [0_u8; 4096];
        let bytes_read = stream.read(&mut buffer).expect("read request");
        let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
        let reason = if status >= 400 { "Error" } else { "OK" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len(),
        );

        stream
            .write_all(response.as_bytes())
            .expect("write response");

        request
    });

    (format!("http://{address}"), handle)
}

fn http_client(base_url: String) -> OmniwaClient<BlockingHttpTransport> {
    let api_key = ApiKey::new("test-api-key").expect("valid API key");
    let config = OmniwaClientConfig::new(base_url, api_key).expect("valid config");

    OmniwaClient::new(config, BlockingHttpTransport::new())
}

#[test]
fn blocking_http_transport_sends_real_http_request_and_decodes_success() {
    let (base_url, handle) = spawn_http_server(
        200,
        r#"{"data":{"status":"ok"},"meta":{"requestId":"req_http","correlationId":"corr_http","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
    );
    let client = http_client(base_url);
    let response = client.health().get().expect("HTTP response");
    let envelope = response
        .success_envelope::<PublicData>()
        .expect("success envelope");
    let request = handle.join().expect("request capture");

    assert_eq!(response.status_code, 200);
    assert_eq!(envelope.meta.request_id, "req_http");
    assert_eq!(envelope.data["status"], "ok");
    assert!(request.starts_with("GET /v1/health HTTP/1.1"));
    assert!(request.contains("x-api-key: test-api-key"));
}

#[test]
fn blocking_http_transport_preserves_api_error_envelope() {
    let (base_url, handle) = spawn_http_server(
        401,
        r#"{"error":{"code":"missing_or_invalid_api_key","message":"API request requires a valid x-api-key header.","details":{"category":"authentication","retryable":false}},"meta":{"requestId":"req_http_error","correlationId":"corr_http_error","timestamp":"2026-06-30T00:00:00.000Z"}}"#,
    );
    let client = http_client(base_url);
    let error = client.instances().list().expect_err("API error");
    let request = handle.join().expect("request capture");

    match error {
        SdkError::Api(failure) => {
            assert_eq!(failure.status_code, 401);
            assert_eq!(failure.code.as_deref(), Some("missing_or_invalid_api_key"));
            assert_eq!(failure.category.as_deref(), Some("authentication"));
            assert_eq!(failure.request_id.as_deref(), Some("req_http_error"));
            assert_eq!(failure.correlation_id.as_deref(), Some("corr_http_error"));
        }
        unexpected => panic!("unexpected error: {unexpected:?}"),
    }

    assert!(request.starts_with("GET /v1/instances HTTP/1.1"));
}
