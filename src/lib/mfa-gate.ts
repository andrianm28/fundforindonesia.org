/**
 * The second-factor gate for people who hold ADMIN or VERIFIER (ticket
 * pks-pemenuhan/03, contract Pasal 8(1)). Pure: the jwt callback in
 * ./auth.ts feeds it what it just read and keeps only the answer.
 *
 * The one design choice: while the factor is not satisfied, the answer's
 * `assignments` is EMPTY. The session then carries no authority at all, so
 * every existing check (src/proxy.ts, the Admin and Moderasi layouts,
 * withAssignmentCheck, the 404 for non-holders) refuses exactly as it does for
 * a person who never held the assignment. Nothing is "also checked for MFA"
 * at each of those sites, so none of them can forget to be.
 */

export type MfaAssignment = "ADMIN" | "VERIFIER";

/**
 * - `none`: holds no panel assignment, so the factor is not required.
 * - `verified`: enrolled and proved it for the current enrolment.
 * - `grace`: not enrolled, still inside MFA_ENROLL_GRACE_DAYS.
 * - `challenge`: enrolled, code not yet entered in this session.
 * - `enroll`: not enrolled and the grace is over.
 */
export type MfaState = "none" | "verified" | "grace" | "challenge" | "enroll";

export type MfaInput = {
  assignments: MfaAssignment[];
  /** When the person's factor was confirmed, or null when not enrolled. */
  enabledAtMs: number | null;
  /** The `enabledAtMs` the session proved its code against, if it did. */
  verifiedEnabledAtMs?: number;
  /** The earliest `assignedAt` among the panel assignments. */
  privilegedSinceMs: number | null;
  now: number;
  graceDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveMfa(input: MfaInput): { state: MfaState; assignments: MfaAssignment[] } {
  const holdsPanel = input.assignments.length > 0;
  if (!holdsPanel) return { state: "none", assignments: input.assignments };

  if (input.enabledAtMs !== null) {
    // Bound to the enrolment: a proof made before a reset-and-re-enrol is void.
    if (input.verifiedEnabledAtMs === input.enabledAtMs) {
      return { state: "verified", assignments: input.assignments };
    }
    return { state: "challenge", assignments: [] };
  }

  const graceEnds = input.privilegedSinceMs === null ? -Infinity : input.privilegedSinceMs + input.graceDays * DAY_MS;
  if (input.now < graceEnds) return { state: "grace", assignments: input.assignments };
  return { state: "enroll", assignments: [] };
}

const PROD_MAX_GRACE_DAYS = 30;
let clampLogged = false;

/**
 * MFA_ENROLL_GRACE_DAYS: a non-negative whole number; anything else is 0, the
 * strict default. In production (NODE_ENV=production and CI not exactly
 * "true") a value above 30 is clamped to 30 and logged once, so the huge
 * value CI's e2e uses cannot ride into a real deploy and switch the factor off.
 */
export function enrollGraceDays(env: Record<string, string | undefined>): number {
  const raw = env.MFA_ENROLL_GRACE_DAYS;
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const days = Number(raw);
  if (env.NODE_ENV === "production" && env.CI !== "true" && days > PROD_MAX_GRACE_DAYS) {
    if (!clampLogged) {
      clampLogged = true;
      console.warn(JSON.stringify({ event: "mfa_grace_clamped", requested: days, applied: PROD_MAX_GRACE_DAYS }));
    }
    return PROD_MAX_GRACE_DAYS;
  }
  return days;
}
