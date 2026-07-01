//! Official Rust SDK foundation for the OmniWA public REST API.
//!
//! The SDK is a client boundary. It does not contain OmniWA business logic and
//! must not depend on backend Application, Domain, Provider, or Persistence code.

pub mod auth;
pub mod client;
pub mod error;
pub mod generated;
pub mod idempotency;
pub mod models;
pub mod pagination;
pub mod platform_clients;
pub mod resources;
pub mod streaming;
pub mod transport;

pub use auth::ApiKey;
pub use client::{OmniwaClient, OmniwaClientConfig, RequestBody, RequestOptions};
pub use error::{ApiFailure, SdkError};
pub use idempotency::IdempotencyKey;
pub use models::{
    ApiErrorBody, ApiErrorDetails, CollectionEnvelope, CollectionMeta, ErrorEnvelope,
    GroupMemberResource, InstanceResource, PaginationMeta, PublicData, PublicObject,
    PublicOperationData, PublicResourceReadData, ResponseMeta, SuccessEnvelope,
};
pub use pagination::{CursorPage, Page};
pub use platform_clients::{
    platform_client_profile, validate_platform_client_profile, PlatformClientKind,
    PlatformClientProfile, PlatformClientProfileFinding, PlatformClientSurface,
    PlatformClientSurfaceKind, PLATFORM_CLIENT_PROFILES,
};
pub use streaming::{parse_sse_events, SseEvent};
pub use transport::{
    BlockingHttpTransport, BlockingHttpTransportConfig, FixtureTransport, SdkRequest, SdkResponse,
    Transport,
};
