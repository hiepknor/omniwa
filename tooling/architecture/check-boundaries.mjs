import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const sourceRoots = ["apps", "packages"];
const sourceExtensions = new Set([".ts", ".mts", ".cts"]);

const forbiddenRules = [
  {
    name: "shared-is-policy-neutral",
    appliesTo: (file) => file.startsWith("packages/shared/"),
    forbidden: [/^@omniwa\//],
    message: "Shared must not import any OmniWA package.",
  },
  {
    name: "domain-has-no-outer-dependencies",
    appliesTo: (file) => file.startsWith("packages/domain/"),
    forbidden: [
      /^@omniwa\/application$/,
      /^@omniwa\/interface-api$/,
      /^@omniwa\/infrastructure-/,
      /^@whiskeysockets\/baileys$/,
      /^baileys$/,
    ],
    message:
      "Domain must not import Application, Interface, Infrastructure, or provider libraries.",
  },
  {
    name: "application-uses-ports-not-adapters",
    appliesTo: (file) => file.startsWith("packages/application/"),
    forbidden: [
      /^@omniwa\/interface-api$/,
      /^@omniwa\/infrastructure-/,
      /^@whiskeysockets\/baileys$/,
      /^baileys$/,
    ],
    message:
      "Application must not import Interface, concrete Infrastructure, or provider libraries.",
  },
  {
    name: "api-calls-application-only",
    appliesTo: (file) => file.startsWith("packages/interface-api/"),
    forbidden: [
      /^@omniwa\/domain$/,
      /^@omniwa\/infrastructure-/,
      /^@whiskeysockets\/baileys$/,
      /^baileys$/,
    ],
    message: "Interface API must not bypass Application.",
  },
  {
    name: "infrastructure-does-not-import-interface",
    appliesTo: (file) => file.startsWith("packages/infrastructure-"),
    forbidden: [/^@omniwa\/interface-api$/],
    message: "Infrastructure must not import Interface.",
  },
  {
    name: "testing-is-test-only",
    appliesTo: (file) => !file.startsWith("packages/testing/"),
    forbidden: [/^@omniwa\/testing$/],
    message: "Production code must not import the testing package.",
  },
  {
    name: "baileys-contained-in-provider-adapter",
    appliesTo: (file) => !file.startsWith("packages/infrastructure-provider-baileys/"),
    forbidden: [/^@whiskeysockets\/baileys$/, /^baileys$/],
    message: "Only the Baileys provider adapter may import Baileys.",
  },
];

const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;

const files = [];

for (const root of sourceRoots) {
  await collectFiles(root);
}

const violations = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const specifier of findImports(content)) {
    for (const rule of forbiddenRules) {
      if (!rule.appliesTo(file)) {
        continue;
      }

      if (rule.forbidden.some((pattern) => pattern.test(specifier))) {
        violations.push({
          file,
          import: specifier,
          message: rule.message,
          rule: rule.name,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations found:");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}: ${violation.import} violates ${violation.rule}. ${violation.message}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(`Architecture boundary check passed for ${files.length} source files.`);
}

async function collectFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }
      await collectFiles(path);
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(path.slice(path.lastIndexOf(".")))) {
      files.push(relative(process.cwd(), path));
    }
  }
}

function findImports(content) {
  const imports = [];
  let match;

  while ((match = importPattern.exec(content)) !== null) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      imports.push(specifier);
    }
  }

  return imports;
}
