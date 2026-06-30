export const mediaCategories = ["image", "video", "document", "audio"] as const;

export type MediaCategory = (typeof mediaCategories)[number];

export function createMediaCategory(value: string): MediaCategory {
  if (!mediaCategories.includes(value as MediaCategory)) {
    throw new TypeError("MediaCategory must be image, video, document, or audio.");
  }

  return value as MediaCategory;
}
