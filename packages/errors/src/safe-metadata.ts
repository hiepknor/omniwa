export type SafeMetadataValue = string | number | boolean | null;

export type SafeErrorMetadata = Readonly<Record<string, SafeMetadataValue>>;

export function safeMetadata(input: Record<string, SafeMetadataValue>): SafeErrorMetadata {
  return Object.freeze({ ...input });
}
