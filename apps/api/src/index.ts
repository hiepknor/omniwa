import { pathToFileURL } from "node:url";

export * from "./http-server.js";

import { createApiHttpServer } from "./http-server.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.OMNIWA_API_PORT ?? "3000", 10);
  const host = process.env.OMNIWA_API_HOST ?? "127.0.0.1";
  const server = createApiHttpServer();

  server.listen(port, host, () => {
    console.log(`OmniWA API listening on http://${host}:${port}`);
  });
}
