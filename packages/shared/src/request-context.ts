import { createOpaqueString, type OpaqueString } from "./opaque.js";

export type CorrelationId = OpaqueString<"CorrelationId">;
export type RequestId = OpaqueString<"RequestId">;
export type TraceId = OpaqueString<"TraceId">;

export type RequestContext = {
  readonly correlationId: CorrelationId;
  readonly requestId?: RequestId;
  readonly traceId?: TraceId;
};

export function createCorrelationId(value: string): CorrelationId {
  return createOpaqueString(value, "CorrelationId");
}

export function createRequestId(value: string): RequestId {
  return createOpaqueString(value, "RequestId");
}

export function createTraceId(value: string): TraceId {
  return createOpaqueString(value, "TraceId");
}

export function createRequestContext(input: RequestContext): RequestContext {
  return { ...input };
}
