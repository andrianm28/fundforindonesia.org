import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { updateKindAuthorisation } from "@/lib/partner-organisations";

/** A Verifier corrects or renews a Kind Authorisation: any of `kind`, `documentReference`, `validFrom`, `validTo`. */
export const PATCH = partnerOrganisationRoute(async ({ actorId, params, body }) => {
  const kindAuthorisation = await updateKindAuthorisation(prisma, {
    actorId,
    organisationId: params.id,
    kindAuthorisationId: params.kindAuthorisationId,
    changes: {
      kind: body.kind,
      documentReference: body.documentReference,
      validFrom: body.validFrom,
      validTo: body.validTo,
    },
  });
  return NextResponse.json({ kindAuthorisation });
});
