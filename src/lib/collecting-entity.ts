import type { Kind } from "@/generated/prisma/client";

/**
 * The Collecting Entity of a Campaign and its Fundraising Permit (CONTEXT.md,
 * Collecting Entity, Fundraising Permit; ADR 0010), as pure rules both the
 * server and the browser can use. A type-only import of the Prisma enum, so
 * the generated client never reaches a browser bundle.
 *
 * A Collecting Entity is always a Partner Organisation: the column is a
 * foreign key to that table, and the Platform Operator is not a row in it,
 * so it can never be one.
 */

/** What the permit rule needs of a Fundraising Permit. */
export type PermitWindow = { kinds: readonly Kind[]; validFrom: Date; validTo: Date };

/**
 * Whether the permit covers `kind` at `now`: the Kind is listed, and `now`
 * lies between `validFrom` and `validTo`, both inclusive.
 */
export function permitCovers(permit: PermitWindow, kind: Kind, now: Date): boolean {
  return (
    permit.kinds.includes(kind) &&
    permit.validFrom.getTime() <= now.getTime() &&
    now.getTime() <= permit.validTo.getTime()
  );
}

/** Whether any of the entity's permits covers `kind` at `now`. */
export function holdsValidPermit(
  entity: { permits: readonly PermitWindow[] },
  kind: Kind,
  now: Date
): boolean {
  return entity.permits.some((permit) => permitCovers(permit, kind, now));
}

/**
 * Why an otherwise Active Campaign refuses a Donation, or null when its
 * Collecting Entity lets it collect:
 * - NO_COLLECTING_ENTITY: it names none (a Campaign that predates the
 *   Collecting Entity, until an Admin or Verifier assigns one);
 * - NO_VALID_PERMIT: its Collecting Entity holds no permit valid now for
 *   its Kind (lapsed, not valid yet, or another Kind).
 */
export type CollectingEntityBlock = "NO_COLLECTING_ENTITY" | "NO_VALID_PERMIT";

export function collectingEntityBlock(
  campaign: { kind: Kind; collectingEntity: { permits: readonly PermitWindow[] } | null },
  now: Date
): CollectingEntityBlock | null {
  if (!campaign.collectingEntity) return "NO_COLLECTING_ENTITY";
  if (!holdsValidPermit(campaign.collectingEntity, campaign.kind, now)) return "NO_VALID_PERMIT";
  return null;
}

/**
 * What a reader selects of a Campaign for the permit rule: its Collecting
 * Entity's name and every permit's window. Permits are few per organisation
 * and never deleted, so all of them are read and judged in code.
 */
export const COLLECTING_ENTITY_SELECT = {
  collectingEntity: {
    select: {
      id: true,
      name: true,
      permits: { select: { kinds: true, validFrom: true, validTo: true } },
    },
  },
} as const;
