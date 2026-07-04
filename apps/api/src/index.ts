import { pathToFileURL } from "node:url";

import { EnvSecretProvider } from "@omniwa/infrastructure-secrets";

export * from "./http-server.js";
export * from "./api-key-auth.js";
export * from "./api-key-lifecycle.js";
export * from "./api-rate-limit-metrics.js";
export * from "./api-security-audit.js";
export * from "./realtime-event-stream.js";
export * from "./runtime-composition.js";

import { createApiHttpServer } from "./http-server.js";
import {
  createApiRuntimeCompositionFromSecrets,
  type ApiRuntimeComposition,
} from "./runtime-composition.js";

export function createApiRuntimeCompositionForProcess(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApiRuntimeComposition> {
  return createApiRuntimeCompositionFromSecrets(env, {
    secretProvider: new EnvSecretProvider({ env }),
  });
}

async function startApiRuntimeServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const port = Number.parseInt(env.OMNIWA_API_PORT ?? "3000", 10);
  const host = env.OMNIWA_API_HOST ?? "127.0.0.1";
  const composition = await createApiRuntimeCompositionForProcess(env);
  const server = createApiHttpServer(composition.options);

  server.listen(port, host, () => {
    console.log(`OmniWA API listening on http://${host}:${port} (${composition.profile})`);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startApiRuntimeServer().catch((error: unknown) => {
    console.error("OmniWA API failed to start.");
    console.error(error instanceof Error ? error.message : "Unknown startup error.");
    process.exitCode = 1;
  });
}
