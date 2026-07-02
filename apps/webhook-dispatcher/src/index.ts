import { pathToFileURL } from "node:url";

export * from "./runtime-composition.js";
export * from "./webhook-dispatcher-app.js";
export * from "./webhook-dispatcher-loop.js";

import { createWebhookDispatcherRuntimeComposition } from "./runtime-composition.js";
import {
  WebhookDispatcherLoop,
  readWebhookDispatcherLoopIntervalMilliseconds,
} from "./webhook-dispatcher-loop.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const composition = createWebhookDispatcherRuntimeComposition();
  const loop = new WebhookDispatcherLoop({
    app: composition.app,
    queueProvider: composition.queueProvider,
    intervalMilliseconds: readWebhookDispatcherLoopIntervalMilliseconds(),
    onError: (error) => {
      console.error(
        JSON.stringify({
          runtime: "webhook-dispatcher",
          level: "error",
          code: "webhook_dispatcher_loop_tick_failed",
          errorName: error instanceof Error ? error.name : "unknown",
        }),
      );
    },
  });

  const stop = (signal: NodeJS.Signals) => {
    void loop.stop().finally(() => {
      console.log(
        JSON.stringify({
          runtime: "webhook-dispatcher",
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
      runtime: "webhook-dispatcher",
      status: "started",
      profile: composition.profile,
      repositoryProfile: composition.repositoryProfile,
      intervalMilliseconds: loop.snapshot().intervalMilliseconds,
    }),
  );
}
