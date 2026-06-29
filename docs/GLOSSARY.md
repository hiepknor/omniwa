# OmniWA Glossary

This glossary defines product language for OmniWA. Terms may map to Baileys or WhatsApp concepts, but the definitions here describe how the product should talk about them.

## API Key

A credential used by an external system or developer to access OmniWA product capabilities.

Product note: API keys are sensitive and should be treated as secrets.

## Abuse Detection

Product-level detection of suspicious usage patterns such as excessive failures, repeated recipients, abnormal send bursts, or policy-risk indicators.

Product note: MVP abuse detection is rule-based and operator-visible, not automated legal compliance.

## Baileys

WhiskeySockets/Baileys, the underlying library OmniWA uses to interact with WhatsApp Web behavior.

Product note: Baileys is a foundation, not the product surface.

## Broadcast

Sending the same or near-identical message to many recipients as a campaign or audience blast.

Product note: broadcast and campaign sending are out of scope for MVP.

## Chat

A conversation context in WhatsApp, usually associated with a person, group, or broadcast-like interaction.

Product note: chats help users reason about message history and conversation state.

## Contact

A WhatsApp identity or address book entry known to an instance.

Product note: contact data can be sensitive and should be handled with privacy expectations.

## Confidential Data

Customer, message, contact, webhook, media, or operational data that could expose business activity or personal data.

Product note: Confidential data must be encrypted in transit and at rest and redacted from normal logs.

## Delivery Status

The product-visible state of a message after it is accepted for processing.

Product note: status should distinguish product processing state from upstream WhatsApp delivery behavior.

## Device

The WhatsApp-linked device context associated with a session.

Product note: device state can affect connection reliability.

## Group

A WhatsApp conversation with multiple participants.

Product note: group automation has higher policy and abuse risk than one-to-one messaging.

## Instance

A managed WhatsApp connection in OmniWA.

Product note: an instance is the primary product unit that operators create, pair, monitor, disconnect, and troubleshoot.

## JID

Jabber ID, the identifier format commonly used in WhatsApp/Baileys contexts to address users, groups, and other entities.

Product note: JIDs may appear in logs and troubleshooting, but user-facing documentation should explain what they represent.

## Media

Non-text message content such as image, audio, video, document, sticker, or voice note where supported.

Product note: media introduces size, storage, retention, and security concerns.

## Message

A unit of communication sent or received through WhatsApp.

Product note: messages may have lifecycle states, metadata, sender/recipient context, and failure reasons.

## Message Queue

The product concept for asynchronous message processing.

Product note: queueing improves reliability and load handling, but failures must remain visible.

## Participant

A member of a WhatsApp group.

Product note: participant actions and metadata may be sensitive in group workflows.

## Policy Guardrail

A product rule or warning designed to reduce misuse, spam, privacy violations, or policy risk.

Product note: guardrails do not replace legal review or Meta policy compliance.

## Public Data

Information intentionally safe to publish.

Product note: public docs and non-sensitive release notes are examples.

## QR Pairing

The process of linking a WhatsApp account/session by scanning a QR code or using the supported pairing flow.

Product note: QR pairing is a critical onboarding workflow for instances.

## Reconnect

The process of restoring an instance after a disconnection or session disruption.

Product note: reconnect behavior should be observable and categorized by reason where possible.

## Session

The connection and authentication state behind a WhatsApp instance.

Product note: session material is sensitive. The product should distinguish the operator-facing instance from the underlying session state.

## Secret Data

Credentials or material that can grant access or impersonate a system, account, or instance.

Product note: API keys, webhook secrets, session/auth material, tokens, and private encryption keys are Secret data and must never be logged.

## Spam

Unsolicited, deceptive, repetitive, or high-volume messaging sent without user consent or outside an expected conversation.

Product note: OmniWA is not a spam or policy-bypass tool.

## Tenant

A logical customer, workspace, or organization boundary in a future multi-tenant OmniWA product.

Product note: tenancy is a product direction, not necessarily an MVP requirement.

## Webhook

An outbound event notification sent by OmniWA to an external system.

Product note: webhooks are part of the integration contract and need reliability expectations.

## Worker

A background execution role that processes asynchronous work such as messages, media, webhook delivery, or retries.

Product note: Phase 0 uses the term at product level only and does not define worker architecture.

## WhatsApp Business Platform

Meta's official business messaging platform, including Cloud API and related policy requirements.

Product note: OmniWA does not replace or bypass the official platform.

## WhatsApp Web

The WhatsApp web/device-linked behavior that Baileys interacts with.

Product note: WhatsApp Web behavior can change upstream, which creates dependency risk.
