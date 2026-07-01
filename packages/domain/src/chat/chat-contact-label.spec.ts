import { describe, expect, it } from "vitest";

import { archiveChat, assignChatLabel, createChat, setChatUnreadCount } from "./chat.js";
import {
  activateContact,
  createContact,
  createContactDisplayName,
  redactContact,
} from "../contact/contact.js";
import { archiveLabel, createLabel, renameLabel } from "../label/label.js";
import {
  createChatId,
  createContactId,
  createInstanceId,
  createLabelId,
} from "../identity/aggregate-ids.js";
import { createJid } from "../references/jid.js";
import { createPhoneNumber } from "../references/phone-number.js";

describe("chat, contact, and label navigation domain", () => {
  it("keeps Chat navigation state separate from Message lifecycle", () => {
    const labelId = createLabelId("label_chat_1");
    const chat = createChat({
      id: createChatId("chat_1"),
      instanceId: createInstanceId("instance_chat_1"),
      jid: createJid("12025550123@s.whatsapp.net"),
    });
    const updated = setChatUnreadCount(assignChatLabel(archiveChat(chat), labelId), 3);

    expect(chat.kind).toBe("direct");
    expect(updated.status).toBe("archived");
    expect(updated.unreadCount).toBe(3);
    expect(updated.labelIds).toEqual([labelId]);
    expect(() => setChatUnreadCount(updated, -1)).toThrow(TypeError);
  });

  it("redacts Contact confidential fields for logs and projections", () => {
    const contact = activateContact(
      createContact({
        id: createContactId("contact_1"),
        instanceId: createInstanceId("instance_contact_1"),
        jid: createJid("12025550123@s.whatsapp.net"),
        displayName: createContactDisplayName("Ada Lovelace"),
        phoneNumber: createPhoneNumber("+12025550123"),
      }),
    );
    const redacted = redactContact(contact);

    expect(contact.status).toBe("active");
    expect(redacted).toMatchObject({
      jid: "[confidential:jid]",
      displayName: "[confidential:contact-display-name]",
      phoneNumber: "[confidential:phone-number]",
    });
    expect(() =>
      createContact({
        id: createContactId("contact_invalid"),
        instanceId: createInstanceId("instance_contact_invalid"),
        jid: createJid("12345@g.us"),
      }),
    ).toThrow(TypeError);
  });

  it("models Label organization without provider-native state", () => {
    const label = createLabel({
      id: createLabelId("label_1"),
      instanceId: createInstanceId("instance_label_1"),
      name: "Priority",
      colorCode: "priority-red",
    });
    const renamed = renameLabel(label, "Urgent");
    const archived = archiveLabel(renamed);

    expect(label.status).toBe("active");
    expect(renamed.name).toBe("Urgent");
    expect(archived.status).toBe("archived");
    expect(() => createLabel({ ...label, name: "" })).toThrow(TypeError);
  });

  it("requires chat kind to match translated JID namespace", () => {
    expect(() =>
      createChat({
        id: createChatId("chat_invalid_kind"),
        instanceId: createInstanceId("instance_chat_invalid_kind"),
        jid: createJid("12025550123@s.whatsapp.net"),
        kind: "group",
      }),
    ).toThrow(TypeError);
  });
});
