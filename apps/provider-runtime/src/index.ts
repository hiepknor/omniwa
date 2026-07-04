import { pathToFileURL } from "node:url";

import {
  createProviderRuntimeComposition,
  createProviderRuntimeCompositionContext,
} from "./runtime-composition.js";
import { startProviderRuntimeLocalLiveSession } from "./local-live-session-starter.js";
import { startProviderRuntimeLocalLiveOutboundWorker } from "./local-live-outbound-worker.js";
import { startProviderRuntimeLocalLiveApiServer } from "./local-live-api-server.js";

export * from "./provider-runtime.js";
export * from "./provider-runtime-app.js";
export * from "./provider-runtime-ownership-guard.js";
export * from "./provider-runtime-supervisor.js";
export * from "./local-qr-operator-output.js";
export * from "./local-inbound-recipient-operator-output.js";
export * from "./local-live-session-starter.js";
export * from "./local-live-outbound-worker.js";
export * from "./local-live-api-server.js";
export * from "./runtime-composition.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runProviderRuntime();
}

async function runProviderRuntime(): Promise<void> {
  try {
    const composition = createProviderRuntimeComposition();
    const context = createProviderRuntimeCompositionContext();
    const loop = composition.startDrainLoop(context);
    const localLiveSession = await startProviderRuntimeLocalLiveSession(
      composition,
      process.env,
      context,
    );
    const localLiveOutboundWorker = await startProviderRuntimeLocalLiveOutboundWorker(
      composition,
      process.env,
      context,
    );
    const localLiveApiServer = await startProviderRuntimeLocalLiveApiServer(
      composition,
      localLiveOutboundWorker.workerComposition,
      process.env,
    );

    const stop = (signal: NodeJS.Signals): void => {
      void localLiveApiServer.stop().finally(() => {
        void localLiveOutboundWorker.stop().finally(() => {
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
        });
      });
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    console.log(
      JSON.stringify(
        {
          runtime: "provider",
          status: "started",
          profile: composition.profile,
          liveMode: composition.liveMode,
          readiness: composition.readiness,
          localQrOutput: composition.localQrOutput,
          localInboundRecipientOutput: composition.localInboundRecipientOutput,
          stateDirectory: composition.paths.stateDirectory,
          eventLogPath: composition.paths.eventLogPath,
          authStatePath: composition.paths.authStatePath,
          drainIntervalMilliseconds: loop.intervalMilliseconds,
          keepsProcessAlive: loop.keepsProcessAlive,
          localLiveSession,
          localLiveOutboundWorker: localLiveOutboundWorker.status,
          localLiveApiServer: localLiveApiServer.status,
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
