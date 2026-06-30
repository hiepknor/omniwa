//! Official Rust SDK foundation for the OmniWA public REST API.
//!
//! The SDK is a client boundary. It does not contain OmniWA business logic and
//! must not depend on backend Application, Domain, Provider, or Persistence code.

pub mod auth;
pub mod client;
pub mod error;
pub mod generated;
pub mod idempotency;
pub mod pagination;
pub mod resources;
pub mod transport;

pub use auth::ApiKey;
pub use client::{OmniwaClient, OmniwaClientConfig, RequestBody, RequestOptions};
pub use error::{ApiFailure, SdkError};
pub use idempotency::IdempotencyKey;
pub use pagination::{CursorPage, Page};
pub use transport::{FixtureTransport, SdkRequest, SdkResponse, Transport};
