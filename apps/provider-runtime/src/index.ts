import { pathToFileURL } from "node:url";

import {
  createProviderRuntimeComposition,
  createProviderRuntimeCompositionContext,
} from "./runtime-composition.js";

export * from "./provider-runtime.js";
export * from "./provider-runtime-app.js";
export * from "./provider-runtime-supervisor.js";
export * from "./runtime-composition.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const composition = createProviderRuntimeComposition();
    const loop = composition.startDrainLoop(createProviderRuntimeCompositionContext());

    const stop = (signal: NodeJS.Signals): void => {
      loop.shutdown();
      console.log(
        JSON.stringify(
          {
            runtime: "provider",
            status: "stopped",
            signal,
          },
          null,
          2,
        ),
      );
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    console.log(
      JSON.stringify(
        {
          runtime: "provider",
          status: "started",
          profile: composition.profile,
          stateDirectory: composition.paths.stateDirectory,
          eventLogPath: composition.paths.eventLogPath,
          authStatePath: composition.paths.authStatePath,
          drainIntervalMilliseconds: loop.intervalMilliseconds,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          runtime: "provider",
          status: "failed",
          code: "provider_runtime_start_failed",
          errorName: error instanceof Error ? error.name : "unknown",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
