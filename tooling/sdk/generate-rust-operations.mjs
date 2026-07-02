import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const specPath = new URL("../../docs/api/openapi/omniwa-v1.openapi.json", import.meta.url);
const outputPath = new URL(
  "../../sdks/rust/omniwa-sdk/src/generated/operations.rs",
  import.meta.url,
);

const spec = JSON.parse(await readFile(specPath, "utf8"));
const operations = collectOperations(spec);
const content = renderOperations(operations);

await mkdir(dirname(outputPath.pathname), { recursive: true });
await writeFile(outputPath, content);

console.log(`Generated ${operations.length} Rust SDK operations.`);

function collectOperations(openApiSpec) {
  const operations = [];

  for (const [path, pathItem] of Object.entries(openApiSpec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "patch", "delete", "put"].includes(method)) {
        continue;
      }

      if (typeof operation.operationId !== "string" || operation.operationId.length === 0) {
        throw new Error(`Missing operationId for ${method.toUpperCase()} ${path}`);
      }

      operations.push({
        constName: toRustConstName(operation.operationId),
        method: method.toUpperCase(),
        operationId: operation.operationId,
        path,
      });
    }
  }

  operations.sort((left, right) => left.operationId.localeCompare(right.operationId));

  return operations;
}

function renderOperations(operations) {
  const lines = [
    "// Generated from docs/api/openapi/omniwa-v1.openapi.json.",
    "// Do not edit by hand. Run `pnpm sdk:generate`.",
    "",
    "#[derive(Clone, Copy, Debug, Eq, PartialEq)]",
    "pub struct Operation {",
    "    pub operation_id: &'static str,",
    "    pub method: &'static str,",
    "    pub path: &'static str,",
    "}",
    "",
  ];

  for (const operation of operations) {
    lines.push(
      `pub const ${operation.constName}: Operation = Operation {`,
      `    operation_id: ${JSON.stringify(operation.operationId)},`,
      `    method: ${JSON.stringify(operation.method)},`,
      `    path: ${JSON.stringify(operation.path)},`,
      "};",
      "",
    );
  }

  lines.push("pub const ALL_OPERATIONS: &[Operation] = &[");

  for (const operation of operations) {
    lines.push(`    ${operation.constName},`);
  }

  lines.push("];", "", "pub fn operation_by_id(operation_id: &str) -> Option<Operation> {");
  lines.push("    match operation_id {");

  for (const operation of operations) {
    lines.push(`        ${JSON.stringify(operation.operationId)} => Some(${operation.constName}),`);
  }

  lines.push("        _ => None,", "    }", "}");

  return `${lines.join("\n")}\n`;
}

function toRustConstName(operationId) {
  return operationId
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toUpperCase();
}
