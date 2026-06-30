export const supportedMessageTypes = ["text", "image", "video", "document", "audio"] as const;

export type MessageType = (typeof supportedMessageTypes)[number];

export function createMessageType(value: string): MessageType {
  if (!isSupportedMessageType(value)) {
    throw new TypeError("MessageType must be one of text, image, video, document, or audio.");
  }

  return value;
}

export function isSupportedMessageType(value: string): value is MessageType {
  return supportedMessageTypes.includes(value as MessageType);
}
