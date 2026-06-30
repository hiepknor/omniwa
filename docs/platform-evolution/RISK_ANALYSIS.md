# Platform Evolution Risk Analysis

## Critical Risks

| Risk                                                  | Impact                                      | Mitigation                                                                    |
| ----------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Public API exposes Application command/query names    | Locks internal design as public contract    | REST resource adapter and OpenAPI operation IDs must hide internal names      |
| TUI bypasses SDK and calls raw HTTP                   | Duplicated protocol logic across clients    | Make SDK mandatory for TUI/CLI/Web/MCP                                        |
| Groups added inside Messaging or Provider adapter     | Business rules leak and boundaries degrade  | Add Groups domain and ADR before source changes                               |
| Provider-native payloads leak through events/logs/API | Security and compatibility risk             | Redaction tests, safe event envelope, no provider payload in public contracts |
| Durable schema created before data model review       | Persistence drift from repository semantics | Require Phase G physical data review and repository contract tests            |

## Major Risks

| Risk                                        | Impact                                         | Mitigation                                                      |
| ------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Query projections become source of truth    | Write model consistency breaks                 | Projections are rebuildable and read-only                       |
| Realtime stream emits too much data         | TUI/Web performance and confidentiality issues | SSE safe envelope, filter by authorized scope, retention cursor |
| Broadcast pressure re-enters through Groups | Policy/abuse risk                              | Keep Broadcast out until separate product/security decision     |
| SDK generated code is too low-level for TUI | TUI reimplements pagination/retry/errors       | Add ergonomic layer over generated client                       |
| Empty runtime apps hide integration gaps    | Late discovery of composition problems         | Implement runtime apps incrementally with smoke tests           |

## Minor Risks

| Risk                                   | Impact              | Mitigation                                                       |
| -------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| Too many docs diverge                  | Review friction     | Treat platform-evolution docs and ADRs as current migration plan |
| OpenAPI examples include unsafe data   | Security regression | Use synthetic safe examples only                                 |
| SSE not supported in some environments | Client degradation  | Polling fallback                                                 |

## Security Risks

- API key lifecycle is not a first-class source module yet.
- Logs API could expose raw confidential data if added without redaction gate.
- Group/member/contact data is confidential and needs strict filtering.
- SDK must not log request bodies or secrets.
- Event stream must enforce authorization per connection.

## Operational Risks

- Current runtime apps are mostly shells.
- In-memory adapters are not production storage.
- Projection builder is empty.
- No migration tooling exists.
- No OpenAPI/SDK compatibility gate exists.
