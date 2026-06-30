import type { InstanceId, SessionId } from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export type SessionSecretHandle = Readonly<{
  sessionId: SessionId;
  instanceId: InstanceId;
  secretRef: string;
  dataClassification: "secret";
}>;

export type SessionSecretRegistration = Readonly<{
  sessionId: SessionId;
  instanceId: InstanceId;
  sourceSecretRef: string;
  rotationReasonCode?: string;
}>;

export interface SessionStorePort {
  registerSessionSecret(
    registration: SessionSecretRegistration,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<SessionSecretHandle>>;

  loadSessionHandle(
    sessionId: SessionId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<SessionSecretHandle | undefined>>;

  rotateSessionSecret(
    registration: SessionSecretRegistration,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<SessionSecretHandle>>;

  revokeSessionSecret(
    sessionId: SessionId,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<void>>;
}
