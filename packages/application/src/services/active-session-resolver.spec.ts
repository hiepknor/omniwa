import {
  activateSession,
  createInstance,
  createInstanceId,
  createSession,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  markInstanceDisconnected,
  startSessionPairing,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type RepositorySaveResult,
  type Session,
  type SessionId,
  type SessionRepositoryPort,
  type SessionStatus,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  type Result,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import type { ApplicationPortContext, ApplicationPortFailure } from "../ports/application-port.js";
import { createActiveSessionResolver } from "./active-session-resolver.js";

const instanceId = createInstanceId("inst_active_session");
const sessionId = createSessionId("session_active");
const requestContext = createRequestContext({
  requestId: createRequestId("active-session-request"),
  correlationId: createCorrelationId("active-session-correlation"),
});
const applicationContext: ApplicationPortContext = Object.freeze({
  requestContext,
  actorRef: "worker:test",
});

describe("active session resolver", () => {
  it("resolves a connected instance with an active session", async () => {
    const instance = createConnectedInstance(instanceId, sessionId);
    const session = createActiveSession(sessionId, instanceId);
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository([instance]),
      sessionRepository: new FakeSessionRepository([session]),
    });

    const result = await resolver.resolveActiveSession(instanceId, applicationContext);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.instance.id).toBe(instanceId);
      expect(result.value.session.id).toBe(sessionId);
      expect(result.value.sessionId).toBe(sessionId);
    }
  });

  it("fails closed when the instance is missing", async () => {
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository(),
      sessionRepository: new FakeSessionRepository(),
    });

    const result = await resolver.resolveActiveSession(instanceId, applicationContext);

    expect(result).toEqual({
      ok: false,
      error: {
        category: "rejected",
        code: "active_session_instance_not_found",
        message: "Instance is not available for an active session.",
        retryable: false,
        ownerContext: "session",
        failureCategory: "session",
        safeMetadata: Object.freeze({ instanceId: "inst_active_session" }),
      },
    });
  });

  it("fails closed when the active session record is missing", async () => {
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository([
        createConnectedInstance(instanceId, sessionId),
      ]),
      sessionRepository: new FakeSessionRepository(),
    });

    const result = await resolver.resolveActiveSession(instanceId, applicationContext);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("active_session_not_found");
      expect(result.error.safeMetadata).toEqual({
        instanceId: "inst_active_session",
        sessionId: "session_active",
      });
    }
  });

  it("fails closed when the instance is disconnected", async () => {
    const instance = markInstanceDisconnected(createConnectedInstance(instanceId, sessionId));
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository([instance]),
      sessionRepository: new FakeSessionRepository([createActiveSession(sessionId, instanceId)]),
    });

    const result = await resolver.resolveActiveSession(instanceId, applicationContext);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("active_session_instance_not_connected");
      expect(result.error.safeMetadata).toEqual({
        instanceId: "inst_active_session",
        instanceStatus: "disconnected",
      });
    }
  });

  it("fails closed when the session is not active", async () => {
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository([
        createConnectedInstance(instanceId, sessionId),
      ]),
      sessionRepository: new FakeSessionRepository([createPendingSession(sessionId, instanceId)]),
    });

    const result = await resolver.resolveActiveSession(instanceId, applicationContext);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("active_session_not_usable");
      expect(result.error.safeMetadata).toEqual({
        instanceId: "inst_active_session",
        sessionId: "session_active",
        sessionStatus: "pending",
      });
    }
  });

  it("fails closed when the active session is stale", async () => {
    const otherInstanceId = createInstanceId("inst_other");
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository([
        createConnectedInstance(instanceId, sessionId),
      ]),
      sessionRepository: new FakeSessionRepository([
        createActiveSession(sessionId, otherInstanceId),
      ]),
    });

    const result = await resolver.resolveActiveSession(instanceId, applicationContext);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("active_session_stale");
      expect(result.error.safeMetadata).toEqual({
        instanceId: "inst_active_session",
        sessionId: "session_active",
      });
    }
  });

  it("does not call a provider when active session resolution fails", async () => {
    const resolver = createActiveSessionResolver({
      instanceRepository: new FakeInstanceRepository([
        createConnectedInstance(instanceId, sessionId),
      ]),
      sessionRepository: new FakeSessionRepository([createPendingSession(sessionId, instanceId)]),
    });
    const provider = new FakeProvider();

    const result = await dispatchOnlyAfterActiveSession(resolver, provider);

    expect(result.ok).toBe(false);
    expect(provider.sendCalls).toBe(0);
  });
});

function createConnectedInstance(id: InstanceId, currentSessionId: SessionId): Instance {
  return markInstanceConnected(markInstanceConnecting(createInstance(id)), currentSessionId);
}

function createActiveSession(id: SessionId, ownerInstanceId: InstanceId): Session {
  return activateSession(startSessionPairing(createSession(id, ownerInstanceId)));
}

function createPendingSession(id: SessionId, ownerInstanceId: InstanceId): Session {
  return startSessionPairing(createSession(id, ownerInstanceId));
}

async function dispatchOnlyAfterActiveSession(
  resolver: ReturnType<typeof createActiveSessionResolver>,
  provider: FakeProvider,
): Promise<Result<"sent", ApplicationPortFailure>> {
  const resolution = await resolver.resolveActiveSession(instanceId, applicationContext);

  if (!resolution.ok) {
    return resolution;
  }

  provider.sendOutboundMessage();
  return { ok: true, value: "sent" };
}

class FakeProvider {
  sendCalls = 0;

  sendOutboundMessage(): void {
    this.sendCalls += 1;
  }
}

class FakeInstanceRepository implements InstanceRepositoryPort {
  private readonly records = new Map<string, Instance>();

  constructor(initialRecords: readonly Instance[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: InstanceId): Promise<Instance | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Instance): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: InstanceId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: InstanceStatus): Promise<readonly Instance[]> {
    return Promise.resolve(
      [...this.records.values()].filter((instance) => instance.status === status),
    );
  }

  findNonTerminal(): Promise<readonly Instance[]> {
    return Promise.resolve(
      [...this.records.values()].filter((instance) => instance.status !== "destroyed"),
    );
  }

  getCurrentSessionId(id: InstanceId): Promise<SessionId | undefined> {
    return Promise.resolve(this.records.get(String(id))?.currentSessionId);
  }
}

class FakeSessionRepository implements SessionRepositoryPort {
  private readonly records = new Map<string, Session>();

  constructor(initialRecords: readonly Session[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: SessionId): Promise<Session | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Session): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: SessionId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByInstance(ownerInstanceId: InstanceId): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (session) => String(session.instanceId) === String(ownerInstanceId),
      ),
    );
  }

  findByStatusForInstance(
    ownerInstanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (session) =>
          String(session.instanceId) === String(ownerInstanceId) && session.status === status,
      ),
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.records.values()].filter((session) => session.requiresRecovery),
    );
  }
}
