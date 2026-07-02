use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::pagination::{CursorPage, Page};

pub type PublicData = Value;
pub type PublicObject = BTreeMap<String, Value>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PublicOperationData {
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    #[serde(default, rename = "resourceId")]
    pub resource_id: Option<String>,
    #[serde(rename = "operationStatus")]
    pub operation_status: String,
    pub accepted: bool,
    pub retryable: bool,
    #[serde(default, rename = "async")]
    pub asynchronous: Option<bool>,
    #[serde(default, rename = "resultRef")]
    pub result_ref: Option<String>,
    #[serde(default, rename = "reasonCode")]
    pub reason_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PublicResourceReadData {
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default, rename = "resourceId")]
    pub resource_id: Option<String>,
    #[serde(rename = "readStatus")]
    pub read_status: String,
    #[serde(default)]
    pub consistency: Option<String>,
    #[serde(default)]
    pub freshness: Option<Value>,
    #[serde(default, rename = "resultRef")]
    pub result_ref: Option<String>,
    #[serde(default, rename = "reasonCode")]
    pub reason_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InstanceResource {
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupMemberResource {
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    pub id: String,
    #[serde(default, rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(default, rename = "memberRef")]
    pub member_ref: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, rename = "joinedAt")]
    pub joined_at: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResponseMeta {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
    pub timestamp: String,
    #[serde(flatten)]
    pub extra: PublicObject,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PaginationMeta {
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
    #[serde(rename = "previousCursor")]
    pub previous_cursor: Option<String>,
    #[serde(rename = "hasMore", default)]
    pub has_more: bool,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub filters: PublicObject,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CollectionMeta {
    #[serde(flatten)]
    pub response: ResponseMeta,
    #[serde(default)]
    pub pagination: Option<PaginationMeta>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SuccessEnvelope<T = PublicData> {
    pub data: T,
    pub meta: ResponseMeta,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CollectionEnvelope<T = PublicData> {
    pub data: Vec<T>,
    pub meta: CollectionMeta,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    pub error: ApiErrorBody,
    pub meta: ResponseMeta,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: ApiErrorDetails,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ApiErrorDetails {
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub retryable: Option<bool>,
    #[serde(flatten)]
    pub extra: PublicObject,
}

impl<T> CollectionEnvelope<T> {
    pub fn into_page(self) -> Page<T> {
        Page::new(self.data, CursorPage::from(self.meta.pagination))
    }
}

impl From<Option<PaginationMeta>> for CursorPage {
    fn from(value: Option<PaginationMeta>) -> Self {
        match value {
            Some(pagination) => CursorPage {
                next_cursor: pagination.next_cursor,
                previous_cursor: pagination.previous_cursor,
                has_more: pagination.has_more,
            },
            None => CursorPage::default(),
        }
    }
}
