import { pathToFileURL } from "node:url";

export * from "./http-server.js";
export * from "./realtime-event-stream.js";
export * from "./runtime-composition.js";

import { createApiHttpServer } from "./http-server.js";
import { createApiRuntimeComposition } from "./runtime-composition.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.OMNIWA_API_PORT ?? "3000", 10);
  const host = process.env.OMNIWA_API_HOST ?? "127.0.0.1";
  const composition = createApiRuntimeComposition();
  const server = createApiHttpServer(composition.options);

  server.listen(port, host, () => {
    console.log(`OmniWA API listening on http://${host}:${port} (${composition.profile})`);
  });
}
