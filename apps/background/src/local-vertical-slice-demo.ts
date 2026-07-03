import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { ProviderRuntimeSupervisor } from "@omniwa/app-provider-runtime";
import {
  createApplicationCommandEnvelope,
  createApplicationDispatcher,
  createDomainEventPublisher,
  createOutboundMessageIntentRef,
  createProviderSignalIngress,
  type ApplicationCommandOutcome,
  type ApplicationDispatcher,
  type ApplicationPortContext,
  type EventLogPort,
  type PlatformEventRecord,
} from "@omniwa/application";
import {
  WorkerRuntime,
  WorkerRuntimeApp,
  createApplicationWorkerHandlers,
  type WorkerRuntimeTickResult,
} from "@omniwa/app-worker";
import {
  activateSession,
  createInstance,
  createInstanceId,
  createMessageId,
  createProviderId,
  createSession,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  startSessionPairing,
  type InstanceId,
  type MessageId,
  type ProviderId,
  type SessionId,
} from "@omniwa/domain";
import {
  DurableJsonBaileysAuthStateStore,
  FakeBaileysSocket,
  FakeBaileysSocketProvider,
  BaileysMessagingProviderAdapter,
  BaileysSocketGateway,
  OutboundMessageIntentBaileysResolver,
  type BaileysSocketProvider,
} from "@omniwa/infrastructure-provider-baileys";
import {
  DurableJsonOutboundMessageIntentStore,
  createDurableJsonEventLogStore,
  createDurableJsonRepositorySet,
  type DurableJsonRepositorySet,
} from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";

export const localVerticalSliceDemoMode = "local-single-process-demo";

export type LocalVerticalSliceDemoMode = typeof localVerticalSliceDemoMode;

export type LocalVerticalSliceDemoPaths = Readonly<{
  stateDirectory: string;
  eventLogPath: string;
  authStatePath: string;
  outboundIntentPath: string;
}>;

export type LocalVerticalSlicePreparedSession = Readonly<{
  instanceId: InstanceId;
  sessionId: SessionId;
  providerId: ProviderId;
  supervisorState: string;
}>;

export type LocalVerticalSliceQueuedMessage = Readonly<{
  instanceId: InstanceId;
  messageId: MessageId;
  outboundIntentRef: string;
  outcome: ApplicationCommandOutcome;
}>;

export type LocalVerticalSliceRunResult = Readonly<{
  mode: LocalVerticalSliceDemoMode;
  instanceId: InstanceId;
  sessionId: SessionId;
  messageId: MessageId;
  sendOutcome: Pick<
    ApplicationCommandOutcome,
    "outcome" | "accepted" | "retryable" | "reasonCode" | "resultRef"
  >;
  worker: Pick<
    WorkerRuntimeTickResult,
    "attempted" | "completed" | "retried" | "deadLettered" | "failed"
  >;
  messageStatus?: string;
  providerSendCount: number;
  eventTypes: readonly string[];
}>;

export type LocalVerticalSliceDemoOptions = Readonly<{
  stateDirectory?: string;
  socketProvider?: BaileysSocketProvider;
  fakeSocket?: FakeBaileysSocket;
  nowIso?: () => string;
}>;

export type LocalVerticalSlicePrepareInput = Readonly<{
  runRef?: string;
  rawQrPayload?: string;
}>;

export type LocalVerticalSlicePrepareActiveInput = Readonly<{
  runRef?: string;
  instanceId?: InstanceId;
  sessionId?: SessionId;
}>;

export type LocalVerticalSliceSendTextInput = Readonly<{
  instanceId: InstanceId;
  recipientRef: string;
  text: string;
  runRef?: string;
  outboundIntentRef?: string;
}>;

export type LocalVerticalSliceDemoComposition = Readonly<{
  mode: LocalVerticalSliceDemoMode;
  paths: LocalVerticalSliceDemoPaths;
  repositories: DurableJsonRepositorySet;
  eventLog: EventLogPort;
  authStateStore: DurableJsonBaileysAuthStateStore;
  outboundMessageIntentStore: DurableJsonOutboundMessageIntentStore;
  queueProvider: InMemoryQueueProvider;
  socketProvider: BaileysSocketProvider;
  fakeSocket: FakeBaileysSocket;
  providerSupervisor: ProviderRuntimeSupervisor;
  applicationDispatcher: ApplicationDispatcher;
  workerApp: WorkerRuntimeApp;
  prepareActiveSessionState(
    input?: LocalVerticalSlicePrepareActiveInput,
  ): Promise<LocalVerticalSlicePreparedSession>;
  prepareConnectedSession(
    input?: LocalVerticalSlicePrepareInput,
    context?: ApplicationPortContext,
  ): Promise<LocalVerticalSlicePreparedSession>;
  sendTextMessage(
    input: LocalVerticalSliceSendTextInput,
    context?: ApplicationPortContext,
  ): Promise<LocalVerticalSliceQueuedMessage>;
  runWorkerOnce(context?: ApplicationPortContext): Promise<WorkerRuntimeTickResult>;
  runVerticalSlice(
    input: Omit<LocalVerticalSliceSendTextInput, "instanceId"> & LocalVerticalSlicePrepareInput,
    context?: ApplicationPortContext,
  ): Promise<LocalVerticalSliceRunResult>;
  replayEvents(limit?: number): readonly PlatformEventRecord[];
  shutdown(): void;
}>;

type LocalVerticalSliceDemoRuntime = Omit<
  LocalVerticalSliceDemoComposition,
  | "prepareActiveSessionState"
  | "prepareConnectedSession"
  | "sendTextMessage"
  | "runWorkerOnce"
  | "runVerticalSlice"
  | "replayEvents"
  | "shutdown"
>;

const defaultProviderId = createProviderId("baileys");

export function createLocalVerticalSliceDemoComposition(
  options: LocalVerticalSliceDemoOptions = {},
): LocalVerticalSliceDemoComposition {
  const paths = createLocalVerticalSliceDemoPaths(options.stateDirectory);
  const repositories = createDurableJsonRepositorySet(paths.stateDirectory);
  const eventLog = createDurableJsonEventLogStore(paths.eventLogPath);
  const authStateStore = new DurableJsonBaileysAuthStateStore(paths.authStatePath);
  const outboundMessageIntentStore = new DurableJsonOutboundMessageIntentStore(
    paths.outboundIntentPath,
  );
  const queueProvider = new InMemoryQueueProvider({
    workerJobRepository: repositories.workerJobRepository,
  });
  const socketProvider = options.socketProvider ?? new FakeBaileysSocketProvider();
  const fakeSocket = options.fakeSocket ?? new FakeBaileysSocket();
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const domainEventPublisher = createDomainEventPublisher({
    eventLog,
    nowIso,
  });
  const signalIngress = createProviderSignalIngress({
    eventLog,
    nowIso,
  });
  const providerSupervisor = new ProviderRuntimeSupervisor({
    socketProvider,
    signalIngress,
    ownerRef: "local-vertical-slice-demo",
  });
  const outboundMessageResolver = new OutboundMessageIntentBaileysResolver({
    intentStore: outboundMessageIntentStore,
  });
  const messagingProvider = new BaileysMessagingProviderAdapter({
    gateway: new BaileysSocketGateway({
      socketProvider,
      outboundMessageResolver,
    }),
  });
  const applicationDispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      sessionRepository: repositories.sessionRepository,
      messageRepository: repositories.messageRepository,
      guardrailDecisionRepository: repositories.guardrailDecisionRepository,
      healthStatusRepository: repositories.healthStatusRepository,
    },
    outboundMessageIntentStore,
    queueProvider,
    messagingProvider,
    domainEventPublisher,
  });
  const workerApp = new WorkerRuntimeApp({
    runtime: new WorkerRuntime({
      queueProvider,
      handlers: createApplicationWorkerHandlers({
        dispatcher: applicationDispatcher,
      }),
    }),
    queueProvider,
  });

  const runtime = Object.freeze({
    mode: localVerticalSliceDemoMode,
    paths,
    repositories,
    eventLog,
    authStateStore,
    outboundMessageIntentStore,
    queueProvider,
    socketProvider,
    fakeSocket,
    providerSupervisor,
    applicationDispatcher,
    workerApp,
  }) satisfies LocalVerticalSliceDemoRuntime;

  return Object.freeze({
    ...runtime,
    prepareActiveSessionState: (input: LocalVerticalSlicePrepareActiveInput = {}) =>
      prepareActiveSessionState(runtime, input),
    prepareConnectedSession: (
      input: LocalVerticalSlicePrepareInput = {},
      context: ApplicationPortContext = createLocalVerticalSliceDemoContext("prepare"),
    ) => prepareConnectedSession(runtime, input, context),
    sendTextMessage: (
      input: LocalVerticalSliceSendTextInput,
      context: ApplicationPortContext = createLocalVerticalSliceDemoContext("send_text"),
    ) => sendTextMessage(runtime, input, context),
    runWorkerOnce: (
      context: ApplicationPortContext = createLocalVerticalSliceDemoContext("worker"),
    ) => workerApp.runOnce(context),
    runVerticalSlice: (
      input: Omit<LocalVerticalSliceSendTextInput, "instanceId"> & LocalVerticalSlicePrepareInput,
      context: ApplicationPortContext = createLocalVerticalSliceDemoContext("run"),
    ) => runVerticalSlice(runtime, input, context),
    replayEvents: (limit = 100) => replayEvents(eventLog, limit),
    shutdown: () => {
      providerSupervisor.shutdown();
    },
  } satisfies LocalVerticalSliceDemoComposition);
}

export function createLocalVerticalSliceDemoPaths(
  stateDirectory = ".omniwa-local/vertical-slice-01",
): LocalVerticalSliceDemoPaths {
  const resolvedStateDirectory = resolve(stateDirectory);

  return Object.freeze({
    stateDirectory: resolvedStateDirectory,
    eventLogPath: join(resolvedStateDirectory, "event-log.json"),
    authStatePath: join(resolvedStateDirectory, "provider-runtime", "baileys-auth-state.json"),
    outboundIntentPath: join(resolvedStateDirectory, "outbound-message-intents.json"),
  });
}

export function createLocalVerticalSliceDemoContext(scope: string): ApplicationPortContext {
  const safeScope = scope.trim().length === 0 ? "local_demo" : scope.trim();
  const requestRef = `local_demo:${safeScope}:${randomUUID()}`;

  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(requestRef),
      requestId: createRequestId(requestRef),
    }),
    actorRef: "local-vertical-slice-demo",
    idempotencyKey: requestRef,
    dataClassification: "internal",
  });
}

async function prepareConnectedSession(
  composition: LocalVerticalSliceDemoRuntime,
  input: LocalVerticalSlicePrepareInput,
  context: ApplicationPortContext,
): Promise<LocalVerticalSlicePreparedSession> {
  const fakeSocketProvider = requireFakeSocketProvider(composition.socketProvider);
  const runRef = input.runRef ?? `run_${randomUUID()}`;
  const createOutcome = await composition.applicationDispatcher.executeCommand(
    createApplicationCommandEnvelope({
      name: "CreateInstance",
      commandRef: `local_demo:${runRef}:create_instance`,
      requestContext: context.requestContext,
      ...optional("actorRef", context.actorRef),
      idempotencyKey: `local_demo:${runRef}:create_instance`,
      dataClassification: "internal",
    }),
  );

  if (!createOutcome.accepted || createOutcome.resultRef === undefined) {
    throw new Error("Local vertical slice demo could not create an instance.");
  }

  const instanceId = createInstanceId(createOutcome.resultRef);
  const sessionId = createSessionId(`local_demo_session_${stableRef(runRef)}`);
  const instance = await composition.repositories.instanceRepository.load(instanceId);

  if (instance === undefined) {
    throw new Error("Local vertical slice demo could not load the created instance.");
  }

  await composition.repositories.sessionRepository.save(
    activateSession(startSessionPairing(createSession(sessionId, instanceId))),
  );
  await composition.repositories.instanceRepository.save(
    markInstanceConnected(markInstanceConnecting(instance), sessionId),
  );

  const socketRequest = {
    instanceId,
    providerId: defaultProviderId,
    sessionId,
    reasonCode: "local_vertical_slice_demo",
  };

  fakeSocketProvider.registerSocket(socketRequest, composition.fakeSocket);
  await composition.providerSupervisor.startSession(socketRequest, context);
  fakeSocketProvider.emitQrRequired(socketRequest, context, {
    qr: input.rawQrPayload ?? "local-demo-raw-qr",
  });
  fakeSocketProvider.emitConnected(socketRequest, context);
  await composition.providerSupervisor.tick(context);

  const supervisorSession = composition.providerSupervisor
    .snapshot()
    .sessions.find((session) => String(session.sessionId) === String(sessionId));

  return Object.freeze({
    instanceId,
    sessionId,
    providerId: defaultProviderId,
    supervisorState: supervisorSession?.state ?? "UNKNOWN",
  });
}

async function prepareActiveSessionState(
  composition: LocalVerticalSliceDemoRuntime,
  input: LocalVerticalSlicePrepareActiveInput,
): Promise<LocalVerticalSlicePreparedSession> {
  const runRef = input.runRef ?? `run_${randomUUID()}`;
  const instanceId =
    input.instanceId ?? createInstanceId(`local_demo_instance_${stableRef(runRef)}`);
  const sessionId = input.sessionId ?? createSessionId(`local_demo_session_${stableRef(runRef)}`);

  await composition.repositories.sessionRepository.save(
    activateSession(startSessionPairing(createSession(sessionId, instanceId))),
  );
  await composition.repositories.instanceRepository.save(
    markInstanceConnected(markInstanceConnecting(createInstance(instanceId)), sessionId),
  );

  return Object.freeze({
    instanceId,
    sessionId,
    providerId: defaultProviderId,
    supervisorState: "EXTERNALLY_CONNECTED",
  });
}

async function sendTextMessage(
  composition: LocalVerticalSliceDemoRuntime,
  input: LocalVerticalSliceSendTextInput,
  context: ApplicationPortContext,
): Promise<LocalVerticalSliceQueuedMessage> {
  const runRef = input.runRef ?? `run_${randomUUID()}`;
  const outboundIntentRef = input.outboundIntentRef ?? `local_demo_intent_${stableRef(runRef)}`;
  const stored = await composition.outboundMessageIntentStore.storeTextIntent(
    {
      outboundIntentRef: createOutboundMessageIntentRef(outboundIntentRef),
      recipientRef: input.recipientRef,
      text: input.text,
    },
    context,
  );

  if (!stored.ok) {
    throw new Error("Local vertical slice demo could not store outbound intent.");
  }

  const outcome = await composition.applicationDispatcher.executeCommand(
    createApplicationCommandEnvelope({
      name: "SendTextMessage",
      commandRef: `local_demo:${runRef}:send_text`,
      requestContext: context.requestContext,
      targetRef: String(input.instanceId),
      ...optional("actorRef", context.actorRef),
      idempotencyKey: `local_demo:${runRef}:send_text`,
      safeInputRef: String(stored.value.outboundIntentRef),
      dataClassification: "internal",
    }),
  );

  if (!outcome.accepted || outcome.resultRef === undefined) {
    throw new Error("Local vertical slice demo could not queue outbound message.");
  }

  return Object.freeze({
    instanceId: input.instanceId,
    messageId: createMessageId(outcome.resultRef),
    outboundIntentRef: String(stored.value.outboundIntentRef),
    outcome,
  });
}

async function runVerticalSlice(
  composition: LocalVerticalSliceDemoRuntime,
  input: Omit<LocalVerticalSliceSendTextInput, "instanceId"> & LocalVerticalSlicePrepareInput,
  context: ApplicationPortContext,
): Promise<LocalVerticalSliceRunResult> {
  const runRef = input.runRef ?? `run_${randomUUID()}`;
  const prepared = await prepareConnectedSession(
    composition,
    {
      runRef,
      ...optional("rawQrPayload", input.rawQrPayload),
    },
    context,
  );
  const queued = await sendTextMessage(
    composition,
    {
      instanceId: prepared.instanceId,
      recipientRef: input.recipientRef,
      text: input.text,
      runRef,
      ...optional("outboundIntentRef", input.outboundIntentRef),
    },
    context,
  );
  const worker = await composition.workerApp.runOnce(context);
  const message = await composition.repositories.messageRepository.load(queued.messageId);
  const events = replayEvents(composition.eventLog, 100);

  return Object.freeze({
    mode: localVerticalSliceDemoMode,
    instanceId: prepared.instanceId,
    sessionId: prepared.sessionId,
    messageId: queued.messageId,
    sendOutcome: safeCommandOutcome(queued.outcome),
    worker: Object.freeze({
      attempted: worker.attempted,
      completed: worker.completed,
      retried: worker.retried,
      deadLettered: worker.deadLettered,
      failed: worker.failed,
    }),
    ...optional("messageStatus", message?.status),
    providerSendCount: composition.fakeSocket.sentMessages.length,
    eventTypes: Object.freeze(events.map((event) => event.type)),
  });
}

function replayEvents(eventLog: EventLogPort, limit: number): readonly PlatformEventRecord[] {
  const replay = eventLog.replayEvents({ limit });

  if (!replay.ok) {
    throw new Error("Local vertical slice demo could not replay EventLog.");
  }

  return replay.value.events;
}

function safeCommandOutcome(
  outcome: ApplicationCommandOutcome,
): LocalVerticalSliceRunResult["sendOutcome"] {
  return Object.freeze({
    outcome: outcome.outcome,
    accepted: outcome.accepted,
    retryable: outcome.retryable,
    ...optional("reasonCode", outcome.reasonCode),
    ...optional("resultRef", outcome.resultRef),
  });
}

function stableRef(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function requireFakeSocketProvider(
  socketProvider: BaileysSocketProvider,
): FakeBaileysSocketProvider {
  if (socketProvider instanceof FakeBaileysSocketProvider) {
    return socketProvider;
  }

  throw new Error(
    "Local vertical slice fake connection preparation requires FakeBaileysSocketProvider. Use prepareActiveSessionState for live provider send demos.",
  );
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
