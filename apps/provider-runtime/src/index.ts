import { pathToFileURL } from "node:url";

export * from "./provider-runtime.js";
export * from "./provider-runtime-app.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    JSON.stringify(
      {
        runtime: "provider",
        status: "ready",
        composition: "requires MessagingProviderPort and SecretProvider",
      },
      null,
      2,
    ),
  );
}
