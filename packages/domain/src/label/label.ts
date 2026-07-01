import { createSafeDomainCode } from "../common/safe-domain-code.js";
import type { InstanceId, LabelId } from "../identity/aggregate-ids.js";
import type { LabelStatus } from "../status/label-status.js";

export type Label = Readonly<{
  id: LabelId;
  instanceId: InstanceId;
  name: string;
  colorCode?: string;
  status: LabelStatus;
}>;

export function createLabel(input: {
  id: LabelId;
  instanceId: InstanceId;
  name: string;
  colorCode?: string;
}): Label {
  return freezeLabel({
    id: input.id,
    instanceId: input.instanceId,
    name: normalizeLabelName(input.name),
    ...(input.colorCode === undefined ? {} : { colorCode: normalizeColorCode(input.colorCode) }),
    status: "active",
  });
}

export function renameLabel(label: Label, name: string): Label {
  return patchLabel(label, { name: normalizeLabelName(name) });
}

export function archiveLabel(label: Label): Label {
  return patchLabel(label, { status: "archived" });
}

export function deleteLabel(label: Label): Label {
  return patchLabel(label, { status: "deleted" });
}

function normalizeLabelName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0 || normalized.length > 64) {
    throw new TypeError("Label name must be non-empty and bounded.");
  }

  return normalized;
}

function normalizeColorCode(colorCode: string): string {
  return createSafeDomainCode(colorCode, "Label.colorCode");
}

function patchLabel(label: Label, patch: Partial<Label>): Label {
  return freezeLabel({
    id: label.id,
    instanceId: label.instanceId,
    name: patch.name ?? label.name,
    ...resolveOptionalColorCode(label, patch),
    status: patch.status ?? label.status,
  });
}

function resolveOptionalColorCode(
  label: Label,
  patch: Partial<Label>,
): Partial<Pick<Label, "colorCode">> {
  if ("colorCode" in patch) {
    return patch.colorCode === undefined ? {} : { colorCode: patch.colorCode };
  }

  return label.colorCode === undefined ? {} : { colorCode: label.colorCode };
}

function freezeLabel(label: Label): Label {
  return Object.freeze(label);
}
