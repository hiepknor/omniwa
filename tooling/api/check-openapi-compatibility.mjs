import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const defaultSpecPath = fileURLToPath(
  new URL("../../docs/api/openapi/omniwa-v1.openapi.json", import.meta.url),
);
export const defaultBaselinePath = fileURLToPath(
  new URL("../../docs/api/openapi/omniwa-v1.compatibility.json", import.meta.url),
);

const httpMethods = Object.freeze(["get", "post", "put", "patch", "delete"]);

export async function evaluateOpenApiCompatibility(options = {}) {
  const specPath = options.specPath ?? defaultSpecPath;
  const baselinePath = options.baselinePath ?? defaultBaselinePath;
  const openApiSpec = options.openApiSpec ?? (await readJson(specPath));
  const baseline = options.baseline ?? (await readJson(baselinePath));

  return evaluateOpenApiCompatibilityFromDocuments(openApiSpec, baseline);
}

export function evaluateOpenApiCompatibilityFromDocuments(openApiSpec, baseline) {
  const findings = [];
  const currentBaseline = createOpenApiCompatibilityBaseline(openApiSpec);

  if (!isRecord(baseline)) {
    return Object.freeze({
      status: "failed",
      findings: Object.freeze([
        createFinding("baseline_invalid", "Compatibility baseline must be a JSON object."),
      ]),
    });
  }

  compareOperations(baseline.operations, currentBaseline.operations, findings);
  compareSchemas(baseline.schemas, currentBaseline.schemas, findings);
  checkDeprecationMetadata(currentBaseline.operations, findings);

  return Object.freeze({
    status: findings.length === 0 ? "passed" : "failed",
    findings: Object.freeze(findings),
  });
}

export function createOpenApiCompatibilityBaseline(openApiSpec) {
  return Object.freeze({
    schemaVersion: 1,
    contract: "omniwa-public-rest-api",
    source: "docs/api/openapi/omniwa-v1.openapi.json",
    openapi: typeof openApiSpec?.openapi === "string" ? openApiSpec.openapi : "unknown",
    apiVersion:
      typeof openApiSpec?.info?.version === "string" ? openApiSpec.info.version : "unknown",
    operations: Object.freeze(collectOperations(openApiSpec)),
    schemas: Object.freeze(collectSchemas(openApiSpec)),
  });
}

function compareOperations(baselineOperations, currentOperations, findings) {
  if (!Array.isArray(baselineOperations)) {
    findings.push(
      createFinding("baseline_operations_invalid", "Baseline operations must be an array."),
    );
    return;
  }

  const currentByKey = new Map(currentOperations.map((operation) => [operation.key, operation]));

  for (const baselineOperation of baselineOperations) {
    const currentOperation = currentByKey.get(baselineOperation.key);

    if (currentOperation === undefined) {
      findings.push(
        createFinding(
          "operation_removed",
          `${baselineOperation.method.toUpperCase()} ${baselineOperation.path} was removed from the public contract.`,
          baselineOperation.key,
        ),
      );
      continue;
    }

    compareOperation(baselineOperation, currentOperation, findings);
  }
}

function compareOperation(baselineOperation, currentOperation, findings) {
  if (baselineOperation.operationId !== currentOperation.operationId) {
    findings.push(
      createFinding(
        "operation_id_changed",
        `${baselineOperation.key} changed operationId from ${baselineOperation.operationId} to ${currentOperation.operationId}.`,
        baselineOperation.key,
      ),
    );
  }

  compareParameters(baselineOperation, currentOperation, findings);
  compareRequestBody(baselineOperation, currentOperation, findings);
  compareResponses(baselineOperation, currentOperation, findings);
}

function compareParameters(baselineOperation, currentOperation, findings) {
  const currentParameters = new Map(
    currentOperation.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const baselineParameterIds = new Set(
    baselineOperation.parameters.map((parameter) => parameter.id),
  );

  for (const parameter of baselineOperation.parameters) {
    const currentParameter = currentParameters.get(parameter.id);

    if (currentParameter === undefined) {
      findings.push(
        createFinding(
          "parameter_removed",
          `${baselineOperation.key} removed public parameter ${parameter.id}.`,
          baselineOperation.key,
        ),
      );
      continue;
    }

    if (parameter.required === false && currentParameter.required === true) {
      findings.push(
        createFinding(
          "parameter_became_required",
          `${baselineOperation.key} made optional parameter ${parameter.id} required.`,
          baselineOperation.key,
        ),
      );
    }
  }

  for (const parameter of currentOperation.parameters) {
    if (!baselineParameterIds.has(parameter.id) && parameter.required === true) {
      findings.push(
        createFinding(
          "required_parameter_added",
          `${baselineOperation.key} added required public parameter ${parameter.id}.`,
          baselineOperation.key,
        ),
      );
    }
  }
}

function compareRequestBody(baselineOperation, currentOperation, findings) {
  if (
    baselineOperation.requestBody === undefined &&
    currentOperation.requestBody?.required === true
  ) {
    findings.push(
      createFinding(
        "required_request_body_added",
        `${baselineOperation.key} added a required request body.`,
        baselineOperation.key,
      ),
    );
    return;
  }

  if (baselineOperation.requestBody !== undefined && currentOperation.requestBody === undefined) {
    findings.push(
      createFinding(
        "request_body_removed",
        `${baselineOperation.key} removed request body ${baselineOperation.requestBody.id}.`,
        baselineOperation.key,
      ),
    );
    return;
  }

  if (
    baselineOperation.requestBody !== undefined &&
    currentOperation.requestBody !== undefined &&
    baselineOperation.requestBody.id !== currentOperation.requestBody.id
  ) {
    findings.push(
      createFinding(
        "request_body_changed",
        `${baselineOperation.key} changed request body from ${baselineOperation.requestBody.id} to ${currentOperation.requestBody.id}.`,
        baselineOperation.key,
      ),
    );
  }

  if (
    baselineOperation.requestBody?.required === false &&
    currentOperation.requestBody?.required === true
  ) {
    findings.push(
      createFinding(
        "request_body_became_required",
        `${baselineOperation.key} made an optional request body required.`,
        baselineOperation.key,
      ),
    );
  }
}

function compareResponses(baselineOperation, currentOperation, findings) {
  const currentResponses = currentOperation.responses;

  for (const [statusCode, responseId] of Object.entries(baselineOperation.responses)) {
    const currentResponseId = currentResponses[statusCode];

    if (currentResponseId === undefined) {
      if (statusCode === "501" && hasSuccessResponse(currentResponses)) {
        continue;
      }

      findings.push(
        createFinding(
          "response_removed",
          `${baselineOperation.key} removed public response ${statusCode}.`,
          baselineOperation.key,
        ),
      );
      continue;
    }

    if (responseId !== currentResponseId) {
      findings.push(
        createFinding(
          "response_changed",
          `${baselineOperation.key} changed response ${statusCode} from ${responseId} to ${currentResponseId}.`,
          baselineOperation.key,
        ),
      );
    }
  }
}

function compareSchemas(baselineSchemas, currentSchemas, findings) {
  if (!isRecord(baselineSchemas)) {
    findings.push(createFinding("baseline_schemas_invalid", "Baseline schemas must be an object."));
    return;
  }

  for (const [schemaName, baselineSchema] of Object.entries(baselineSchemas)) {
    const currentSchema = currentSchemas[schemaName];

    if (!isRecord(currentSchema)) {
      findings.push(
        createFinding(
          "schema_removed",
          `Public schema ${schemaName} was removed from the OpenAPI contract.`,
          schemaName,
        ),
      );
      continue;
    }

    compareSchema(schemaName, baselineSchema, currentSchema, findings);
  }
}

function compareSchema(schemaName, baselineSchema, currentSchema, findings) {
  for (const propertyName of baselineSchema.properties) {
    if (!currentSchema.properties.includes(propertyName)) {
      findings.push(
        createFinding(
          "schema_property_removed",
          `Public schema ${schemaName} removed property ${propertyName}.`,
          schemaName,
        ),
      );
    }
  }

  for (const requiredProperty of baselineSchema.required) {
    if (!currentSchema.required.includes(requiredProperty)) {
      findings.push(
        createFinding(
          "schema_required_property_removed",
          `Public schema ${schemaName} no longer requires ${requiredProperty}.`,
          schemaName,
        ),
      );
    }
  }

  for (const enumValue of baselineSchema.enumValues) {
    if (!currentSchema.enumValues.includes(enumValue)) {
      findings.push(
        createFinding(
          "schema_enum_value_removed",
          `Public schema ${schemaName} removed enum value ${enumValue}.`,
          schemaName,
        ),
      );
    }
  }
}

function checkDeprecationMetadata(operations, findings) {
  for (const operation of operations) {
    if (operation.deprecated !== true) {
      continue;
    }

    const deprecation = operation.deprecation;

    if (!isRecord(deprecation)) {
      findings.push(
        createFinding(
          "deprecation_metadata_missing",
          `${operation.key} is deprecated without x-omniwa-deprecation metadata.`,
          operation.key,
        ),
      );
      continue;
    }

    for (const field of ["since", "removalVersion", "replacement", "changelog"]) {
      if (typeof deprecation[field] !== "string" || deprecation[field].trim().length === 0) {
        findings.push(
          createFinding(
            "deprecation_metadata_incomplete",
            `${operation.key} deprecation metadata must include ${field}.`,
            operation.key,
          ),
        );
      }
    }
  }
}

function collectOperations(openApiSpec) {
  const operations = [];

  for (const [path, pathItem] of Object.entries(openApiSpec?.paths ?? {})) {
    if (!isRecord(pathItem)) {
      continue;
    }

    for (const method of httpMethods) {
      const operation = pathItem[method];

      if (!isRecord(operation)) {
        continue;
      }

      operations.push(
        freezeSortedRecord({
          key: `${method.toUpperCase()} ${path}`,
          method,
          path,
          operationId:
            typeof operation.operationId === "string"
              ? operation.operationId
              : "missing_operation_id",
          deprecated: operation.deprecated === true,
          deprecation: operation["x-omniwa-deprecation"],
          parameters: Object.freeze(collectParameters(openApiSpec, operation)),
          requestBody: collectRequestBody(openApiSpec, operation.requestBody),
          responses: freezeSortedRecord(collectResponses(operation.responses)),
        }),
      );
    }
  }

  return operations.sort((left, right) => left.key.localeCompare(right.key));
}

function collectParameters(openApiSpec, operation) {
  const parameters = [];

  for (const parameter of operation.parameters ?? []) {
    if (!isRecord(parameter)) {
      continue;
    }

    const resolved = resolveOpenApiRef(openApiSpec, parameter.$ref);
    const effectiveParameter = resolved ?? parameter;
    const id =
      typeof parameter.$ref === "string"
        ? parameter.$ref
        : `${String(effectiveParameter.in)}:${String(effectiveParameter.name)}`;

    parameters.push(
      freezeSortedRecord({
        id,
        ref: typeof parameter.$ref === "string" ? parameter.$ref : undefined,
        name: typeof effectiveParameter.name === "string" ? effectiveParameter.name : undefined,
        in: typeof effectiveParameter.in === "string" ? effectiveParameter.in : undefined,
        required: effectiveParameter.required === true,
      }),
    );
  }

  return parameters.sort((left, right) => left.id.localeCompare(right.id));
}

function collectRequestBody(openApiSpec, requestBody) {
  if (!isRecord(requestBody)) {
    return undefined;
  }

  const resolved = resolveOpenApiRef(openApiSpec, requestBody.$ref);
  const effectiveRequestBody = resolved ?? requestBody;

  return freezeSortedRecord({
    id: publicObjectId(requestBody),
    required: effectiveRequestBody.required === true,
  });
}

function collectResponses(responses) {
  const collected = {};

  if (!isRecord(responses)) {
    return collected;
  }

  for (const [statusCode, response] of Object.entries(responses)) {
    collected[statusCode] = publicObjectId(response);
  }

  return collected;
}

function collectSchemas(openApiSpec) {
  const schemas = {};

  for (const [schemaName, schema] of Object.entries(openApiSpec?.components?.schemas ?? {})) {
    if (!isRecord(schema)) {
      continue;
    }

    schemas[schemaName] = freezeSortedRecord({
      properties: Object.freeze(Object.keys(schema.properties ?? {}).sort()),
      required: Object.freeze(Array.isArray(schema.required) ? [...schema.required].sort() : []),
      enumValues: Object.freeze(Array.isArray(schema.enum) ? [...schema.enum].sort() : []),
    });
  }

  return freezeSortedRecord(schemas);
}

function publicObjectId(value) {
  if (!isRecord(value)) {
    return "inline:unknown";
  }

  if (typeof value.$ref === "string") {
    return value.$ref;
  }

  if (isRecord(value.content)) {
    return `content:${Object.keys(value.content).sort().join(",")}`;
  }

  return `inline:${Object.keys(value).sort().join(",")}`;
}

function resolveOpenApiRef(openApiSpec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return undefined;
  }

  return ref
    .slice(2)
    .split("/")
    .reduce((current, segment) => (isRecord(current) ? current[segment] : undefined), openApiSpec);
}

function hasSuccessResponse(responses) {
  return Object.keys(responses).some((statusCode) => /^2\d\d$/u.test(statusCode));
}

function createFinding(code, message, target) {
  return Object.freeze({
    code,
    message,
    ...(typeof target === "string" ? { target } : {}),
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function freezeSortedRecord(record) {
  const sorted = {};

  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) {
      sorted[key] = record[key];
    }
  }

  return Object.freeze(sorted);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--update-baseline")) {
    const openApiSpec = await readJson(defaultSpecPath);
    const baseline = createOpenApiCompatibilityBaseline(openApiSpec);
    await writeJson(defaultBaselinePath, baseline);
    console.log(`OpenAPI compatibility baseline updated: ${defaultBaselinePath}`);
    return;
  }

  const report = await evaluateOpenApiCompatibility();

  if (report.status === "passed") {
    console.log("OpenAPI compatibility check passed.");
    return;
  }

  console.error("OpenAPI compatibility check failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.code}${target}: ${finding.message}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
