import { pathToFileURL } from "node:url";

import { createBackgroundRuntimeComposition } from "./runtime-composition.js";

export * from "./backup-restore-drill.js";
export * from "./background-jobs.js";
export * from "./event-outbox-runtime-loop.js";
export * from "./local-vertical-slice-demo.js";
export * from "./recovery-validation.js";
export * from "./runtime-composition.js";

async function main(): Promise<void> {
  const composition = createBackgroundRuntimeComposition();
  const shutdown = async () => {
    await composition.loop.stop();
    await composition.dispose?.();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  composition.loop.start();
  console.log(
    JSON.stringify({
      status: "started",
      runtime: "background",
      profile: composition.profile,
      eventLogBackend: composition.eventLogBackend,
      intervalMilliseconds: composition.loop.snapshot().intervalMilliseconds,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "failed",
        runtime: "background",
        reasonCode: "background_runtime_start_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    process.exitCode = 1;
  }
}
