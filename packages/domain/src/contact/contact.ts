import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

import type { ContactId, InstanceId } from "../identity/aggregate-ids.js";
import type { PhoneNumber } from "../references/phone-number.js";
import { redactPhoneNumber } from "../references/phone-number.js";
import type { Jid } from "../references/jid.js";
import { redactJid } from "../references/jid.js";
import type { ContactStatus } from "../status/contact-status.js";

export type ContactDisplayName = OpaqueString<"ContactDisplayName">;

export type Contact = Readonly<{
  id: ContactId;
  instanceId: InstanceId;
  jid: Jid;
  status: ContactStatus;
  displayName?: ContactDisplayName;
  phoneNumber?: PhoneNumber;
}>;

export type RedactedContact = Readonly<{
  id: ContactId;
  instanceId: InstanceId;
  jid: string;
  status: ContactStatus;
  displayName?: string;
  phoneNumber?: string;
}>;

export function createContact(input: {
  id: ContactId;
  instanceId: InstanceId;
  jid: Jid;
  displayName?: ContactDisplayName;
  phoneNumber?: PhoneNumber;
}): Contact {
  assertDirectJid(input.jid);

  return freezeContact({
    id: input.id,
    instanceId: input.instanceId,
    jid: input.jid,
    status: "discovered",
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.phoneNumber === undefined ? {} : { phoneNumber: input.phoneNumber }),
  });
}

export function createContactDisplayName(value: string): ContactDisplayName {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > 120) {
    throw new TypeError("ContactDisplayName must be non-empty and bounded.");
  }

  return createOpaqueString(normalized, "ContactDisplayName");
}

export function activateContact(contact: Contact): Contact {
  return patchContact(contact, { status: "active" });
}

export function blockContact(contact: Contact): Contact {
  return patchContact(contact, { status: "blocked" });
}

export function deleteContact(contact: Contact): Contact {
  return patchContact(contact, { status: "deleted" });
}

export function updateContactProfile(
  contact: Contact,
  input: Partial<Pick<Contact, "displayName" | "phoneNumber">>,
): Contact {
  return patchContact(contact, input);
}

export function redactContact(contact: Contact): RedactedContact {
  return Object.freeze({
    id: contact.id,
    instanceId: contact.instanceId,
    jid: redactJid(contact.jid),
    status: contact.status,
    ...(contact.displayName === undefined
      ? {}
      : { displayName: "[confidential:contact-display-name]" }),
    ...(contact.phoneNumber === undefined
      ? {}
      : { phoneNumber: redactPhoneNumber(contact.phoneNumber) }),
  });
}

function patchContact(contact: Contact, patch: Partial<Contact>): Contact {
  return freezeContact({
    id: contact.id,
    instanceId: contact.instanceId,
    jid: contact.jid,
    status: patch.status ?? contact.status,
    ...("displayName" in patch
      ? patch.displayName === undefined
        ? {}
        : { displayName: patch.displayName }
      : contact.displayName === undefined
        ? {}
        : { displayName: contact.displayName }),
    ...("phoneNumber" in patch
      ? patch.phoneNumber === undefined
        ? {}
        : { phoneNumber: patch.phoneNumber }
      : contact.phoneNumber === undefined
        ? {}
        : { phoneNumber: contact.phoneNumber }),
  });
}

function assertDirectJid(jid: Jid): void {
  if (!String(jid).endsWith("@s.whatsapp.net")) {
    throw new TypeError("Contact JID must be a WhatsApp direct-contact JID.");
  }
}

function freezeContact(contact: Contact): Contact {
  return Object.freeze(contact);
}
