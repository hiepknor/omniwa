export const messageDirections = ["inbound", "outbound"] as const;

export type MessageDirection = (typeof messageDirections)[number];

export function createMessageDirection(value: string): MessageDirection {
  if (!messageDirections.includes(value as MessageDirection)) {
    throw new TypeError("MessageDirection must be inbound or outbound.");
  }

  return value as MessageDirection;
}
