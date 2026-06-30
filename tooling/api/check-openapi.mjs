import { readFile } from "node:fs/promises";

const specPath = new URL("../../docs/api/openapi/omniwa-v1.openapi.json", import.meta.url);

const expectedOperations = Object.freeze([
  ["get", "/v1/health"],
  ["get", "/v1/health/readiness"],
  ["get", "/v1/action-required"],
  ["get", "/v1/metrics"],
  ["get", "/v1/metrics/queue"],
  ["get", "/v1/metrics/messages"],
  ["get", "/v1/metrics/webhooks"],
  ["get", "/v1/metrics/media"],
  ["get", "/v1/queue"],
  ["get", "/v1/instances"],
  ["post", "/v1/instances"],
  ["get", "/v1/instances/{instanceId}"],
  ["patch", "/v1/instances/{instanceId}"],
  ["delete", "/v1/instances/{instanceId}"],
  ["post", "/v1/instances/{instanceId}/connect"],
  ["post", "/v1/instances/{instanceId}/disconnect"],
  ["post", "/v1/instances/{instanceId}/qr/refresh"],
  ["post", "/v1/instances/{instanceId}/reconnect"],
  ["get", "/v1/instances/{instanceId}/sessions"],
  ["get", "/v1/instances/{instanceId}/messages"],
  ["post", "/v1/instances/{instanceId}/messages"],
  ["post", "/v1/instances/{instanceId}/messages/text"],
  ["post", "/v1/instances/{instanceId}/messages/media"],
  ["get", "/v1/messages/{messageId}"],
  ["get", "/v1/messages/{messageId}/delivery-history"],
  ["post", "/v1/messages/{messageId}/retry"],
  ["post", "/v1/messages/{messageId}/cancel"],
  ["post", "/v1/media"],
  ["get", "/v1/media/{mediaId}"],
  ["get", "/v1/jobs"],
  ["get", "/v1/jobs/{jobId}"],
  ["get", "/v1/webhooks"],
  ["post", "/v1/webhooks"],
  ["get", "/v1/webhooks/{webhookId}"],
  ["patch", "/v1/webhooks/{webhookId}"],
  ["delete", "/v1/webhooks/{webhookId}"],
  ["post", "/v1/webhooks/{webhookId}/activate"],
  ["post", "/v1/webhooks/{webhookId}/suspend"],
  ["get", "/v1/webhook-deliveries"],
  ["get", "/v1/webhook-deliveries/{deliveryId}/history"],
  ["post", "/v1/webhook-deliveries/{deliveryId}/retry"],
  ["get", "/v1/provider/capabilities"],
  ["post", "/v1/provider/capabilities/refresh"],
  ["get", "/v1/settings"],
  ["post", "/v1/settings/validate"],
  ["post", "/v1/settings/activate"],
  ["get", "/v1/audit-records"],
]);

const internalApplicationNames = Object.freeze([
  "GetHealthStatus",
  "GetActionRequiredItems",
  "GetOperationalMetricsSnapshot",
  "GetQueueMetricsSnapshot",
  "GetMessageMetricsSnapshot",
  "GetWebhookMetricsSnapshot",
  "GetMediaMetricsSnapshot",
  "ListInstances",
  "CreateInstance",
  "GetInstanceStatus",
  "UpdateInstanceMetadata",
  "DestroyInstance",
  "ConnectInstance",
  "DisconnectInstance",
  "RefreshQrPairing",
  "SendTextMessage",
  "SendMediaMessage",
  "GetMessageStatus",
  "GetMessageDeliveryHistory",
  "RetryMessageSend",
  "CancelMessage",
  "RegisterMedia",
  "GetMediaStatus",
  "GetWorkerJobStatus",
  "RegisterWebhookSubscription",
  "GetWebhookStatus",
  "UpdateWebhookSubscription",
  "ActivateWebhookSubscription",
  "SuspendWebhookSubscription",
  "RetireWebhookSubscription",
  "GetWebhookDeliveryHistory",
  "RetryWebhookDelivery",
  "GetProviderCapabilityStatus",
  "GetConfigurationStatus",
  "ValidateConfigurationSnapshot",
  "ActivateConfigurationSnapshot",
  "QueryAuditRecords",
]);

const findings = [];
const spec = JSON.parse(await readFile(specPath, "utf8"));

checkOpenApiShape(spec);
checkSecurityScheme(spec);
checkRequiredSchemas(spec);
checkRouteCoverage(spec);
checkOperationIds(spec);
checkResponses(spec);
checkPaginationContract(spec);

if (findings.length > 0) {
  console.error("OpenAPI contract check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(`OpenAPI check passed for ${expectedOperations.length} operations.`);
}

function checkOpenApiShape(openApiSpec) {
  if (!isRecord(openApiSpec)) {
    findings.push("OpenAPI document must be a JSON object.");
    return;
  }

  if (typeof openApiSpec.openapi !== "string" || !openApiSpec.openapi.startsWith("3.")) {
    findings.push("OpenAPI document must use OpenAPI 3.x.");
  }

  if (!isRecord(openApiSpec.paths)) {
    findings.push("OpenAPI document must define paths.");
  }

  if (!isRecord(openApiSpec.components)) {
    findings.push("OpenAPI document must define components.");
  }
}

function checkSecurityScheme(openApiSpec) {
  const securityScheme = openApiSpec.components?.securitySchemes?.ApiKeyAuth;

  if (!isRecord(securityScheme)) {
    findings.push("components.securitySchemes.ApiKeyAuth is required.");
    return;
  }

  if (
    securityScheme.type !== "apiKey" ||
    securityScheme.in !== "header" ||
    securityScheme.name !== "x-api-key"
  ) {
    findings.push("ApiKeyAuth must be an apiKey header scheme named x-api-key.");
  }
}

function checkRequiredSchemas(openApiSpec) {
  for (const schemaName of [
    "SuccessEnvelope",
    "CollectionEnvelope",
    "ErrorEnvelope",
    "ResponseMeta",
    "ApiError",
    "PaginationMeta",
  ]) {
    if (!isRecord(openApiSpec.components?.schemas?.[schemaName])) {
      findings.push(`Missing required schema: ${schemaName}.`);
    }
  }
}

function checkRouteCoverage(openApiSpec) {
  for (const [method, path] of expectedOperations) {
    if (!isRecord(openApiSpec.paths?.[path]?.[method])) {
      findings.push(`Missing operation: ${method.toUpperCase()} ${path}.`);
    }
  }
}

function checkOperationIds(openApiSpec) {
  const seen = new Set();

  for (const [method, path] of expectedOperations) {
    const operation = openApiSpec.paths?.[path]?.[method];

    if (!isRecord(operation)) {
      continue;
    }

    if (typeof operation.operationId !== "string" || operation.operationId.length === 0) {
      findings.push(`Missing operationId: ${method.toUpperCase()} ${path}.`);
      continue;
    }

    if (seen.has(operation.operationId)) {
      findings.push(`Duplicate operationId: ${operation.operationId}.`);
    }

    seen.add(operation.operationId);

    if (internalApplicationNames.includes(operation.operationId)) {
      findings.push(
        `operationId must not expose internal Application name: ${operation.operationId}.`,
      );
    }
  }
}

function checkResponses(openApiSpec) {
  for (const [method, path] of expectedOperations) {
    const operation = openApiSpec.paths?.[path]?.[method];

    if (!isRecord(operation)) {
      continue;
    }

    if (!isRecord(operation.responses)) {
      findings.push(`Missing responses: ${method.toUpperCase()} ${path}.`);
      continue;
    }

    if (!hasSuccessOrReservedResponse(operation.responses)) {
      findings.push(`Operation needs a 2xx or 501 response: ${method.toUpperCase()} ${path}.`);
    }

    if (!isRecord(operation.responses["401"])) {
      findings.push(`Operation needs 401 auth response: ${method.toUpperCase()} ${path}.`);
    }
  }
}

function checkPaginationContract(openApiSpec) {
  for (const parameterName of ["Cursor", "Limit", "Sort"]) {
    if (!isRecord(openApiSpec.components?.parameters?.[parameterName])) {
      findings.push(`Missing pagination/filter parameter: ${parameterName}.`);
    }
  }
}

function hasSuccessOrReservedResponse(responses) {
  return Object.keys(responses).some(
    (statusCode) => /^2\d\d$/u.test(statusCode) || statusCode === "501",
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
