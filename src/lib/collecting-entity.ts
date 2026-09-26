import type { Kind } from "@/generated/prisma/client";

/**
 * The Collecting Entity of a Campaign, its Fundraising Permit, and its Kind
 * Authorisation (CONTEXT.md, Collecting Entity, Fundraising Permit, Kind
 * Authorisation; ADR 0010, 0013), as pure rules both the server and the
 * browser can use. A type-only import of the Prisma enum, so the generated
 * client never reaches a browser bundle.
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

/** What the Kind Authorisation rule needs of one authorisation. */
export type KindAuthorisationWindow = { kind: Kind; validFrom: Date; validTo: Date };

/**
 * Every Kind but `donation` needs a Kind Authorisation (CONTEXT.md, Kind
 * Authorisation; ADR 0013): zakat and wakaf because they require a licensed
 * institution, and hibah provisionally by the same rule.
 */
export function requiresKindAuthorisation(kind: Kind): boolean {
  return kind !== "DONATION";
}

/**
 * Whether the authorisation covers `kind` at `now`: it is for that Kind, and
 * `now` lies between `validFrom` and `validTo`, both inclusive.
 */
export function kindAuthorisationCovers(authorisation: KindAuthorisationWindow, kind: Kind, now: Date): boolean {
  return (
    authorisation.kind === kind &&
    authorisation.validFrom.getTime() <= now.getTime() &&
    now.getTime() <= authorisation.validTo.getTime()
  );
}

/** Whether any of the entity's Kind Authorisations covers `kind` at `now`. */
export function holdsValidKindAuthorisation(
  entity: { kindAuthorisations: readonly KindAuthorisationWindow[] },
  kind: Kind,
  now: Date
): boolean {
  return entity.kindAuthorisations.some((authorisation) => kindAuthorisationCovers(authorisation, kind, now));
}

/**
 * Why an otherwise Active Campaign refuses a Donation, or null when its
 * Collecting Entity lets it collect:
 * - NO_COLLECTING_ENTITY: it names none (a Campaign that predates the
 *   Collecting Entity, until an Admin or Verifier assigns one);
 * - NO_VALID_PERMIT: its Collecting Entity holds no permit valid now for
 *   its Kind (lapsed, not valid yet, or another Kind);
 * - NO_VALID_KIND_AUTHORISATION: its Kind needs a Kind Authorisation (every
 *   Kind but donation) and its Collecting Entity holds none valid now for it.
 */
export type CollectingEntityBlock = "NO_COLLECTING_ENTITY" | "NO_VALID_PERMIT" | "NO_VALID_KIND_AUTHORISATION";

export function collectingEntityBlock(
  campaign: {
    kind: Kind;
    collectingEntity: {
      permits: readonly PermitWindow[];
      kindAuthorisations: readonly KindAuthorisationWindow[];
    } | null;
  },
  now: Date
): CollectingEntityBlock | null {
  if (!campaign.collectingEntity) return "NO_COLLECTING_ENTITY";
  if (!holdsValidPermit(campaign.collectingEntity, campaign.kind, now)) return "NO_VALID_PERMIT";
  if (
    requiresKindAuthorisation(campaign.kind) &&
    !holdsValidKindAuthorisation(campaign.collectingEntity, campaign.kind, now)
  ) {
    return "NO_VALID_KIND_AUTHORISATION";
  }
  return null;
}

/**
 * What a reader selects of a Campaign for the permit and Kind Authorisation
 * rules: its Collecting Entity's name and every permit's and authorisation's
 * window. Both are few per organisation and never deleted, so all of them
 * are read and judged in code.
 */
export const COLLECTING_ENTITY_SELECT = {
  collectingEntity: {
    select: {
      id: true,
      name: true,
      permits: { select: { kinds: true, validFrom: true, validTo: true } },
      kindAuthorisations: { select: { kind: true, validFrom: true, validTo: true } },
    },
  },
} as const;

/** One Fundraising Permit or Kind Authorisation the "expiring soon" list names. */
export type ExpiringWindow =
  | { type: "permit"; organisationId: string; organisationName: string; kinds: readonly Kind[]; validTo: Date }
  | { type: "kindAuthorisation"; organisationId: string; organisationName: string; kind: Kind; validTo: Date };

/**
 * Every Fundraising Permit and Kind Authorisation of `organisations` that is
 * valid right now but expires within `days` (default 30), for the
 * Verifier's dashboard (prd-compliance 11; CONTEXT.md, Fundraising Permit,
 * Kind Authorisation): the warning that stands in for a scheduled reminder
 * until one exists (prd-compliance 20). Sorted soonest first. Pure: the
 * reader passes every organisation's permits and Kind Authorisations,
 * already read.
 */
export function expiringWindows(
  organisations: readonly {
    id: string;
    name: string;
    permits: readonly PermitWindow[];
    kindAuthorisations: readonly KindAuthorisationWindow[];
  }[],
  now: Date,
  days = 30
): ExpiringWindow[] {
  const horizon = now.getTime() + days * 24 * 60 * 60 * 1000;
  const expiringSoon = (validFrom: Date, validTo: Date) =>
    validFrom.getTime() <= now.getTime() && now.getTime() <= validTo.getTime() && validTo.getTime() <= horizon;

  const items: ExpiringWindow[] = [];
  for (const organisation of organisations) {
    for (const permit of organisation.permits) {
      if (expiringSoon(permit.validFrom, permit.validTo)) {
        items.push({
          type: "permit",
          organisationId: organisation.id,
          organisationName: organisation.name,
          kinds: permit.kinds,
          validTo: permit.validTo,
        });
      }
    }
    for (const authorisation of organisation.kindAuthorisations) {
      if (expiringSoon(authorisation.validFrom, authorisation.validTo)) {
        items.push({
          type: "kindAuthorisation",
          organisationId: organisation.id,
          organisationName: organisation.name,
          kind: authorisation.kind,
          validTo: authorisation.validTo,
        });
      }
    }
  }
  return items.sort((a, b) => a.validTo.getTime() - b.validTo.getTime());
}
