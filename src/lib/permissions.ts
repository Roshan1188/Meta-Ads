import type { Role } from "@prisma/client";

/**
 * What each role may do. Deliberately a flat allow-list rather than a hierarchy:
 * "ADMIN inherits MANAGER" reads well until the day you need an exception, and then
 * nobody can tell what a role actually permits.
 */
export const PERMISSIONS = [
  "client:create",
  "client:delete",
  "client:generate",
  "campaign:publish",
  /** The one that starts spending money. */
  "campaign:activate",
  "automation:manage",
  "report:send",
  "team:manage",
  "billing:manage",
  "branding:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,

  // Runs the agency day to day, but can't touch the card on file.
  ADMIN: [
    "client:create",
    "client:delete",
    "client:generate",
    "campaign:publish",
    "campaign:activate",
    "automation:manage",
    "report:send",
    "team:manage",
    "branding:manage",
  ],

  // Runs campaigns. No team, no billing, no branding.
  MANAGER: [
    "client:create",
    "client:generate",
    "campaign:publish",
    "campaign:activate",
    "automation:manage",
    "report:send",
  ],

  // Does the work, doesn't spend the money: can draft, cannot publish or activate.
  EMPLOYEE: ["client:generate"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Everything, including billing.",
  ADMIN: "Everything except billing.",
  MANAGER: "Clients and campaigns. No team or billing.",
  EMPLOYEE: "Can generate drafts. Cannot publish or activate.",
};

/** Roles an existing member may hand out. Nobody can create another Owner. */
export const ASSIGNABLE_ROLES: Role[] = ["ADMIN", "MANAGER", "EMPLOYEE"];
