use crate::generated::operations::operation_by_id;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformClientKind {
    Tui,
    Cli,
    WebDashboard,
    McpServer,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformClientSurfaceKind {
    Screen,
    CommandGroup,
    DashboardPanel,
    ToolGroup,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlatformClientSurface {
    pub id: &'static str,
    pub title: &'static str,
    pub kind: PlatformClientSurfaceKind,
    pub operation_ids: &'static [&'static str],
    pub realtime: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlatformClientProfile {
    pub kind: PlatformClientKind,
    pub id: &'static str,
    pub title: &'static str,
    pub surfaces: &'static [PlatformClientSurface],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformClientProfileFinding {
    pub client_id: &'static str,
    pub surface_id: &'static str,
    pub operation_id: &'static str,
    pub reason: &'static str,
}

const TUI_DASHBOARD_OPERATIONS: &[&str] = &[
    "getDashboardSummary",
    "getMetrics",
    "getQueueMetrics",
    "getMessageMetrics",
    "getWebhookMetrics",
    "getMediaMetrics",
    "streamEvents",
];
const TUI_INSTANCE_OPERATIONS: &[&str] = &[
    "listInstances",
    "getInstance",
    "listInstanceSessions",
    "connectInstance",
    "disconnectInstance",
    "refreshInstanceQr",
];
const TUI_NAVIGATION_OPERATIONS: &[&str] = &[
    "listInstanceChats",
    "getChat",
    "listInstanceContacts",
    "getContact",
    "listInstanceLabels",
    "getLabel",
    "streamEvents",
];
const TUI_GROUP_OPERATIONS: &[&str] = &[
    "listInstanceGroups",
    "getGroup",
    "listGroupMembers",
    "sendGroupTextMessage",
    "streamEvents",
];
const TUI_MESSAGE_OPERATIONS: &[&str] = &[
    "listInstanceMessages",
    "getMessage",
    "getMessageDeliveryHistory",
    "sendInstanceTextMessage",
    "sendInstanceMediaMessage",
];
const TUI_QUEUE_OPERATIONS: &[&str] = &["getQueueStatus", "listJobs", "getJob", "streamEvents"];
const TUI_WEBHOOK_OPERATIONS: &[&str] = &[
    "listWebhooks",
    "getWebhook",
    "listWebhookDeliveries",
    "getWebhookDeliveryHistory",
    "registerWebhook",
];
const TUI_SETTINGS_OPERATIONS: &[&str] = &["getSettings"];

const CLI_STATUS_OPERATIONS: &[&str] = &[
    "getHealth",
    "getHealthReadiness",
    "listInstances",
    "getInstance",
];
const CLI_INSTANCE_OPERATIONS: &[&str] =
    &["connectInstance", "disconnectInstance", "refreshInstanceQr"];
const CLI_MESSAGE_OPERATIONS: &[&str] = &[
    "sendInstanceTextMessage",
    "sendInstanceMediaMessage",
    "getMessage",
];
const CLI_OPERATIONS_OPERATIONS: &[&str] = &["listJobs", "getJob", "listEvents", "streamEvents"];

const WEB_DASHBOARD_OPERATIONS: &[&str] = &[
    "getDashboardSummary",
    "getMetrics",
    "getQueueMetrics",
    "getMessageMetrics",
    "getWebhookMetrics",
    "getMediaMetrics",
    "listActionRequiredItems",
    "streamEvents",
];
const WEB_INSTANCE_OPERATIONS: &[&str] = &[
    "listInstances",
    "getInstance",
    "listInstanceChats",
    "listInstanceContacts",
    "listInstanceGroups",
];
const WEB_OPERATIONS_OPERATIONS: &[&str] =
    &["listJobs", "getJob", "listWebhookDeliveries", "listEvents"];

const MCP_DISCOVERY_OPERATIONS: &[&str] = &[
    "getHealth",
    "listInstances",
    "getInstance",
    "listChats",
    "listContacts",
    "listLabels",
    "listWebhooks",
];
const MCP_ACTION_OPERATIONS: &[&str] = &[
    "sendInstanceTextMessage",
    "sendInstanceMediaMessage",
    "registerWebhook",
];
const MCP_STREAM_OPERATIONS: &[&str] = &["listEvents", "streamEvents"];

pub const TUI_SURFACES: &[PlatformClientSurface] = &[
    surface(
        "dashboard",
        "Dashboard",
        PlatformClientSurfaceKind::Screen,
        TUI_DASHBOARD_OPERATIONS,
        true,
    ),
    surface(
        "instances",
        "Instances",
        PlatformClientSurfaceKind::Screen,
        TUI_INSTANCE_OPERATIONS,
        false,
    ),
    surface(
        "navigation",
        "Chats, Contacts, Labels",
        PlatformClientSurfaceKind::Screen,
        TUI_NAVIGATION_OPERATIONS,
        true,
    ),
    surface(
        "groups",
        "Groups",
        PlatformClientSurfaceKind::Screen,
        TUI_GROUP_OPERATIONS,
        true,
    ),
    surface(
        "messages",
        "Messages",
        PlatformClientSurfaceKind::Screen,
        TUI_MESSAGE_OPERATIONS,
        false,
    ),
    surface(
        "queue",
        "Queue And Jobs",
        PlatformClientSurfaceKind::Screen,
        TUI_QUEUE_OPERATIONS,
        true,
    ),
    surface(
        "webhooks",
        "Webhooks",
        PlatformClientSurfaceKind::Screen,
        TUI_WEBHOOK_OPERATIONS,
        false,
    ),
    surface(
        "settings",
        "Settings",
        PlatformClientSurfaceKind::Screen,
        TUI_SETTINGS_OPERATIONS,
        false,
    ),
];

pub const CLI_SURFACES: &[PlatformClientSurface] = &[
    surface(
        "status",
        "Status Commands",
        PlatformClientSurfaceKind::CommandGroup,
        CLI_STATUS_OPERATIONS,
        false,
    ),
    surface(
        "instances",
        "Instance Commands",
        PlatformClientSurfaceKind::CommandGroup,
        CLI_INSTANCE_OPERATIONS,
        false,
    ),
    surface(
        "messages",
        "Message Commands",
        PlatformClientSurfaceKind::CommandGroup,
        CLI_MESSAGE_OPERATIONS,
        false,
    ),
    surface(
        "operations",
        "Operational Commands",
        PlatformClientSurfaceKind::CommandGroup,
        CLI_OPERATIONS_OPERATIONS,
        true,
    ),
];

pub const WEB_DASHBOARD_SURFACES: &[PlatformClientSurface] = &[
    surface(
        "overview",
        "Overview",
        PlatformClientSurfaceKind::DashboardPanel,
        WEB_DASHBOARD_OPERATIONS,
        true,
    ),
    surface(
        "instances",
        "Instance Browser",
        PlatformClientSurfaceKind::DashboardPanel,
        WEB_INSTANCE_OPERATIONS,
        true,
    ),
    surface(
        "operations",
        "Operations",
        PlatformClientSurfaceKind::DashboardPanel,
        WEB_OPERATIONS_OPERATIONS,
        true,
    ),
];

pub const MCP_SERVER_SURFACES: &[PlatformClientSurface] = &[
    surface(
        "discovery",
        "Discovery Tools",
        PlatformClientSurfaceKind::ToolGroup,
        MCP_DISCOVERY_OPERATIONS,
        false,
    ),
    surface(
        "actions",
        "Action Tools",
        PlatformClientSurfaceKind::ToolGroup,
        MCP_ACTION_OPERATIONS,
        false,
    ),
    surface(
        "events",
        "Event Tools",
        PlatformClientSurfaceKind::ToolGroup,
        MCP_STREAM_OPERATIONS,
        true,
    ),
];

pub const PLATFORM_CLIENT_PROFILES: &[PlatformClientProfile] = &[
    profile(
        PlatformClientKind::Tui,
        "omniwa-tui",
        "OmniWA TUI",
        TUI_SURFACES,
    ),
    profile(
        PlatformClientKind::Cli,
        "omniwa-cli",
        "OmniWA CLI",
        CLI_SURFACES,
    ),
    profile(
        PlatformClientKind::WebDashboard,
        "omniwa-web-dashboard",
        "OmniWA Web Dashboard",
        WEB_DASHBOARD_SURFACES,
    ),
    profile(
        PlatformClientKind::McpServer,
        "omniwa-mcp-server",
        "OmniWA MCP Server",
        MCP_SERVER_SURFACES,
    ),
];

pub fn platform_client_profile(kind: PlatformClientKind) -> PlatformClientProfile {
    PLATFORM_CLIENT_PROFILES
        .iter()
        .copied()
        .find(|profile| profile.kind == kind)
        .expect("every platform client kind must have a profile")
}

pub fn validate_platform_client_profile(
    profile: PlatformClientProfile,
) -> Vec<PlatformClientProfileFinding> {
    let mut findings = Vec::new();

    for surface in profile.surfaces {
        for operation_id in surface.operation_ids {
            if operation_by_id(operation_id).is_none() {
                findings.push(finding(
                    profile,
                    surface,
                    operation_id,
                    "operation_missing_from_sdk_catalog",
                ));
                continue;
            }

            if begins_with_uppercase(operation_id) {
                findings.push(finding(
                    profile,
                    surface,
                    operation_id,
                    "operation_id_exposes_application_name",
                ));
            }
        }
    }

    findings
}

const fn surface(
    id: &'static str,
    title: &'static str,
    kind: PlatformClientSurfaceKind,
    operation_ids: &'static [&'static str],
    realtime: bool,
) -> PlatformClientSurface {
    PlatformClientSurface {
        id,
        title,
        kind,
        operation_ids,
        realtime,
    }
}

const fn profile(
    kind: PlatformClientKind,
    id: &'static str,
    title: &'static str,
    surfaces: &'static [PlatformClientSurface],
) -> PlatformClientProfile {
    PlatformClientProfile {
        kind,
        id,
        title,
        surfaces,
    }
}

fn finding(
    profile: PlatformClientProfile,
    surface: &PlatformClientSurface,
    operation_id: &'static str,
    reason: &'static str,
) -> PlatformClientProfileFinding {
    PlatformClientProfileFinding {
        client_id: profile.id,
        surface_id: surface.id,
        operation_id,
        reason,
    }
}

fn begins_with_uppercase(value: &str) -> bool {
    value
        .chars()
        .next()
        .map(|character| character.is_ascii_uppercase())
        .unwrap_or(false)
}
