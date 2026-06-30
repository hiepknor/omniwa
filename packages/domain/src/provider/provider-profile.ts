import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { FailureCategory } from "../errors/failure-category.js";
import type { GroupProviderCapability } from "../group/group-provider-capability.js";
import type { ProviderId } from "../identity/aggregate-ids.js";
import type { MessageType } from "../messaging/message-type.js";
import type { ProviderProfileStatus } from "../status/provider-profile-status.js";

const providerProfileTransitions: StatusTransitionMap<ProviderProfileStatus> = {
  candidate: ["supported", "degraded", "unsupported", "retired"],
  supported: ["degraded", "unsupported", "retired"],
  degraded: ["supported", "unsupported", "retired"],
  unsupported: ["candidate", "retired"],
  retired: [],
};

export type ProviderProfile = Readonly<{
  id: ProviderId;
  providerKind: string;
  status: ProviderProfileStatus;
  supportedMessageTypes: readonly MessageType[];
  supportedGroupCapabilities: readonly GroupProviderCapability[];
  failureCategory?: FailureCategory;
  domainEvents: readonly DomainEvent[];
}>;

export function createProviderProfile(id: ProviderId, providerKind: string): ProviderProfile {
  return freezeProviderProfile({
    id,
    providerKind: createSafeDomainCode(providerKind, "ProviderProfile.providerKind"),
    status: "candidate",
    supportedMessageTypes: Object.freeze([]),
    supportedGroupCapabilities: Object.freeze([]),
    domainEvents: [],
  });
}

export function markProviderSupported(
  profile: ProviderProfile,
  supportedMessageTypes: readonly MessageType[],
  supportedGroupCapabilities: readonly GroupProviderCapability[] = [],
): ProviderProfile {
  return transitionProviderProfile(profile, "supported", "ProviderProfileSupported", {
    supportedMessageTypes,
    supportedGroupCapabilities,
  });
}

export function markProviderDegraded(
  profile: ProviderProfile,
  failureCategory: FailureCategory,
): ProviderProfile {
  return transitionProviderProfile(profile, "degraded", "ProviderProfileDegraded", {
    failureCategory,
  });
}

export function markProviderUnsupported(
  profile: ProviderProfile,
  failureCategory: FailureCategory,
): ProviderProfile {
  return transitionProviderProfile(profile, "unsupported", "ProviderProfileUnsupported", {
    failureCategory,
  });
}

export function retireProviderProfile(profile: ProviderProfile): ProviderProfile {
  return transitionProviderProfile(profile, "retired");
}

function transitionProviderProfile(
  profile: ProviderProfile,
  status: ProviderProfileStatus,
  eventName?: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    supportedMessageTypes?: readonly MessageType[];
    supportedGroupCapabilities?: readonly GroupProviderCapability[];
    failureCategory?: FailureCategory;
  }> = {},
): ProviderProfile {
  return freezeProviderProfile({
    id: profile.id,
    providerKind: profile.providerKind,
    status: transitionStatus(profile.status, status, providerProfileTransitions, "ProviderProfile"),
    supportedMessageTypes: Object.freeze([
      ...(patch.supportedMessageTypes ?? profile.supportedMessageTypes),
    ]),
    supportedGroupCapabilities: Object.freeze([
      ...(patch.supportedGroupCapabilities ?? profile.supportedGroupCapabilities),
    ]),
    ...optionalValue("failureCategory", patch.failureCategory, profile.failureCategory),
    domainEvents:
      eventName === undefined
        ? profile.domainEvents
        : appendDomainEvent(profile.domainEvents, "ProviderProfile", profile.id, eventName),
  });
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  nextValue: TValue | undefined,
  currentValue: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  const value = nextValue ?? currentValue;
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function freezeProviderProfile(profile: ProviderProfile): ProviderProfile {
  return Object.freeze(profile);
}
