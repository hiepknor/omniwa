# OmniWA Success Metrics

This document defines how OmniWA product success should be measured. Metrics should be reviewed at every phase gate and revised when real usage data becomes available.

## Product Success Principles

Good metrics should:

- Separate OmniWA-controlled behavior from WhatsApp, device, network, and user-controlled behavior.
- Measure reliability, not only feature usage.
- Help operators take action.
- Support product decisions about MVP readiness.
- Avoid incentivizing spam or unsafe messaging volume.

## API Latency

### Definition

Time from receiving a product operation request to returning an initial product response.

### Initial Target

- P95 under 500 ms for common non-media operations under normal MVP load.
- P95 under 300 ms for enqueue-style operations where the product accepts work for asynchronous processing.

### Why It Matters

Low latency improves developer experience and system integration behavior.

### Trade-off

Fast acknowledgement must not imply that WhatsApp delivery is complete.

## Webhook Success Rate

### Definition

Percentage of webhook events delivered successfully to configured external systems.

### Initial Target

- 99% successful delivery after retry for healthy downstream endpoints.
- Track first-attempt success separately from eventual success.
- 95% first-attempt success for healthy downstream endpoints.
- 99% eventual delivery within 15 minutes for healthy downstream endpoints.

### Why It Matters

Webhook reliability determines whether external systems can trust OmniWA as an event source.

### Trade-off

Aggressive retries can overload downstream systems. Retry behavior should balance reliability and backpressure.

## Reconnect Success Rate

### Definition

Percentage of disconnected instances that return to a healthy connected state without manual re-pairing, grouped by disconnect reason.

### Initial Target

- 85% of auto-recoverable disconnects return to connected state within 5 minutes.
- Logout, policy restriction, missing credentials, device unlink, and action-required states are excluded from the auto-reconnect rate and tracked separately.

### Why It Matters

WhatsApp connectivity is a core operational concern for OmniWA.

### Trade-off

Some disconnects cannot or should not be automatically recovered. Metrics must not hide cases that require operator action.

## Queue Throughput

### Definition

Number of queued work items processed per minute, grouped by work type.

### Initial Target

- MVP should process enough queue throughput to keep accepted work within the Queue Success Rate target under normal MVP load.
- Queue throughput must be reported by work type: message, media, webhook, retry, and recovery.
- Oldest pending item age must remain under 10 minutes under normal MVP load.

### Why It Matters

Queue throughput shows whether OmniWA can keep up with messaging, webhook, media, and retry workloads.

### Trade-off

Throughput without failure visibility is misleading. Track queue age and retry exhaustion alongside throughput.

## Queue Success Rate

### Definition

Percentage of accepted queue work that reaches a completed or terminal failed state within the expected time window.

### Initial Target

- 99% of accepted queue work reaches completed or terminal failed state within 10 minutes under normal MVP load.
- 0 known silent drops for accepted work.
- Every accepted item must be observable as completed, pending, retried, failed, or action-required.

### Why It Matters

Queue success proves that asynchronous work is reliable and visible, not merely accepted.

### Trade-off

Terminal failure is acceptable when it is visible and actionable. Silent loss is not acceptable.

## Worker Stability

### Definition

Ability of background processing roles to run continuously without crashes, stuck work, or uncontrolled retries.

### Initial Target

- Track worker restarts, failed jobs, retry exhaustion, and oldest queued item age.
- MVP worker stability target is no uncontrolled restart loop during a 24-hour controlled validation run.
- Retry exhaustion must create visible terminal failure or action-required state.

### Why It Matters

Much of OmniWA's reliability depends on background work, even if users interact through a synchronous product surface.

### Trade-off

Stability metrics should not require exposing implementation details to end users; operators need enough signal to act.

## Deployment Time

### Definition

Time required for a developer or operator to deploy OmniWA into a documented environment.

### Initial Target

- Developer setup under 30 minutes after documentation exists.
- Documented single-tenant MVP deployment under 60 minutes.

### Why It Matters

Setup friction directly affects adoption and support cost.

### Trade-off

Faster setup must not rely on insecure defaults for production.

## Mean Time To Recovery

### Definition

Average time required to restore service after a critical OmniWA-controlled failure.

### Initial Target

- P1 OmniWA-controlled incidents restored within 4 hours.
- Recovery action and outcome recorded for every P1 incident.

### Why It Matters

Recovery speed is a stronger production-readiness signal than happy-path uptime alone.

### Trade-off

Reducing MTTR requires runbooks, observability, and operational practice, not only implementation work.

## Developer Onboarding Time

### Definition

Time required for a new developer to understand the product model, run the platform, pair an instance, and validate a basic message workflow.

### Initial Target

- Under 60 minutes for MVP.
- Under 30 minutes after developer experience improvements.

### Why It Matters

OmniWA's target users include developers and SaaS builders. Onboarding speed is core product value.

### Trade-off

Onboarding should be fast, but documentation must still make product limits clear.

## Instance Health

### Definition

Percentage of instances in a healthy connected or intentionally stopped state versus unhealthy, unknown, or action-required states.

### Initial Target

- 95% of active instances should be in connected, intentionally stopped, or action-required state under controlled MVP validation.
- Unknown state should remain below 1% of active instance time during controlled MVP validation.

### Why It Matters

Instance health is the clearest operator-level signal for a WhatsApp connectivity platform.

### Trade-off

Health must not collapse too many states into a single green/red indicator.

## Message Failure Rate

### Definition

Percentage of message workflows that end in failure or unknown state, grouped by failure category.

### Initial Target

- 100% of failed or unknown message workflows should have a visible failure category.
- Unknown message outcome rate should remain below 2% under controlled MVP validation, excluding upstream WhatsApp and device conditions outside OmniWA control.

### Why It Matters

Message reliability is the core product expectation.

### Trade-off

Failure categories may expose upstream complexity, but they help teams debug and improve.

## Media Processing Success Rate

### Definition

Percentage of media send/receive workflows that complete successfully within documented limits.

### Initial Target

- 95% success for supported MVP media types under documented size limits and healthy upstream/network conditions.
- Track success by media type and size class.

### Why It Matters

Media workflows are common in business messaging but more failure-prone than text.

### Trade-off

Supporting more media types expands product value but increases testing and operational burden.

## Dashboard Task Completion

### Definition

Percentage of common operator tasks that can be completed through the dashboard without reading raw logs.

### Initial Target

- MVP dashboard should support the five approved operator tasks: instance health, QR pairing state, recent message/event inspection, webhook delivery status, and queue/failure visibility.
- 90% internal task completion for those five tasks during MVP review.

### Why It Matters

The dashboard should reduce operational friction, not only display data.

### Trade-off

Dashboard improvements must not replace automation and documentation.

## Metric Review Rules

At each phase gate, the team should decide:

- Which metrics are active now.
- Which metrics are deferred.
- Which targets are unrealistic and need revision.
- Which metrics require new product instrumentation.
- Which metrics indicate MVP readiness.
