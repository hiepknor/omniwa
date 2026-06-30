export const runtimeRoles = [
  "api",
  "worker",
  "scheduler",
  "provider",
  "webhook",
  "projection",
  "background",
  "metrics",
  "health",
] as const;

export type RuntimeRole = (typeof runtimeRoles)[number];

export function isRuntimeRole(value: string): value is RuntimeRole {
  return runtimeRoles.includes(value as RuntimeRole);
}
