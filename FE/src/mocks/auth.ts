import { sampleUser } from "@/mocks/user";
import type { IUser } from "@/types/common";

/**
 * Sample data for the auth mock layer.
 *
 * Mock rules (so every branch of the auth screens can be reached):
 * - Login: any email + password of 6+ characters.
 * - Register: an email starting with `taken@` is "already registered".
 * - Invitation token: missing → invalid; contains `expired` → "Token expired";
 *   contains `verified` → "User already verified"; an email starting with `admin` → admin invite.
 * - Reset password / sub-user sign-up: a missing or `expired` token fails.
 * - Impersonation: any 24-hex user id works; anything else is "User not found".
 */
export const TAKEN_EMAIL_PREFIX = "taken@";

export const INVITED_COMPANY = "Urban Threads";

/** Customers a system admin can "log in as" (picked by user id). */
export const impersonationTargets: { firstName: string; lastName: string; email: string; company: string }[] = [
  { firstName: "Neha", lastName: "Kapoor", email: "neha@kapoorfashion.in", company: "Kapoor Fashion House" },
  { firstName: "Rohan", lastName: "Shah", email: "rohan@shahelectronics.in", company: "Shah Electronics" },
  { firstName: "Priya", lastName: "Iyer", email: "priya@southloom.in", company: "South Loom Sarees" },
  { firstName: "Imran", lastName: "Qureshi", email: "imran@xbeesstore.in", company: "Xbees Store" },
  { firstName: "Kavya", lastName: "Reddy", email: "kavya@glowbeauty.in", company: "Glow Beauty (Nykaa seller)" },
];

/** Deterministic customer for an impersonation user id. */
export function impersonatedUser(userId: string): IUser {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const target = impersonationTargets[hash % impersonationTargets.length];
  return {
    ...sampleUser,
    _id: userId,
    name: { firstName: target.firstName, lastName: target.lastName },
    email: target.email,
    company: { ...sampleUser.company, name: target.company },
  };
}
