// Generated from docs/api/openapi/omniwa-v1.openapi.json.
// Do not edit by hand. Run `pnpm sdk:generate`.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Operation {
    pub operation_id: &'static str,
    pub method: &'static str,
    pub path: &'static str,
}

pub const ACTIVATE_SETTINGS: Operation = Operation {
    operation_id: "activateSettings",
    method: "POST",
    path: "/v1/settings/activate",
};

pub const ACTIVATE_WEBHOOK: Operation = Operation {
    operation_id: "activateWebhook",
    method: "POST",
    path: "/v1/webhooks/{webhookId}/activate",
};

pub const ADD_GROUP_MEMBER: Operation = Operation {
    operation_id: "addGroupMember",
    method: "POST",
    path: "/v1/groups/{groupId}/members",
};

pub const CANCEL_MESSAGE: Operation = Operation {
    operation_id: "cancelMessage",
    method: "POST",
    path: "/v1/messages/{messageId}/cancel",
};

pub const CONNECT_INSTANCE: Operation = Operation {
    operation_id: "connectInstance",
    method: "POST",
    path: "/v1/instances/{instanceId}/connect",
};

pub const CREATE_INSTANCE: Operation = Operation {
    operation_id: "createInstance",
    method: "POST",
    path: "/v1/instances",
};

pub const DEMOTE_GROUP_MEMBER: Operation = Operation {
    operation_id: "demoteGroupMember",
    method: "POST",
    path: "/v1/groups/{groupId}/members/{memberJid}/demote",
};

pub const DESTROY_INSTANCE: Operation = Operation {
    operation_id: "destroyInstance",
    method: "DELETE",
    path: "/v1/instances/{instanceId}",
};

pub const DISCONNECT_INSTANCE: Operation = Operation {
    operation_id: "disconnectInstance",
    method: "POST",
    path: "/v1/instances/{instanceId}/disconnect",
};

pub const GET_CHAT: Operation = Operation {
    operation_id: "getChat",
    method: "GET",
    path: "/v1/chats/{chatId}",
};

pub const GET_CONTACT: Operation = Operation {
    operation_id: "getContact",
    method: "GET",
    path: "/v1/contacts/{contactId}",
};

pub const GET_DASHBOARD_SUMMARY: Operation = Operation {
    operation_id: "getDashboardSummary",
    method: "GET",
    path: "/v1/dashboard",
};

pub const GET_GROUP: Operation = Operation {
    operation_id: "getGroup",
    method: "GET",
    path: "/v1/groups/{groupId}",
};

pub const GET_HEALTH: Operation = Operation {
    operation_id: "getHealth",
    method: "GET",
    path: "/v1/health",
};

pub const GET_HEALTH_READINESS: Operation = Operation {
    operation_id: "getHealthReadiness",
    method: "GET",
    path: "/v1/health/readiness",
};

pub const GET_INSTANCE: Operation = Operation {
    operation_id: "getInstance",
    method: "GET",
    path: "/v1/instances/{instanceId}",
};

pub const GET_JOB: Operation = Operation {
    operation_id: "getJob",
    method: "GET",
    path: "/v1/jobs/{jobId}",
};

pub const GET_LABEL: Operation = Operation {
    operation_id: "getLabel",
    method: "GET",
    path: "/v1/labels/{labelId}",
};

pub const GET_MEDIA: Operation = Operation {
    operation_id: "getMedia",
    method: "GET",
    path: "/v1/media/{mediaId}",
};

pub const GET_MEDIA_METRICS: Operation = Operation {
    operation_id: "getMediaMetrics",
    method: "GET",
    path: "/v1/metrics/media",
};

pub const GET_MESSAGE: Operation = Operation {
    operation_id: "getMessage",
    method: "GET",
    path: "/v1/messages/{messageId}",
};

pub const GET_MESSAGE_DELIVERY_HISTORY: Operation = Operation {
    operation_id: "getMessageDeliveryHistory",
    method: "GET",
    path: "/v1/messages/{messageId}/delivery-history",
};

pub const GET_MESSAGE_METRICS: Operation = Operation {
    operation_id: "getMessageMetrics",
    method: "GET",
    path: "/v1/metrics/messages",
};

pub const GET_METRICS: Operation = Operation {
    operation_id: "getMetrics",
    method: "GET",
    path: "/v1/metrics",
};

pub const GET_PROVIDER_CAPABILITIES: Operation = Operation {
    operation_id: "getProviderCapabilities",
    method: "GET",
    path: "/v1/provider/capabilities",
};

pub const GET_QUEUE_METRICS: Operation = Operation {
    operation_id: "getQueueMetrics",
    method: "GET",
    path: "/v1/metrics/queue",
};

pub const GET_QUEUE_STATUS: Operation = Operation {
    operation_id: "getQueueStatus",
    method: "GET",
    path: "/v1/queue",
};

pub const GET_SETTINGS: Operation = Operation {
    operation_id: "getSettings",
    method: "GET",
    path: "/v1/settings",
};

pub const GET_WEBHOOK: Operation = Operation {
    operation_id: "getWebhook",
    method: "GET",
    path: "/v1/webhooks/{webhookId}",
};

pub const GET_WEBHOOK_DELIVERY_HISTORY: Operation = Operation {
    operation_id: "getWebhookDeliveryHistory",
    method: "GET",
    path: "/v1/webhook-deliveries/{deliveryId}/history",
};

pub const GET_WEBHOOK_METRICS: Operation = Operation {
    operation_id: "getWebhookMetrics",
    method: "GET",
    path: "/v1/metrics/webhooks",
};

pub const LIST_ACTION_REQUIRED_ITEMS: Operation = Operation {
    operation_id: "listActionRequiredItems",
    method: "GET",
    path: "/v1/action-required",
};

pub const LIST_AUDIT_RECORDS: Operation = Operation {
    operation_id: "listAuditRecords",
    method: "GET",
    path: "/v1/audit-records",
};

pub const LIST_CHATS: Operation = Operation {
    operation_id: "listChats",
    method: "GET",
    path: "/v1/chats",
};

pub const LIST_CONTACTS: Operation = Operation {
    operation_id: "listContacts",
    method: "GET",
    path: "/v1/contacts",
};

pub const LIST_EVENTS: Operation = Operation {
    operation_id: "listEvents",
    method: "GET",
    path: "/v1/events",
};

pub const LIST_GROUP_MEMBERS: Operation = Operation {
    operation_id: "listGroupMembers",
    method: "GET",
    path: "/v1/groups/{groupId}/members",
};

pub const LIST_INSTANCE_CHATS: Operation = Operation {
    operation_id: "listInstanceChats",
    method: "GET",
    path: "/v1/instances/{instanceId}/chats",
};

pub const LIST_INSTANCE_CONTACTS: Operation = Operation {
    operation_id: "listInstanceContacts",
    method: "GET",
    path: "/v1/instances/{instanceId}/contacts",
};

pub const LIST_INSTANCE_GROUPS: Operation = Operation {
    operation_id: "listInstanceGroups",
    method: "GET",
    path: "/v1/instances/{instanceId}/groups",
};

pub const LIST_INSTANCE_LABELS: Operation = Operation {
    operation_id: "listInstanceLabels",
    method: "GET",
    path: "/v1/instances/{instanceId}/labels",
};

pub const LIST_INSTANCE_MESSAGES: Operation = Operation {
    operation_id: "listInstanceMessages",
    method: "GET",
    path: "/v1/instances/{instanceId}/messages",
};

pub const LIST_INSTANCES: Operation = Operation {
    operation_id: "listInstances",
    method: "GET",
    path: "/v1/instances",
};

pub const LIST_INSTANCE_SESSIONS: Operation = Operation {
    operation_id: "listInstanceSessions",
    method: "GET",
    path: "/v1/instances/{instanceId}/sessions",
};

pub const LIST_JOBS: Operation = Operation {
    operation_id: "listJobs",
    method: "GET",
    path: "/v1/jobs",
};

pub const LIST_LABELS: Operation = Operation {
    operation_id: "listLabels",
    method: "GET",
    path: "/v1/labels",
};

pub const LIST_WEBHOOK_DELIVERIES: Operation = Operation {
    operation_id: "listWebhookDeliveries",
    method: "GET",
    path: "/v1/webhook-deliveries",
};

pub const LIST_WEBHOOKS: Operation = Operation {
    operation_id: "listWebhooks",
    method: "GET",
    path: "/v1/webhooks",
};

pub const PROMOTE_GROUP_MEMBER: Operation = Operation {
    operation_id: "promoteGroupMember",
    method: "POST",
    path: "/v1/groups/{groupId}/members/{memberJid}/promote",
};

pub const REFRESH_GROUP_INVITE_LINK: Operation = Operation {
    operation_id: "refreshGroupInviteLink",
    method: "POST",
    path: "/v1/groups/{groupId}/invite-link/refresh",
};

pub const REFRESH_INSTANCE_GROUPS: Operation = Operation {
    operation_id: "refreshInstanceGroups",
    method: "POST",
    path: "/v1/instances/{instanceId}/groups/refresh",
};

pub const REFRESH_INSTANCE_QR: Operation = Operation {
    operation_id: "refreshInstanceQr",
    method: "POST",
    path: "/v1/instances/{instanceId}/qr/refresh",
};

pub const REFRESH_PROVIDER_CAPABILITIES: Operation = Operation {
    operation_id: "refreshProviderCapabilities",
    method: "POST",
    path: "/v1/provider/capabilities/refresh",
};

pub const REGISTER_MEDIA: Operation = Operation {
    operation_id: "registerMedia",
    method: "POST",
    path: "/v1/media",
};

pub const REGISTER_WEBHOOK: Operation = Operation {
    operation_id: "registerWebhook",
    method: "POST",
    path: "/v1/webhooks",
};

pub const REMOVE_GROUP_MEMBER: Operation = Operation {
    operation_id: "removeGroupMember",
    method: "DELETE",
    path: "/v1/groups/{groupId}/members/{memberJid}",
};

pub const REQUEST_INSTANCE_RECONNECT: Operation = Operation {
    operation_id: "requestInstanceReconnect",
    method: "POST",
    path: "/v1/instances/{instanceId}/reconnect",
};

pub const RETIRE_WEBHOOK: Operation = Operation {
    operation_id: "retireWebhook",
    method: "DELETE",
    path: "/v1/webhooks/{webhookId}",
};

pub const RETRY_MESSAGE: Operation = Operation {
    operation_id: "retryMessage",
    method: "POST",
    path: "/v1/messages/{messageId}/retry",
};

pub const RETRY_WEBHOOK_DELIVERY: Operation = Operation {
    operation_id: "retryWebhookDelivery",
    method: "POST",
    path: "/v1/webhook-deliveries/{deliveryId}/retry",
};

pub const SEND_GROUP_TEXT_MESSAGE: Operation = Operation {
    operation_id: "sendGroupTextMessage",
    method: "POST",
    path: "/v1/groups/{groupId}/messages/text",
};

pub const SEND_INSTANCE_MEDIA_MESSAGE: Operation = Operation {
    operation_id: "sendInstanceMediaMessage",
    method: "POST",
    path: "/v1/instances/{instanceId}/messages/media",
};

pub const SEND_INSTANCE_MESSAGE: Operation = Operation {
    operation_id: "sendInstanceMessage",
    method: "POST",
    path: "/v1/instances/{instanceId}/messages",
};

pub const SEND_INSTANCE_TEXT_MESSAGE: Operation = Operation {
    operation_id: "sendInstanceTextMessage",
    method: "POST",
    path: "/v1/instances/{instanceId}/messages/text",
};

pub const STREAM_EVENTS: Operation = Operation {
    operation_id: "streamEvents",
    method: "GET",
    path: "/v1/events/stream",
};

pub const SUSPEND_WEBHOOK: Operation = Operation {
    operation_id: "suspendWebhook",
    method: "POST",
    path: "/v1/webhooks/{webhookId}/suspend",
};

pub const UPDATE_GROUP: Operation = Operation {
    operation_id: "updateGroup",
    method: "PATCH",
    path: "/v1/groups/{groupId}",
};

pub const UPDATE_GROUP_LOCAL_STATE: Operation = Operation {
    operation_id: "updateGroupLocalState",
    method: "PATCH",
    path: "/v1/groups/{groupId}/local-state",
};

pub const UPDATE_INSTANCE: Operation = Operation {
    operation_id: "updateInstance",
    method: "PATCH",
    path: "/v1/instances/{instanceId}",
};

pub const UPDATE_WEBHOOK: Operation = Operation {
    operation_id: "updateWebhook",
    method: "PATCH",
    path: "/v1/webhooks/{webhookId}",
};

pub const VALIDATE_SETTINGS: Operation = Operation {
    operation_id: "validateSettings",
    method: "POST",
    path: "/v1/settings/validate",
};

pub const ALL_OPERATIONS: &[Operation] = &[
    ACTIVATE_SETTINGS,
    ACTIVATE_WEBHOOK,
    ADD_GROUP_MEMBER,
    CANCEL_MESSAGE,
    CONNECT_INSTANCE,
    CREATE_INSTANCE,
    DEMOTE_GROUP_MEMBER,
    DESTROY_INSTANCE,
    DISCONNECT_INSTANCE,
    GET_CHAT,
    GET_CONTACT,
    GET_DASHBOARD_SUMMARY,
    GET_GROUP,
    GET_HEALTH,
    GET_HEALTH_READINESS,
    GET_INSTANCE,
    GET_JOB,
    GET_LABEL,
    GET_MEDIA,
    GET_MEDIA_METRICS,
    GET_MESSAGE,
    GET_MESSAGE_DELIVERY_HISTORY,
    GET_MESSAGE_METRICS,
    GET_METRICS,
    GET_PROVIDER_CAPABILITIES,
    GET_QUEUE_METRICS,
    GET_QUEUE_STATUS,
    GET_SETTINGS,
    GET_WEBHOOK,
    GET_WEBHOOK_DELIVERY_HISTORY,
    GET_WEBHOOK_METRICS,
    LIST_ACTION_REQUIRED_ITEMS,
    LIST_AUDIT_RECORDS,
    LIST_CHATS,
    LIST_CONTACTS,
    LIST_EVENTS,
    LIST_GROUP_MEMBERS,
    LIST_INSTANCE_CHATS,
    LIST_INSTANCE_CONTACTS,
    LIST_INSTANCE_GROUPS,
    LIST_INSTANCE_LABELS,
    LIST_INSTANCE_MESSAGES,
    LIST_INSTANCES,
    LIST_INSTANCE_SESSIONS,
    LIST_JOBS,
    LIST_LABELS,
    LIST_WEBHOOK_DELIVERIES,
    LIST_WEBHOOKS,
    PROMOTE_GROUP_MEMBER,
    REFRESH_GROUP_INVITE_LINK,
    REFRESH_INSTANCE_GROUPS,
    REFRESH_INSTANCE_QR,
    REFRESH_PROVIDER_CAPABILITIES,
    REGISTER_MEDIA,
    REGISTER_WEBHOOK,
    REMOVE_GROUP_MEMBER,
    REQUEST_INSTANCE_RECONNECT,
    RETIRE_WEBHOOK,
    RETRY_MESSAGE,
    RETRY_WEBHOOK_DELIVERY,
    SEND_GROUP_TEXT_MESSAGE,
    SEND_INSTANCE_MEDIA_MESSAGE,
    SEND_INSTANCE_MESSAGE,
    SEND_INSTANCE_TEXT_MESSAGE,
    STREAM_EVENTS,
    SUSPEND_WEBHOOK,
    UPDATE_GROUP,
    UPDATE_GROUP_LOCAL_STATE,
    UPDATE_INSTANCE,
    UPDATE_WEBHOOK,
    VALIDATE_SETTINGS,
];

pub fn operation_by_id(operation_id: &str) -> Option<Operation> {
    match operation_id {
        "activateSettings" => Some(ACTIVATE_SETTINGS),
        "activateWebhook" => Some(ACTIVATE_WEBHOOK),
        "addGroupMember" => Some(ADD_GROUP_MEMBER),
        "cancelMessage" => Some(CANCEL_MESSAGE),
        "connectInstance" => Some(CONNECT_INSTANCE),
        "createInstance" => Some(CREATE_INSTANCE),
        "demoteGroupMember" => Some(DEMOTE_GROUP_MEMBER),
        "destroyInstance" => Some(DESTROY_INSTANCE),
        "disconnectInstance" => Some(DISCONNECT_INSTANCE),
        "getChat" => Some(GET_CHAT),
        "getContact" => Some(GET_CONTACT),
        "getDashboardSummary" => Some(GET_DASHBOARD_SUMMARY),
        "getGroup" => Some(GET_GROUP),
        "getHealth" => Some(GET_HEALTH),
        "getHealthReadiness" => Some(GET_HEALTH_READINESS),
        "getInstance" => Some(GET_INSTANCE),
        "getJob" => Some(GET_JOB),
        "getLabel" => Some(GET_LABEL),
        "getMedia" => Some(GET_MEDIA),
        "getMediaMetrics" => Some(GET_MEDIA_METRICS),
        "getMessage" => Some(GET_MESSAGE),
        "getMessageDeliveryHistory" => Some(GET_MESSAGE_DELIVERY_HISTORY),
        "getMessageMetrics" => Some(GET_MESSAGE_METRICS),
        "getMetrics" => Some(GET_METRICS),
        "getProviderCapabilities" => Some(GET_PROVIDER_CAPABILITIES),
        "getQueueMetrics" => Some(GET_QUEUE_METRICS),
        "getQueueStatus" => Some(GET_QUEUE_STATUS),
        "getSettings" => Some(GET_SETTINGS),
        "getWebhook" => Some(GET_WEBHOOK),
        "getWebhookDeliveryHistory" => Some(GET_WEBHOOK_DELIVERY_HISTORY),
        "getWebhookMetrics" => Some(GET_WEBHOOK_METRICS),
        "listActionRequiredItems" => Some(LIST_ACTION_REQUIRED_ITEMS),
        "listAuditRecords" => Some(LIST_AUDIT_RECORDS),
        "listChats" => Some(LIST_CHATS),
        "listContacts" => Some(LIST_CONTACTS),
        "listEvents" => Some(LIST_EVENTS),
        "listGroupMembers" => Some(LIST_GROUP_MEMBERS),
        "listInstanceChats" => Some(LIST_INSTANCE_CHATS),
        "listInstanceContacts" => Some(LIST_INSTANCE_CONTACTS),
        "listInstanceGroups" => Some(LIST_INSTANCE_GROUPS),
        "listInstanceLabels" => Some(LIST_INSTANCE_LABELS),
        "listInstanceMessages" => Some(LIST_INSTANCE_MESSAGES),
        "listInstances" => Some(LIST_INSTANCES),
        "listInstanceSessions" => Some(LIST_INSTANCE_SESSIONS),
        "listJobs" => Some(LIST_JOBS),
        "listLabels" => Some(LIST_LABELS),
        "listWebhookDeliveries" => Some(LIST_WEBHOOK_DELIVERIES),
        "listWebhooks" => Some(LIST_WEBHOOKS),
        "promoteGroupMember" => Some(PROMOTE_GROUP_MEMBER),
        "refreshGroupInviteLink" => Some(REFRESH_GROUP_INVITE_LINK),
        "refreshInstanceGroups" => Some(REFRESH_INSTANCE_GROUPS),
        "refreshInstanceQr" => Some(REFRESH_INSTANCE_QR),
        "refreshProviderCapabilities" => Some(REFRESH_PROVIDER_CAPABILITIES),
        "registerMedia" => Some(REGISTER_MEDIA),
        "registerWebhook" => Some(REGISTER_WEBHOOK),
        "removeGroupMember" => Some(REMOVE_GROUP_MEMBER),
        "requestInstanceReconnect" => Some(REQUEST_INSTANCE_RECONNECT),
        "retireWebhook" => Some(RETIRE_WEBHOOK),
        "retryMessage" => Some(RETRY_MESSAGE),
        "retryWebhookDelivery" => Some(RETRY_WEBHOOK_DELIVERY),
        "sendGroupTextMessage" => Some(SEND_GROUP_TEXT_MESSAGE),
        "sendInstanceMediaMessage" => Some(SEND_INSTANCE_MEDIA_MESSAGE),
        "sendInstanceMessage" => Some(SEND_INSTANCE_MESSAGE),
        "sendInstanceTextMessage" => Some(SEND_INSTANCE_TEXT_MESSAGE),
        "streamEvents" => Some(STREAM_EVENTS),
        "suspendWebhook" => Some(SUSPEND_WEBHOOK),
        "updateGroup" => Some(UPDATE_GROUP),
        "updateGroupLocalState" => Some(UPDATE_GROUP_LOCAL_STATE),
        "updateInstance" => Some(UPDATE_INSTANCE),
        "updateWebhook" => Some(UPDATE_WEBHOOK),
        "validateSettings" => Some(VALIDATE_SETTINGS),
        _ => None,
    }
}
