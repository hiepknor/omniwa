export type StatusTransitionMap<TStatus extends string> = Readonly<
  Record<TStatus, readonly TStatus[]>
>;

export function transitionStatus<TStatus extends string>(
  current: TStatus,
  next: TStatus,
  transitions: StatusTransitionMap<TStatus>,
  label: string,
): TStatus {
  if (current === next) {
    return next;
  }

  const allowedTransitions = transitions[current];

  if (!allowedTransitions.includes(next)) {
    throw new TypeError(`${label} cannot transition from ${current} to ${next}.`);
  }

  return next;
}

export function assertNotTerminal<TStatus extends string>(
  status: TStatus,
  terminalStatuses: readonly TStatus[],
  label: string,
): void {
  if (terminalStatuses.includes(status)) {
    throw new TypeError(`${label} is terminal in status ${status}.`);
  }
}
