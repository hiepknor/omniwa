import { describe, expect, it } from "vitest";

import { classifyValue, toSafeLogFields } from "@omniwa/observability";

import { MemoryLogger } from "./memory-logger.js";

describe("MemoryLogger", () => {
  it("captures safe log entries", () => {
    const logger = new MemoryLogger();

    logger.write({
      level: "info",
      message: "queued",
      fields: toSafeLogFields({
        apiKey: classifyValue("synthetic-api-key", "secret"),
      }),
    });

    expect(logger.entries()).toEqual([
      {
        level: "info",
        message: "queued",
        fields: {
          apiKey: "[redacted:secret]",
        },
      },
    ]);
  });
});
