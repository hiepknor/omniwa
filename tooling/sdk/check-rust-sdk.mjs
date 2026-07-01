import { access, readFile } from "node:fs/promises";

const projectRoot = new URL("../../", import.meta.url);
const specPath = new URL("docs/api/openapi/omniwa-v1.openapi.json", projectRoot);
const generatedOperationsPath = new URL(
  "sdk/rust/omniwa-sdk/src/generated/operations.rs",
  projectRoot,
);

const requiredFiles = Object.freeze([
  "sdk/rust/omniwa-sdk/Cargo.toml",
  "Cargo.toml",
  "Cargo.lock",
  "sdk/rust/omniwa-sdk/README.md",
  "sdk/rust/omniwa-sdk/src/lib.rs",
  "sdk/rust/omniwa-sdk/src/auth.rs",
  "sdk/rust/omniwa-sdk/src/client.rs",
  "sdk/rust/omniwa-sdk/src/error.rs",
  "sdk/rust/omniwa-sdk/src/idempotency.rs",
  "sdk/rust/omniwa-sdk/src/models.rs",
  "sdk/rust/omniwa-sdk/src/pagination.rs",
  "sdk/rust/omniwa-sdk/src/platform_clients.rs",
  "sdk/rust/omniwa-sdk/src/streaming.rs",
  "sdk/rust/omniwa-sdk/src/transport.rs",
  "sdk/rust/omniwa-sdk/src/generated/mod.rs",
  "sdk/rust/omniwa-sdk/src/generated/operations.rs",
  "sdk/rust/omniwa-sdk/src/resources/mod.rs",
  "sdk/rust/omniwa-sdk/src/resources/chats.rs",
  "sdk/rust/omniwa-sdk/src/resources/contacts.rs",
  "sdk/rust/omniwa-sdk/src/resources/dashboard.rs",
  "sdk/rust/omniwa-sdk/src/resources/events.rs",
  "sdk/rust/omniwa-sdk/src/resources/groups.rs",
  "sdk/rust/omniwa-sdk/src/resources/health.rs",
  "sdk/rust/omniwa-sdk/src/resources/instances.rs",
  "sdk/rust/omniwa-sdk/src/resources/jobs.rs",
  "sdk/rust/omniwa-sdk/src/resources/labels.rs",
  "sdk/rust/omniwa-sdk/src/resources/messages.rs",
  "sdk/rust/omniwa-sdk/src/resources/webhooks.rs",
  "sdk/rust/omniwa-sdk/tests/fixture_client.rs",
  "sdk/rust/omniwa-sdk/tests/http_transport.rs",
  "sdk/rust/omniwa-sdk/tests/platform_clients.rs",
]);

const findings = [];

await checkRequiredFiles();
await checkGeneratedOperations();

if (findings.length > 0) {
  console.error("Rust SDK foundation check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log("Rust SDK foundation check passed.");
}

async function checkRequiredFiles() {
  for (const file of requiredFiles) {
    try {
      await access(new URL(file, projectRoot));
    } catch {
      findings.push(`Missing SDK foundation file: ${file}`);
    }
  }
}

async function checkGeneratedOperations() {
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const generated = await readFile(generatedOperationsPath, "utf8");
  const expected = collectOperations(spec);
  const actual = collectGeneratedOperations(generated);

  for (const operation of expected) {
    const generatedOperation = actual.get(operation.operationId);

    if (generatedOperation === undefined) {
      findings.push(`Generated operations missing ${operation.operationId}.`);
      continue;
    }

    if (
      generatedOperation.method !== operation.method ||
      generatedOperation.path !== operation.path
    ) {
      findings.push(
        `Generated operation mismatch for ${operation.operationId}: expected ${operation.method} ${operation.path}, got ${generatedOperation.method} ${generatedOperation.path}.`,
      );
    }
  }

  for (const operationId of actual.keys()) {
    if (!expected.some((operation) => operation.operationId === operationId)) {
      findings.push(`Generated operations contain stale operation ${operationId}.`);
    }
  }
}

function collectOperations(openApiSpec) {
  const operations = [];

  for (const [path, pathItem] of Object.entries(openApiSpec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "patch", "delete", "put"].includes(method)) {
        continue;
      }

      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
      });
    }
  }

  return operations;
}

function collectGeneratedOperations(content) {
  const operations = new Map();
  const operationPattern =
    /operation_id:\s*"([^"]+)",\n\s*method:\s*"([^"]+)",\n\s*path:\s*"([^"]+)"/gu;
  let match;

  while ((match = operationPattern.exec(content)) !== null) {
    operations.set(match[1], {
      method: match[2],
      path: match[3],
    });
  }

  return operations;
}
