import {
  isSessionSendCapable,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type Session,
  type SessionId,
  type SessionRepositoryPort,
} from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
} from "../ports/application-port.js";

export type ActiveSessionResolution = Readonly<{
  instance: Instance;
  session: Session;
  sessionId: SessionId;
}>;

export type ActiveSessionResolverOptions = Readonly<{
  instanceRepository: Pick<InstanceRepositoryPort, "load" | "getCurrentSessionId">;
  sessionRepository: Pick<SessionRepositoryPort, "load">;
}>;

export type ActiveSessionResolver = Readonly<{
  resolveActiveSession(
    instanceId: InstanceId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ActiveSessionResolution>>;
}>;

export function createActiveSessionResolver(
  options: ActiveSessionResolverOptions,
): ActiveSessionResolver {
  return new DefaultActiveSessionResolver(options);
}

export class DefaultActiveSessionResolver implements ActiveSessionResolver {
  private readonly instanceRepository: Pick<InstanceRepositoryPort, "load" | "getCurrentSessionId">;
  private readonly sessionRepository: Pick<SessionRepositoryPort, "load">;

  constructor(options: ActiveSessionResolverOptions) {
    this.instanceRepository = options.instanceRepository;
    this.sessionRepository = options.sessionRepository;
  }

  async resolveActiveSession(
    instanceId: InstanceId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ActiveSessionResolution>> {
    void context;

    try {
      const instance = await this.instanceRepository.load(instanceId);

      if (instance === undefined) {
        return err(
          createActiveSessionFailure({
            code: "active_session_instance_not_found",
            message: "Instance is not available for an active session.",
            safeMetadata: { instanceId: String(instanceId) },
          }),
        );
      }

      if (instance.status !== "connected") {
        return err(
          createActiveSessionFailure({
            code: "active_session_instance_not_connected",
            message: "Instance is not connected.",
            safeMetadata: {
              instanceId: String(instanceId),
              instanceStatus: instance.status,
            },
          }),
        );
      }

      const sessionId =
        instance.currentSessionId ??
        (await this.instanceRepository.getCurrentSessionId(instanceId));

      if (sessionId === undefined) {
        return err(
          createActiveSessionFailure({
            code: "active_session_not_found",
            message: "Active session is not available.",
            safeMetadata: { instanceId: String(instanceId) },
          }),
        );
      }

      const session = await this.sessionRepository.load(sessionId);

      if (session === undefined) {
        return err(
          createActiveSessionFailure({
            code: "active_session_not_found",
            message: "Active session is not available.",
            safeMetadata: {
              instanceId: String(instanceId),
              sessionId: String(sessionId),
            },
          }),
        );
      }

      if (String(session.instanceId) !== String(instance.id)) {
        return err(
          createActiveSessionFailure({
            code: "active_session_stale",
            message: "Active session does not belong to the requested instance.",
            safeMetadata: {
              instanceId: String(instanceId),
              sessionId: String(sessionId),
            },
          }),
        );
      }

      if (!isSessionSendCapable(session)) {
        return err(
          createActiveSessionFailure({
            code: "active_session_not_usable",
            message: "Active session is not usable for outbound messaging.",
            safeMetadata: {
              instanceId: String(instanceId),
              sessionId: String(sessionId),
              sessionStatus: session.status,
            },
          }),
        );
      }

      return ok(
        Object.freeze({
          instance,
          session,
          sessionId,
        }),
      );
    } catch {
      return err(
        createApplicationPortFailure({
          category: "unavailable",
          code: "active_session_dependency_failure",
          message: "Active session dependencies are unavailable.",
          retryable: true,
          ownerContext: "session",
          failureCategory: "session",
          safeMetadata: { instanceId: String(instanceId) },
        }),
      );
    }
  }
}

function createActiveSessionFailure(
  input: Readonly<{
    code: string;
    message: string;
    safeMetadata: NonNullable<ApplicationPortFailure["safeMetadata"]>;
  }>,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: "rejected",
    code: input.code,
    message: input.message,
    retryable: false,
    ownerContext: "session",
    failureCategory: "session",
    safeMetadata: input.safeMetadata,
  });
}
