import type { DomainAggregateType, DomainOwnerContext } from "@omniwa/domain";

export const repositoryPortNames = [
  "InstanceRepositoryPort",
  "SessionRepositoryPort",
  "MessageRepositoryPort",
  "MediaAssetRepositoryPort",
  "WebhookSubscriptionRepositoryPort",
  "WebhookDeliveryRepositoryPort",
  "GuardrailDecisionRepositoryPort",
  "ProviderProfileRepositoryPort",
  "WorkerJobRepositoryPort",
  "AccessDecisionRepositoryPort",
  "AuditRecordRepositoryPort",
  "HealthStatusRepositoryPort",
  "ConfigurationSnapshotRepositoryPort",
  "TelemetrySignalRepositoryPort",
] as const;

export type RepositoryPortName = (typeof repositoryPortNames)[number];

export const physicalStoreRoles = [
  "postgresql_source",
  "redis_ephemeral",
  "object_artifact",
] as const;

export type PhysicalStoreRole = (typeof physicalStoreRoles)[number];

export const repositoryConsistencyModels = [
  "strong_owner",
  "application_coordinated",
  "eventual_projection",
] as const;

export type RepositoryConsistencyModel = (typeof repositoryConsistencyModels)[number];

export type RepositoryAdapterTraceability = Readonly<{
  applicationRefs: readonly string[];
  apiResources: readonly string[];
  productCapability: string;
}>;

export type RepositoryAdapterPlan = Readonly<{
  repositoryPort: RepositoryPortName;
  aggregateRoot: DomainAggregateType;
  ownerContext: DomainOwnerContext;
  persistenceUnit: string;
  logicalStorage: string;
  storeOfRecord: PhysicalStoreRole;
  consistency: RepositoryConsistencyModel;
  allowedOperations: readonly string[];
  snapshotCandidate: boolean;
  archiveCandidate: boolean;
  mappingBoundary: string;
  forbiddenData: readonly string[];
  traceability: RepositoryAdapterTraceability;
}>;

export type PhysicalDataModelReview = Readonly<{
  status: "reviewed";
  schemaCreationAllowed: false;
  ormModelCreationAllowed: false;
  migrationCreationAllowed: false;
  sourceOfTruthStore: "postgresql";
  redisBoundary: "ephemeral_only";
  objectStorageBoundary: "artifact_only";
  reviewNotes: readonly string[];
}>;

const sharedForbiddenData = [
  "provider_native_payload",
  "session_secret_plaintext",
  "raw_confidential_payload",
  "raw_phone_or_jid",
  "raw_message_body",
  "raw_media_binary",
] as const;

export const repositoryAdapterPlans = Object.freeze([
  plan({
    repositoryPort: "InstanceRepositoryPort",
    aggregateRoot: "Instance",
    ownerContext: "instance",
    persistenceUnit: "Instance State",
    logicalStorage: "Instance State Storage",
    consistency: "strong_owner",
    allowedOperations: [
      "load",
      "save",
      "exists",
      "findByStatus",
      "findNonTerminal",
      "getCurrentSessionId",
    ],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary: "Instance lifecycle state and safe readiness references only.",
    traceability: {
      applicationRefs: ["UC-INS-001", "UC-INS-003", "UC-INS-008", "UC-INS-010", "UC-INS-011"],
      apiResources: ["Instance"],
      productCapability: "Instance lifecycle",
    },
  }),
  plan({
    repositoryPort: "SessionRepositoryPort",
    aggregateRoot: "Session",
    ownerContext: "session",
    persistenceUnit: "Session State",
    logicalStorage: "Session State Storage",
    consistency: "application_coordinated",
    allowedOperations: [
      "load",
      "save",
      "exists",
      "findByInstance",
      "findByStatusForInstance",
      "findRecoveryRequired",
    ],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Session lifecycle, recovery, and retention metadata without raw credential material.",
    traceability: {
      applicationRefs: ["UC-INS-004", "UC-INS-005", "UC-INS-006", "UC-INS-009"],
      apiResources: ["Session", "QR"],
      productCapability: "Pairing and connection reliability",
    },
  }),
  plan({
    repositoryPort: "MessageRepositoryPort",
    aggregateRoot: "Message",
    ownerContext: "messaging",
    persistenceUnit: "Message State",
    logicalStorage: "Messaging State Storage",
    consistency: "strong_owner",
    allowedOperations: [
      "load",
      "save",
      "exists",
      "findByStatus",
      "findByIdempotencyKey",
      "findRecoverableByOwner",
    ],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Message identity, direction, type category, lifecycle, failure category, and idempotency marker only.",
    traceability: {
      applicationRefs: ["UC-MSG-001", "UC-MSG-002", "UC-MSG-005", "UC-MSG-008", "UC-MSG-010"],
      apiResources: ["Message"],
      productCapability: "Messaging",
    },
  }),
  plan({
    repositoryPort: "MediaAssetRepositoryPort",
    aggregateRoot: "MediaAsset",
    ownerContext: "media",
    persistenceUnit: "Media Metadata State",
    logicalStorage: "Media Metadata Storage",
    consistency: "application_coordinated",
    allowedOperations: [
      "load",
      "save",
      "exists",
      "findByStatus",
      "findRequiringCleanup",
      "findByMessage",
    ],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Media metadata and lifecycle only; binary artifacts remain outside business metadata.",
    traceability: {
      applicationRefs: ["UC-MED-001", "UC-MED-002", "UC-MED-005", "UC-MED-006"],
      apiResources: ["Media"],
      productCapability: "Media handling",
    },
  }),
  plan({
    repositoryPort: "WebhookSubscriptionRepositoryPort",
    aggregateRoot: "WebhookSubscription",
    ownerContext: "webhook_delivery",
    persistenceUnit: "Webhook Subscription State",
    logicalStorage: "Webhook Subscription Storage",
    consistency: "strong_owner",
    allowedOperations: ["load", "save", "exists", "findByStatus", "findActiveForSignal"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Subscription lifecycle and safe destination metadata without webhook secret exposure.",
    traceability: {
      applicationRefs: [
        "UC-WEB-001",
        "UC-WEB-002",
        "UC-WEB-003",
        "UC-WEB-004",
        "UC-WEB-005",
        "UC-WEB-010",
      ],
      apiResources: ["WebhookSubscription"],
      productCapability: "Webhook configuration",
    },
  }),
  plan({
    repositoryPort: "WebhookDeliveryRepositoryPort",
    aggregateRoot: "WebhookDelivery",
    ownerContext: "webhook_delivery",
    persistenceUnit: "Webhook Delivery State",
    logicalStorage: "Webhook Delivery Storage",
    consistency: "application_coordinated",
    allowedOperations: [
      "load",
      "save",
      "exists",
      "findByStatus",
      "findBySourceSignal",
      "findByIdempotencyKey",
    ],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Delivery lifecycle, source signal reference, retry/dead-letter state, and idempotency marker.",
    traceability: {
      applicationRefs: ["UC-WEB-006", "UC-WEB-007", "UC-WEB-008", "UC-WEB-009", "UC-WEB-010"],
      apiResources: ["WebhookDelivery"],
      productCapability: "Webhook delivery reliability",
    },
  }),
  plan({
    repositoryPort: "GuardrailDecisionRepositoryPort",
    aggregateRoot: "GuardrailDecision",
    ownerContext: "guardrails",
    persistenceUnit: "Guardrail Decision State",
    logicalStorage: "Guardrail Decision Storage",
    consistency: "strong_owner",
    allowedOperations: ["load", "save", "exists", "findByEvaluatedIntent"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary: "Responsible-usage decision state and safe reason category only.",
    traceability: {
      applicationRefs: ["UC-MSG-003"],
      apiResources: ["Message"],
      productCapability: "Product guardrails",
    },
  }),
  plan({
    repositoryPort: "ProviderProfileRepositoryPort",
    aggregateRoot: "ProviderProfile",
    ownerContext: "provider_integration",
    persistenceUnit: "Provider Profile State",
    logicalStorage: "Provider Profile Storage",
    consistency: "strong_owner",
    allowedOperations: ["load", "save", "exists", "findByStatus", "findSupportedOrDegraded"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Product-level provider capability vocabulary only; no runtime socket or native payload.",
    traceability: {
      applicationRefs: ["UC-PRV-001", "UC-PRV-006"],
      apiResources: ["Provider"],
      productCapability: "Provider abstraction",
    },
  }),
  plan({
    repositoryPort: "WorkerJobRepositoryPort",
    aggregateRoot: "WorkerJob",
    ownerContext: "operations",
    persistenceUnit: "Worker Job State",
    logicalStorage: "Worker Job Storage",
    consistency: "application_coordinated",
    allowedOperations: [
      "load",
      "save",
      "exists",
      "findByStatus",
      "findByOwnerContext",
      "findByIdempotencyKey",
    ],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Async work visibility and retry/dead lifecycle without queue-engine internals.",
    traceability: {
      applicationRefs: ["UC-OPS-001", "UC-OPS-002", "UC-OPS-003", "UC-OPS-004"],
      apiResources: ["WorkerJob"],
      productCapability: "Queue and worker visibility",
    },
  }),
  plan({
    repositoryPort: "AccessDecisionRepositoryPort",
    aggregateRoot: "AccessDecision",
    ownerContext: "security_access",
    persistenceUnit: "Access Decision State",
    logicalStorage: "Access Decision Storage",
    consistency: "strong_owner",
    allowedOperations: ["load", "save", "exists", "findUnexpiredByCapability"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Actor, capability, target reference, decision, and expiry without auth provider payload.",
    traceability: {
      applicationRefs: ["UC-ADM-001"],
      apiResources: ["Admin resources"],
      productCapability: "Security and access",
    },
  }),
  plan({
    repositoryPort: "AuditRecordRepositoryPort",
    aggregateRoot: "AuditRecord",
    ownerContext: "audit",
    persistenceUnit: "Audit State",
    logicalStorage: "Audit Storage",
    consistency: "strong_owner",
    allowedOperations: ["load", "save", "exists", "findBySourceSignal", "findRetentionExpired"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Secret-safe audit metadata, source reference, redaction marker, and retention state.",
    traceability: {
      applicationRefs: ["UC-ADM-004", "UC-MON-004"],
      apiResources: ["AuditRecord"],
      productCapability: "Audit",
    },
  }),
  plan({
    repositoryPort: "HealthStatusRepositoryPort",
    aggregateRoot: "HealthStatus",
    ownerContext: "health",
    persistenceUnit: "Health Projection State",
    logicalStorage: "Health Projection Storage",
    consistency: "eventual_projection",
    allowedOperations: ["load", "save", "exists", "findBySubject", "findByCategory"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary: "Health subject classification and safe cause category only.",
    traceability: {
      applicationRefs: ["UC-MON-001", "UC-MON-003"],
      apiResources: ["Health"],
      productCapability: "Observability",
    },
  }),
  plan({
    repositoryPort: "ConfigurationSnapshotRepositoryPort",
    aggregateRoot: "ConfigurationSnapshot",
    ownerContext: "configuration",
    persistenceUnit: "Configuration State",
    logicalStorage: "Configuration Storage",
    consistency: "application_coordinated",
    allowedOperations: ["load", "save", "exists", "findActive", "findRejectedGuardrailBypass"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary:
      "Safe setting categories, activation state, and guardrail classification without Secret values.",
    traceability: {
      applicationRefs: ["UC-ADM-002", "UC-ADM-003"],
      apiResources: ["Configuration"],
      productCapability: "Configuration",
    },
  }),
  plan({
    repositoryPort: "TelemetrySignalRepositoryPort",
    aggregateRoot: "TelemetrySignal",
    ownerContext: "observability",
    persistenceUnit: "Telemetry Projection State",
    logicalStorage: "Telemetry Projection Storage",
    consistency: "eventual_projection",
    allowedOperations: ["load", "save", "exists", "findCaptured", "findDroppedBySource"],
    snapshotCandidate: true,
    archiveCandidate: true,
    mappingBoundary: "Safe telemetry category and sanitization/drop decision only.",
    traceability: {
      applicationRefs: ["UC-MON-002", "metrics snapshot queries"],
      apiResources: ["Metrics"],
      productCapability: "Observability",
    },
  }),
] satisfies readonly RepositoryAdapterPlan[]);

export const physicalDataModelReview: PhysicalDataModelReview = Object.freeze({
  status: "reviewed",
  schemaCreationAllowed: false,
  ormModelCreationAllowed: false,
  migrationCreationAllowed: false,
  sourceOfTruthStore: "postgresql",
  redisBoundary: "ephemeral_only",
  objectStorageBoundary: "artifact_only",
  reviewNotes: Object.freeze([
    "Every repository adapter maps to one approved Aggregate Root boundary.",
    "PostgreSQL is the only source-of-truth store for repository adapters in MVP.",
    "Redis is limited to ephemeral cache, lock, rate, queue-support, and runtime hint roles.",
    "Object Storage is limited to approved binary/artifact classes and cannot hold business metadata.",
    "Physical schemas, ORM models, migrations, and SQL remain deferred to adapter implementation review.",
  ]),
});

export function listRepositoryAdapterPlans(): readonly RepositoryAdapterPlan[] {
  return repositoryAdapterPlans;
}

export function getRepositoryAdapterPlan(
  repositoryPort: RepositoryPortName,
): RepositoryAdapterPlan {
  const planEntry = repositoryAdapterPlans.find(
    (planValue) => planValue.repositoryPort === repositoryPort,
  );

  if (planEntry === undefined) {
    throw new TypeError(`Repository adapter plan is missing for ${repositoryPort}.`);
  }

  return planEntry;
}

export function findRepositoryAdapterPlansByOwner(
  ownerContext: DomainOwnerContext,
): readonly RepositoryAdapterPlan[] {
  return Object.freeze(
    repositoryAdapterPlans.filter((planValue) => planValue.ownerContext === ownerContext),
  );
}

export function validateRepositoryAdapterPlanCompleteness(): readonly string[] {
  const seen = new Set(repositoryAdapterPlans.map((planValue) => planValue.repositoryPort));
  const failures: string[] = [];

  for (const repositoryPort of repositoryPortNames) {
    if (!seen.has(repositoryPort)) {
      failures.push(`Missing repository adapter plan for ${repositoryPort}.`);
    }
  }

  if (seen.size !== repositoryAdapterPlans.length) {
    failures.push("Repository adapter plan contains duplicate repository ports.");
  }

  for (const planEntry of repositoryAdapterPlans) {
    if (planEntry.storeOfRecord !== "postgresql_source") {
      failures.push(`${planEntry.repositoryPort} must use PostgreSQL as source of truth.`);
    }

    if (
      !planEntry.allowedOperations.includes("load") ||
      !planEntry.allowedOperations.includes("save")
    ) {
      failures.push(`${planEntry.repositoryPort} must include load and save operations.`);
    }
  }

  return Object.freeze(failures);
}

function plan(
  input: Omit<RepositoryAdapterPlan, "storeOfRecord" | "forbiddenData">,
): RepositoryAdapterPlan {
  return Object.freeze({
    ...input,
    storeOfRecord: "postgresql_source",
    allowedOperations: Object.freeze([...input.allowedOperations]),
    forbiddenData: Object.freeze([...sharedForbiddenData]),
    traceability: Object.freeze({
      applicationRefs: Object.freeze([...input.traceability.applicationRefs]),
      apiResources: Object.freeze([...input.traceability.apiResources]),
      productCapability: input.traceability.productCapability,
    }),
  });
}
