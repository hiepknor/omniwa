import { pathToFileURL } from "node:url";

export * from "./runtime-composition.js";
export * from "./worker-app.js";
export * from "./worker-application-handlers.js";
export * from "./worker-loop.js";
export * from "./worker-runtime.js";

import { createWorkerRuntimeComposition } from "./runtime-composition.js";
import { WorkerRuntimeLoop, readWorkerLoopIntervalMilliseconds } from "./worker-loop.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const composition = createWorkerRuntimeComposition();
  const loop = new WorkerRuntimeLoop({
    app: composition.app,
    intervalMilliseconds: readWorkerLoopIntervalMilliseconds(),
    onError: (error) => {
      console.error(
        JSON.stringify({
          runtime: "worker",
          level: "error",
          code: "worker_loop_tick_failed",
          errorName: error instanceof Error ? error.name : "unknown",
        }),
      );
    },
  });

  const stop = (signal: NodeJS.Signals) => {
    void loop.stop().finally(() => {
      console.log(
        JSON.stringify({
          runtime: "worker",
          status: "stopped",
          signal,
        }),
      );
      process.exit(0);
    });
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  loop.start();
  console.log(
    JSON.stringify({
      runtime: "worker",
      status: "started",
      profile: composition.profile,
      repositoryProfile: composition.repositoryProfile,
      intervalMilliseconds: loop.snapshot().intervalMilliseconds,
    }),
  );
}
