# OmniWA Risk Register

This document identifies product-level risks and mitigation strategies. It does not define implementation architecture.

## Technical Risks

### Risk: Baileys Behavior Changes

Baileys depends on WhatsApp Web behavior, which can change outside OmniWA's control.

Impact:

- Broken sessions.
- Message send/receive regressions.
- Changed event formats.
- Unexpected reconnect behavior.

Mitigation:

- Track Baileys releases and breaking changes.
- Keep OmniWA's product model stable even when internals change.
- Add compatibility testing around critical workflows.
- Document known upstream limitations.
- Pin one exact Baileys version for MVP and upgrade only through regression validation with rollback available.

Trade-off:

- Compatibility work slows feature delivery but protects production users.

### Risk: Session Instability

WhatsApp sessions can disconnect due to network issues, device state, account state, upstream changes, or policy enforcement.

Impact:

- Message delivery interruption.
- Operator confusion.
- Failed automation workflows.

Mitigation:

- Make instance state visible.
- Categorize disconnect reasons where possible.
- Provide reconnect guidance and runbooks.
- Avoid promising availability that OmniWA cannot control.

Trade-off:

- Honest state reporting may expose complexity, but it prevents false confidence.

### Risk: Message State Ambiguity

WhatsApp and Baileys behavior may not always provide clean product-level certainty for every message state.

Impact:

- Applications may misinterpret message outcomes.
- Support teams may struggle to explain failures.

Mitigation:

- Define clear product states such as accepted, queued, sent, delivered, failed, and unknown.
- Document what each state means and does not mean.
- Separate product processing state from upstream delivery state.

Trade-off:

- More state categories make the product more precise but require better documentation.

## Legal Risks

### Risk: Misuse For Spam Or Unsolicited Messaging

WhatsApp automation can be abused for spam, scraping, or unwanted outreach.

Impact:

- Account bans.
- Customer harm.
- Legal exposure.
- Reputational damage.

Mitigation:

- Document responsible-use boundaries.
- Enforce MVP product guardrails: no broadcast sending, no campaign workflows, no bulk recipient import for sending, and visible rate-limit or abuse-risk states.
- Avoid features designed for bypassing user consent or platform limits.
- Make out-of-scope policy clear in product documentation.

Trade-off:

- Guardrails may limit some user-requested workflows, but they protect the product's long-term viability.

### Risk: Privacy And Data Protection Requirements

Messages, contacts, media, and group participant data may contain personal or sensitive information.

Impact:

- Privacy violations.
- Regulatory risk.
- Customer trust loss.

Mitigation:

- Treat message content and session material as sensitive.
- Redact sensitive data from logs by default.
- Apply the Phase 0.5 retention policy: 30 days for message metadata, no default message body retention after processing, maximum 7 days for explicitly enabled diagnostic content capture, and 14 days for encrypted backups.
- Require security review for production-facing phases.

Trade-off:

- Privacy controls add product and operational complexity.

## Operational Risks

### Risk: Poor Observability

Without strong observability, operators may not know whether failures come from OmniWA, Baileys, WhatsApp, network state, queue delays, or external webhooks.

Impact:

- Longer incidents.
- More support burden.
- Lower production trust.

Mitigation:

- Define health states for instances and critical workflows.
- Track webhook success and retry behavior.
- Track reconnect outcomes.
- Provide dashboard and logs for common failure paths.

Trade-off:

- Observability requires ongoing product work and data volume management.

### Risk: Queue Backlog And Hidden Failures

Asynchronous work can accumulate during spikes or downstream failures.

Impact:

- Delayed messages.
- Late webhook delivery.
- Operators may believe the system is healthy when work is stuck.

Mitigation:

- Make queue depth, age, retries, and dead-letter conditions visible.
- Define product behavior for retry exhaustion.
- Provide recovery guidance.

Trade-off:

- Exposing queue internals at product level must be done carefully so users understand actions without needing architecture knowledge.

## Security Risks

### Risk: Session Material Exposure

WhatsApp session credentials are sensitive. Exposure could allow unauthorized access to messaging capabilities.

Impact:

- Account compromise.
- Data leakage.
- Unauthorized messaging.

Mitigation:

- Treat session data as secret material.
- Restrict access to administrative actions.
- Avoid logging secrets.
- Define backup security requirements before production use.
- Encrypt Secret data in transit and at rest, and never expose it in plaintext after creation or capture except through controlled secret-handling flows.

Trade-off:

- Stronger secret protection can complicate local development and recovery.

### Risk: Webhook Abuse

Webhook integrations can leak data or be used to trigger unwanted downstream behavior.

Impact:

- Data exfiltration.
- Integration abuse.
- Incident amplification.

Mitigation:

- Require webhook authentication or signing in future design.
- Document event sensitivity.
- Provide retry and failure controls.
- Avoid exposing unnecessary payload data.

Trade-off:

- Security controls add integration work for developers.

## Dependency Risks

### Risk: Node Ecosystem And Package Drift

OmniWA will depend on external packages beyond Baileys.

Impact:

- Vulnerabilities.
- Breaking changes.
- Maintenance burden.

Mitigation:

- Keep dependency scope limited.
- Review critical dependencies.
- Track security advisories.
- Define upgrade policy.

Trade-off:

- Fewer dependencies may require more internal work, while more dependencies increase supply-chain risk.

### Risk: Upstream Documentation Gaps

Baileys and WhatsApp Web behavior may not be documented with product-grade stability guarantees.

Impact:

- Slower debugging.
- More reverse engineering.
- Higher regression risk.

Mitigation:

- Maintain OmniWA-specific operational notes.
- Capture learnings in ADRs, runbooks, and agentmemory.
- Build tests around observed behavior.

Trade-off:

- Internal documentation becomes necessary maintenance work.

## Baileys Risks

### Risk: Unofficial Surface Area

Baileys interacts with WhatsApp Web behavior and is not the same as Meta's official WhatsApp Business Platform.

Impact:

- Policy uncertainty.
- Account risk.
- Unexpected upstream behavior changes.

Mitigation:

- Be explicit that OmniWA is not a Cloud API replacement.
- Avoid policy-bypass positioning.
- Document responsible-use constraints.
- Recommend official Meta APIs where they are the better fit.

Trade-off:

- Honest positioning may reduce some adoption but increases trust with responsible users.

## WhatsApp Policy Risks

### Risk: Platform Policy Violation

Users may attempt workflows that violate WhatsApp or Meta policy, such as unsolicited messaging, spam, or prohibited automation.

Impact:

- Account restrictions or bans.
- Legal and reputational exposure.
- Product misuse.

Mitigation:

- Define out-of-scope use cases clearly.
- Document that users are responsible for consent and policy compliance.
- Avoid features whose primary purpose is bypassing platform limits.
- Enforce MVP guardrails against broadcast, campaign sending, and bulk recipient import for sending.
- Make throttled, blocked, failed, and action-required activity visible to operators.

Trade-off:

- Policy guardrails can reduce flexibility, but they protect the product and its users.

## Risk Review Cadence

Risks should be reviewed:

- At the end of every roadmap phase.
- Before production readiness claims.
- After major Baileys upgrades.
- After any incident involving message delivery, account restrictions, security, or data exposure.

## Reference Baseline

These references were used as a policy and dependency baseline on 2026-06-29:

- WhiskeySockets/Baileys repository: https://github.com/WhiskeySockets/Baileys
- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- WhatsApp Business Terms of Service: https://www.whatsapp.com/legal/business-terms
- WhatsApp Business Platform feature overview: https://whatsappbusiness.com/products/business-platform-features/

These links are not a substitute for legal review. They should be rechecked before production launch because upstream policy and dependency behavior can change.
