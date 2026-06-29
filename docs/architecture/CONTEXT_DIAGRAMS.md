# OmniWA Context Diagrams

## Purpose

This document contains Mermaid diagrams for OmniWA system context.

The diagrams show actors, external systems, trust boundaries, and high-level flows. They do not define API endpoints, schemas, modules, queue internals, or deployment topology.

## C4 Context Diagram

```mermaid
flowchart LR
  apiClient[API Client]
  developer[Developer / Operator]
  admin[Admin]
  crm[External CRM]
  automation[Automation Platform]
  webhookConsumer[Webhook Consumer]
  monitoring[Monitoring System]
  endCustomer[End Customer]

  omniwa[OmniWA\nSingle Tenant + Multi Instance\nWhatsApp API Platform]
  provider[Messaging Provider Adapter\nBaileys initially]
  whatsapp[WhatsApp Web / WhatsApp Network]

  apiClient -->|authenticated product operations| omniwa
  developer -->|operate instances and troubleshoot| omniwa
  admin -->|admin and recovery actions| omniwa
  crm -->|allowed integrations| omniwa
  automation -->|allowed automation workflows| omniwa
  omniwa -->|sanitized telemetry| monitoring
  omniwa -->|integration events| webhookConsumer
  omniwa -->|provider operations| provider
  provider <--> whatsapp
  endCustomer <--> whatsapp
```

## Trust Boundary Diagram

```mermaid
flowchart TB
  subgraph Internet[Untrusted Internet]
    apiClient[API Client]
    developer[Developer / Operator]
    admin[Admin]
    webhookConsumer[Webhook Consumer]
    crm[External CRM]
    automation[Automation Platform]
    endCustomer[End Customer]
  end

  subgraph Runtime[OmniWA Runtime]
    apiBoundary[API Boundary]
    adminBoundary[Admin Boundary]
    app[Application + Domain Policy]
    providerBoundary[Provider Boundary]
    webhookBoundary[Webhook Boundary]
    observabilityBoundary[Observability Boundary]
  end

  subgraph DataServices[Internal Data Services]
    dataStorage[Data Storage Boundary]
    queue[Queue Boundary]
  end

  subgraph Provider[External Provider]
    providerAdapter[Messaging Provider Adapter]
    whatsapp[WhatsApp Web / Network]
  end

  apiClient --> apiBoundary --> app
  developer --> apiBoundary
  admin --> adminBoundary --> app
  crm --> apiBoundary
  automation --> apiBoundary
  app --> webhookBoundary --> webhookConsumer
  app --> dataStorage
  app --> queue
  app --> observabilityBoundary
  app --> providerBoundary --> providerAdapter --> whatsapp
  endCustomer --> whatsapp
```

## High-Level Message Flow

```mermaid
sequenceDiagram
  participant Client as API Client
  participant OmniWA as OmniWA
  participant Provider as Messaging Provider Adapter
  participant WA as WhatsApp Network

  Client->>OmniWA: Submit supported message request
  OmniWA->>OmniWA: Authenticate, validate, apply guardrails
  OmniWA->>OmniWA: Record accepted or rejected state
  OmniWA->>Provider: Request provider delivery through provider port
  Provider->>WA: Provider-specific send operation
  WA-->>Provider: Provider status or failure signal
  Provider-->>OmniWA: Translated provider result
  OmniWA->>OmniWA: Update product state and observable outcome
  OmniWA-->>Client: Product-level result or accepted-work state
```

## Webhook Flow

```mermaid
sequenceDiagram
  participant WA as WhatsApp Network
  participant Provider as Messaging Provider Adapter
  participant OmniWA as OmniWA
  participant Queue as Async Job Boundary
  participant Consumer as Webhook Consumer

  WA-->>Provider: Incoming provider event
  Provider-->>OmniWA: Translated product event
  OmniWA->>OmniWA: Validate, classify, redact where required
  OmniWA->>Queue: Enqueue webhook delivery work
  Queue-->>OmniWA: Pending / retrying / terminal state
  OmniWA->>Consumer: Deliver integration event
  Consumer-->>OmniWA: Acknowledge, fail, or timeout
  OmniWA->>OmniWA: Record delivery state, retry, dead-letter, or completed
```

## Context Diagram Notes

- The provider adapter is inside the OmniWA architecture boundary but communicates with external provider systems.
- WhatsApp Web / WhatsApp Network is outside OmniWA control.
- Webhook consumers, CRMs, automation platforms, and monitoring systems are outside OmniWA trust boundaries.
- Internal data services are trusted only through defined data/queue boundaries.
- No diagram implies a concrete API route, database schema, queue engine, or deployment topology.
