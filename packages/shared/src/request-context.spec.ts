import { describe, expect, it } from "vitest";

import { createCorrelationId, createRequestContext, createRequestId } from "./request-context.js";

describe("request context primitives", () => {
  it("creates an immutable request context shape", () => {
    const context = createRequestContext({
      correlationId: createCorrelationId("correlation-1"),
      requestId: createRequestId("request-1"),
    });

    expect(context).toEqual({
      correlationId: "correlation-1",
      requestId: "request-1",
    });
  });
});
