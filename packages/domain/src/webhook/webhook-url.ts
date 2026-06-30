import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

export type WebhookUrl = OpaqueString<"WebhookUrl">;

export function createWebhookUrl(value: string): WebhookUrl {
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("WebhookUrl must use http or https.");
  }

  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new TypeError("WebhookUrl must not include credentials or fragments.");
  }

  return createOpaqueString(url.toString(), "WebhookUrl");
}
