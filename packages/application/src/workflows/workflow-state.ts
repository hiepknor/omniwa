export const applicationWorkflowStates = [
  "not_started",
  "started",
  "preconditions_checking",
  "rejected",
  "waiting",
  "queuing_work",
  "queued",
  "executing",
  "retrying",
  "compensating",
  "action_required",
  "cancelled",
  "completed",
  "failed",
  "dead_lettered",
] as const;

export type ApplicationWorkflowState = (typeof applicationWorkflowStates)[number];

export const terminalApplicationWorkflowStates = [
  "rejected",
  "action_required",
  "cancelled",
  "completed",
  "failed",
  "dead_lettered",
] as const satisfies readonly ApplicationWorkflowState[];

export type TerminalApplicationWorkflowState = (typeof terminalApplicationWorkflowStates)[number];

export type WorkflowProgress = Readonly<{
  workflowId: string;
  currentState: ApplicationWorkflowState;
  enteredStateReasonCode: string;
}>;

const allowedTransitions = {
  not_started: ["started"],
  started: ["preconditions_checking", "failed"],
  preconditions_checking: ["rejected", "waiting", "queuing_work", "executing", "action_required"],
  waiting: ["executing", "retrying", "cancelled", "action_required", "failed"],
  queuing_work: ["queued", "failed", "action_required"],
  queued: ["executing", "cancelled", "retrying", "dead_lettered"],
  executing: ["completed", "waiting", "retrying", "compensating", "failed", "action_required"],
  retrying: ["queued", "executing", "dead_lettered", "failed", "action_required"],
  compensating: ["completed", "failed", "dead_lettered", "action_required"],
  rejected: [],
  action_required: [],
  cancelled: [],
  completed: [],
  failed: [],
  dead_lettered: [],
} as const satisfies Readonly<
  Record<ApplicationWorkflowState, readonly ApplicationWorkflowState[]>
>;

const queryForbiddenStates = new Set<ApplicationWorkflowState>([
  "queuing_work",
  "queued",
  "retrying",
  "dead_lettered",
]);

export function createWorkflowProgress(input: WorkflowProgress): WorkflowProgress {
  return Object.freeze({ ...input });
}

export function isTerminalWorkflowState(
  state: ApplicationWorkflowState,
): state is TerminalApplicationWorkflowState {
  return terminalApplicationWorkflowStates.includes(state as TerminalApplicationWorkflowState);
}

export function canTransitionWorkflow(
  from: ApplicationWorkflowState,
  to: ApplicationWorkflowState,
): boolean {
  return (allowedTransitions[from] as readonly ApplicationWorkflowState[]).includes(to);
}

export function transitionWorkflowProgress(
  progress: WorkflowProgress,
  nextState: ApplicationWorkflowState,
  reasonCode: string,
): WorkflowProgress {
  if (!canTransitionWorkflow(progress.currentState, nextState)) {
    throw new TypeError(
      `Workflow cannot transition from ${progress.currentState} to ${nextState}.`,
    );
  }

  return createWorkflowProgress({
    workflowId: progress.workflowId,
    currentState: nextState,
    enteredStateReasonCode: reasonCode,
  });
}

export function assertQueryWorkflowState(state: ApplicationWorkflowState): void {
  if (queryForbiddenStates.has(state)) {
    throw new TypeError("Query workflow cannot enter async work, retry, or dead-letter states.");
  }
}
