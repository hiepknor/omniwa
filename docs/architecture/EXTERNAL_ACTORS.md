# OmniWA External Actors

## Purpose

This document defines the actors that interact with OmniWA at system context level.

It does not define API endpoints, permissions implementation, authentication mechanism, or UI design.

## Actor Summary

| Actor | Role | Trust Level | Access Level |
| --- | --- | --- | --- |
| API Client | Programmatic consumer of OmniWA product capabilities | Partially trusted after authentication | Product API boundary |
| Developer / Operator | Technical user who integrates and operates OmniWA | Trusted within tenant when authenticated | Developer/operator boundary |
| Admin | Highest-trust operational user | Highly trusted within tenant when authenticated | Admin boundary |
| End Customer | WhatsApp user communicating with an instance | Untrusted external human | No direct OmniWA access |
| Webhook Consumer | External system receiving events from OmniWA | Partially trusted downstream | Webhook receiver boundary |
| External CRM | External business system integrated with OmniWA | Partially trusted downstream/upstream | Integration boundary |
| Automation Platform | External workflow platform integrated with OmniWA | Partially trusted downstream/upstream | Integration boundary |
| Monitoring System | External observability consumer | Trusted for sanitized telemetry only | Observability boundary |

## API Client

| Field | Description |
| --- | --- |
| Role | Programmatic system used by the tenant's product or backend to invoke OmniWA capabilities. |
| Goal | Send supported messages, inspect product state, receive product outcomes, and integrate with tenant workflows. |
| Access level | Authenticated access to product API boundary. |
| Trust level | Partially trusted after authentication; all inputs remain untrusted until validated. |
| Allowed interactions | Submit supported MVP message requests, inspect allowed instance/message/webhook state, trigger allowed product workflows. |
| Not allowed interactions | Direct Baileys access, direct data storage access, direct queue access, bypassing guardrails, bulk campaign/broadcast sending, unsupported message-type commitments. |

## Developer / Operator

| Field | Description |
| --- | --- |
| Role | Technical user responsible for setup, integration, troubleshooting, and day-to-day operation. |
| Goal | Pair instances, inspect health, debug failures, understand queue/webhook state, and operate within product guardrails. |
| Access level | Authenticated developer/operator boundary. |
| Trust level | Trusted inside one tenant after authentication and authorization. |
| Allowed interactions | Manage instance lifecycle, observe logs and health summaries, review failed/action-required states, use diagnostic workflows with explicit controls. |
| Not allowed interactions | Access Secret data in logs, bypass retention controls, disable guardrails silently, access raw provider payloads by default. |

## Admin

| Field | Description |
| --- | --- |
| Role | High-trust user responsible for system-level configuration, access governance, security-sensitive actions, and recovery operations. |
| Goal | Control tenant-level settings, protect credentials, manage operational risk, and perform recovery workflows. |
| Access level | Authenticated and authorized admin boundary. |
| Trust level | Highly trusted but still audited. |
| Allowed interactions | Configure trusted settings, manage credentials through controlled flows, initiate recovery procedures, manage access, review audit records. |
| Not allowed interactions | View Secret data after capture, bypass audit, disable mandatory redaction, change frozen product scope without ADR/product decision. |

## End Customer

| Field | Description |
| --- | --- |
| Role | WhatsApp user communicating with a tenant's WhatsApp account or instance. |
| Goal | Send and receive WhatsApp messages through WhatsApp. |
| Access level | No direct OmniWA access. Interaction happens through WhatsApp Network/provider boundary. |
| Trust level | Untrusted external actor. |
| Allowed interactions | Send WhatsApp messages to connected accounts, receive messages from connected accounts when lawful and expected. |
| Not allowed interactions | Direct OmniWA access, admin/operator actions, direct webhook/data/queue access. |

## Webhook Consumer

| Field | Description |
| --- | --- |
| Role | External endpoint or system receiving OmniWA integration events. |
| Goal | Consume message, status, instance, queue, or operational events for downstream workflows. |
| Access level | Receives outbound calls/events from OmniWA through webhook boundary. |
| Trust level | Partially trusted downstream; endpoint identity must be verified by future design. |
| Allowed interactions | Receive event payloads, acknowledge receipt, fail or timeout in ways OmniWA can retry and observe. |
| Not allowed interactions | Directly mutate OmniWA state outside approved integration paths, receive Secret data, rely on unredacted Confidential data. |

## External CRM

| Field | Description |
| --- | --- |
| Role | Business system that may trigger messages or consume events. |
| Goal | Connect customer records and workflows to WhatsApp communication. |
| Access level | Authenticated integration boundary where applicable; webhook consumer boundary for events. |
| Trust level | Partially trusted external system. |
| Allowed interactions | Trigger allowed workflows, consume sanitized events, associate OmniWA state with CRM records externally. |
| Not allowed interactions | Treat OmniWA as CRM owner, bypass consent responsibility, access raw session material, bypass message scope limits. |

## Automation Platform

| Field | Description |
| --- | --- |
| Role | External workflow system that may invoke OmniWA or consume events. |
| Goal | Automate business workflows around supported WhatsApp messaging and events. |
| Access level | Authenticated integration boundary where applicable; webhook boundary for events. |
| Trust level | Partially trusted external system. |
| Allowed interactions | Use allowed product operations, receive events, handle downstream automation. |
| Not allowed interactions | Bulk campaign/broadcast automation through OmniWA MVP, unsupported message-type workflows, direct provider access. |

## Monitoring System

| Field | Description |
| --- | --- |
| Role | External observability platform consuming logs, metrics, traces, or alerts. |
| Goal | Help operators detect, diagnose, and respond to OmniWA conditions. |
| Access level | Observability boundary with sanitized telemetry only. |
| Trust level | Trusted for sanitized operational data; not trusted for raw Secret or unredacted Confidential data. |
| Allowed interactions | Receive structured logs, metrics, traces, health states, and alerts after redaction. |
| Not allowed interactions | Receive Secret data, raw message/media payloads, raw webhook payloads, or raw provider payloads. |
