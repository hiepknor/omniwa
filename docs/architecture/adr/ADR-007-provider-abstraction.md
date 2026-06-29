# ADR-007 Provider Abstraction

## Status

Accepted.

## Context

OmniWA starts on WhiskeySockets/Baileys but must avoid becoming a Baileys-shaped product. Future evolution may include WhatsApp Cloud API, Telegram, Messenger, Instagram, or mock providers.

## Decision

OmniWA will define provider abstractions around product capabilities, not provider libraries.

Provider abstractions must cover product concepts such as:

- Instance connectivity.
- Session lifecycle.
- Supported MVP message sending and receiving.
- Message status visibility.
- Media transfer behavior.
- Provider error classification.
- Reconnect and action-required states.

Provider abstractions must not expose provider-native payloads to domain policy.

## Consequences

- Provider-specific differences are handled at the edge.
- Future providers are possible where they can satisfy product contracts.
- Unsupported provider features stay outside MVP scope until explicitly accepted.

## Trade-offs

- Common abstractions may hide useful provider-specific capabilities.
- Some provider behavior will require explicit extension points rather than forcing it into generic APIs.

## Alternatives Considered

- Baileys-first abstraction: would reduce mapping but lock the product to Baileys.
- Lowest-common-denominator abstraction: too weak for a reliable product platform.
- Provider-specific use cases: flexible but fragments product behavior.
