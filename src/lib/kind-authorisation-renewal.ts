import type { Kind } from "@/generated/prisma/client";
import { KIND_AUTHORISATION_EXPIRY_WARNING_DAYS } from "@/lib/kind-authorisation-window";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One Kind Authorisation the Verifier's renewal list names. */
export interface RenewalDueKindAuthorisation {
  id: string;
  organisationId: string;
  organisationName: string;
  kind: Kind;
  validTo: Date;
  /** `lapsed`: the date has passed. `expiring`: still valid, but within the warning horizon. */
  status: "lapsed" | "expiring";
}

/**
 * Every Kind Authorisation of `organisations` that is about to expire (within
 * KIND_AUTHORISATION_EXPIRY_WARNING_DAYS days, the same window as the scheduled
 * warning)
 * or whose date has already passed (CONTEXT.md, Kind Authorisation: a Campaign
 * of that Kind stops receiving Donations until it is renewed).
 *
 * An authorisation is left out when the same organisation holds another one
 * of the same Kind that is still valid past the horizon: authorisations are
 * never deleted, so without this the list would carry every past renewal
 * forever. Lapsed ones come first, then soonest to lapse. Pure: the caller
 * passes every organisation's authorisations, already read.
 */
export function kindAuthorisationsNeedingRenewal(
  organisations: readonly {
    id: string;
    name: string;
    kindAuthorisations: readonly { id: string; kind: Kind; validFrom: Date; validTo: Date }[];
  }[],
  now: Date,
  days = KIND_AUTHORISATION_EXPIRY_WARNING_DAYS,
): RenewalDueKindAuthorisation[] {
  const horizon = now.getTime() + days * MS_PER_DAY;

  const items: RenewalDueKindAuthorisation[] = [];
  for (const organisation of organisations) {
    for (const authorisation of organisation.kindAuthorisations) {
      if (authorisation.validTo.getTime() > horizon) continue;

      const replaced = organisation.kindAuthorisations.some(
        (other) =>
          other.id !== authorisation.id &&
          other.kind === authorisation.kind &&
          other.validFrom.getTime() <= now.getTime() &&
          other.validTo.getTime() > horizon,
      );
      if (replaced) continue;

      items.push({
        id: authorisation.id,
        organisationId: organisation.id,
        organisationName: organisation.name,
        kind: authorisation.kind,
        validTo: authorisation.validTo,
        status: authorisation.validTo.getTime() <= now.getTime() ? "lapsed" : "expiring",
      });
    }
  }
  return items.sort((a, b) => a.validTo.getTime() - b.validTo.getTime());
}
