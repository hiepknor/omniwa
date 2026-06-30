import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

export type Jid = OpaqueString<"Jid">;

export function createJid(value: string): Jid {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z0-9_.-]+@(s\.whatsapp\.net|g\.us)$/u.test(normalized)) {
    throw new TypeError("JID must be a translated WhatsApp JID reference.");
  }

  return createOpaqueString(normalized, "Jid");
}

export function redactJid(value: Jid): string {
  void value;
  return "[confidential:jid]";
}
